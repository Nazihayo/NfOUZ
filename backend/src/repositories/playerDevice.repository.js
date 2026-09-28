'use strict';

const db = require('../config/database');

/**
 * Sprint 8 correction (final pass) — all SQL touching `player_devices`
 * (017_friends_sos_rescue_fcm.sql), a one-player-to-many-devices table.
 *
 * Security model:
 *   - `device_key` identifies ONE installation (stored securely by Unity —
 *     see PushNotificationHandler.cs). `fcm_token` identifies the current
 *     live push registration for that installation, and can rotate.
 *   - A token is NEVER silently moved from one player to another: a
 *     registration whose fcm_token already belongs to a DIFFERENT player
 *     raises TokenOwnedByAnotherPlayerError (mapped to a 409 by the
 *     controller) instead of reassigning it — this is the opposite of
 *     the previous pass's `ON CONFLICT (fcm_token) DO UPDATE ... SET
 *     player_id = EXCLUDED.player_id`, which is exactly the silent
 *     transfer this correction explicitly forbids.
 *   - Re-registering the SAME player's SAME installation (player_id +
 *     device_key) is an ordinary upsert (a refreshed token for a device
 *     already known to be theirs).
 */

class TokenOwnedByAnotherPlayerError extends Error {
  constructor() {
    super('This push token is already registered to a different player.');
    this.code = 'FCM_TOKEN_CONFLICT';
  }
}

/**
 * Registers (or refreshes) one device. Never returns or logs the raw
 * token beyond what the caller does with the returned row — callers
 * (player.controller.js) must not echo `fcm_token` back in an API
 * response (see updateFcmToken's own doc comment).
 */
async function registerDevice(playerId, deviceKey, fcmToken, platform, executor = db) {
  const tokenOwner = await executor.query(`SELECT player_id FROM player_devices WHERE fcm_token = $1`, [fcmToken]);
  if (tokenOwner.rows[0] && tokenOwner.rows[0].player_id !== playerId) {
    throw new TokenOwnedByAnotherPlayerError();
  }

  try {
    const result = await executor.query(
      `INSERT INTO player_devices (player_id, device_key, fcm_token, platform, is_active, updated_at)
       VALUES ($1, $2, $3, $4, TRUE, now())
       ON CONFLICT (player_id, device_key) DO UPDATE
         SET fcm_token = EXCLUDED.fcm_token,
             platform = EXCLUDED.platform,
             is_active = TRUE,
             updated_at = now()
       RETURNING *`,
      [playerId, deviceKey, fcmToken, platform]
    );
    return result.rows[0];
  } catch (err) {
    // A race between the SELECT above and this INSERT: the token was
    // claimed by someone else in between. uniq_player_devices_fcm_token
    // is the backstop — translate it to the same conflict error rather
    // than leaking a raw constraint-violation message to the caller.
    if (err.code === '23505' && /fcm_token/.test(err.message || '')) {
      throw new TokenOwnedByAnotherPlayerError();
    }
    throw err;
  }
}

/** Normal sign-out: deactivates ONLY the caller's current device (identified by its own device_key). */
async function deactivateDevice(playerId, deviceKey, executor = db) {
  const result = await executor.query(
    `UPDATE player_devices SET is_active = FALSE, updated_at = now()
     WHERE player_id = $1 AND device_key = $2
     RETURNING *`,
    [playerId, deviceKey]
  );
  return result.rows[0] || null;
}

/**
 * Account-wide device deactivation — deliberately kept as a SEPARATE
 * function/endpoint from deactivateDevice (see player.controller.js),
 * never reachable as a side effect of an ordinary sign-out. "Privileged"
 * in a codebase with no admin-role system yet means: requires an explicit,
 * distinctly-named call the client must opt into, not an implicit branch
 * of the everyday device-registration flow.
 */
async function deactivateAllDevices(playerId, executor = db) {
  const result = await executor.query(
    `UPDATE player_devices SET is_active = FALSE, updated_at = now()
     WHERE player_id = $1 AND is_active = TRUE
     RETURNING *`,
    [playerId]
  );
  return result.rows;
}

/** Every active push token for a player, most-recently-updated first — a
 * player notification fans out to all of them (see fcm.service.js#sendToAllDevices). */
async function getActiveTokens(playerId, executor = db) {
  const result = await executor.query(
    `SELECT fcm_token FROM player_devices WHERE player_id = $1 AND is_active = TRUE ORDER BY updated_at DESC`,
    [playerId]
  );
  return result.rows.map((row) => row.fcm_token);
}

/**
 * Deactivates one specific token everywhere it's registered — used by
 * fcm.service.js when FCM itself reports the token as permanently
 * invalid/unregistered, so a dead token stops being fanned out to. Not
 * scoped to a player_id because at the point this is called the caller
 * only has the token FCM rejected, not necessarily which player row it
 * belongs to (a device row could theoretically have been reassigned since
 * the fan-out list was read, though that never happens silently per this
 * file's own security rule — this is defense-in-depth, not the expected path).
 */
async function deactivateByToken(fcmToken, executor = db) {
  const result = await executor.query(
    `UPDATE player_devices SET is_active = FALSE, updated_at = now()
     WHERE fcm_token = $1
     RETURNING *`,
    [fcmToken]
  );
  return result.rows[0] || null;
}

module.exports = {
  TokenOwnedByAnotherPlayerError,
  registerDevice,
  deactivateDevice,
  deactivateAllDevices,
  deactivateByToken,
  getActiveTokens,
};
