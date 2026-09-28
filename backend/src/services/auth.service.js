'use strict';

const playerRepo = require('../repositories/player.repository');
const { ApiError } = require('../utils/responseEnvelope');

const VALID_CLASSES = ['Scout', 'Ranger', 'Titan'];
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;

/**
 * Registers a new player row for an already-authenticated Firebase user.
 * firebaseUid is NEVER accepted from the request body — it is passed in
 * by the controller after auth.middleware.js has verified the ID token.
 * See Firebase Security Package v1.0, section 1.1.
 */
async function registerPlayer(firebaseUid, { username, classType }) {
  if (!username || !USERNAME_REGEX.test(username)) {
    throw new ApiError(
      'INVALID_USERNAME',
      'Username must be 3-20 characters, letters/numbers/underscore only.',
      400
    );
  }

  if (!VALID_CLASSES.includes(classType)) {
    throw new ApiError('INVALID_CLASS_TYPE', `class_type must be one of: ${VALID_CLASSES.join(', ')}`, 400);
  }

  const existingByUid = await playerRepo.getByFirebaseUid(firebaseUid);
  if (existingByUid) {
    throw new ApiError('PLAYER_ALREADY_REGISTERED', 'This account is already registered.', 409);
  }

  const existingByUsername = await playerRepo.getByUsername(username);
  if (existingByUsername) {
    throw new ApiError('USERNAME_TAKEN', 'This username is already taken.', 409);
  }

  const player = await playerRepo.create({ firebaseUid, username, classType });
  return toPublicPlayer(player);
}

/**
 * Returns the player row associated with the currently authenticated
 * Firebase user, used by the client's SessionBootstrap (see UI/UX Flows
 * & Save System v1.0, section 4.3) right after sign-in.
 */
async function getSessionByFirebaseUid(firebaseUid) {
  const player = await playerRepo.getByFirebaseUid(firebaseUid);
  if (!player) {
    throw new ApiError('PLAYER_NOT_FOUND', 'No player is registered for this account yet.', 404);
  }
  return toPublicPlayer(player);
}

/**
 * `is_controlled`/`is_protected` are reported from the time-based
 * isControlActive/isProtected checks, not the raw stored columns —
 * nothing clears those columns on their own once their window passes
 * (see player.repository.js#clearExpiredControl's doc comment), so a
 * client calling /auth/me right after a window ends must still see
 * `false`, not a stale `true`. The matching timestamp is likewise nulled
 * out whenever its own flag is false, so a client never sees a
 * "controlled/protected until" timestamp that's already in the past
 * alongside its state being reported as inactive.
 */
function toPublicPlayer(row) {
  const controlActive = playerRepo.isControlActive(row);
  const protectedActive = playerRepo.isProtected(row);
  return {
    player_id: row.player_id,
    username: row.username,
    class_type: row.class_type,
    faction_id: row.faction_id,
    health: row.health,
    max_health: row.max_health,
    energy: row.energy,
    max_energy: row.max_energy,
    influence: row.influence,
    level: row.level,
    experience: row.experience,
    rank: row.rank,
    credits: row.credits,
    is_controlled: controlActive,
    controller_id: controlActive ? row.controller_id : null,
    controlled_until: controlActive ? row.controlled_until : null,
    is_protected: protectedActive,
    protected_until: protectedActive ? row.protected_until : null,
  };
}

module.exports = { registerPlayer, getSessionByFirebaseUid, VALID_CLASSES };
