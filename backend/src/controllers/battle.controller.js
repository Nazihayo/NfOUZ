'use strict';

const playerRepo = require('../repositories/player.repository');
const battleService = require('../services/battle.service');
const { success, ApiError } = require('../utils/responseEnvelope');

/**
 * Resolves the authenticated caller's own player row from req.firebaseUid.
 * Mirrors the pattern in player.controller.js — the request body's
 * attacker_id is never trusted; the attacker is always the authenticated
 * caller.
 */
async function resolveSelf(req) {
  const player = await playerRepo.getByFirebaseUid(req.firebaseUid);
  if (!player) {
    throw new ApiError('PLAYER_NOT_FOUND', 'No player is registered for this account.', 404);
  }
  return player;
}

/**
 * POST /battle/challenge
 * Body: { defender_id: string, location: { lat: number, lng: number } }
 *
 * attacker_id is NEVER read from the body — the attacker is always the
 * authenticated caller, resolved via Firebase uid. See REST API
 * Specification v1.0 section 3.1 for the response shape.
 */
async function createChallenge(req, res, next) {
  try {
    const attacker = await resolveSelf(req);

    const defenderId = req.body.defender_id;
    if (!defenderId) {
      throw new ApiError('INVALID_CHALLENGE', 'defender_id is required.', 400);
    }

    let location = null;
    if (req.body.location) {
      location = {
        lat: Number(req.body.location.lat),
        lng: Number(req.body.location.lng),
      };
    }

    const battle = await battleService.createChallenge(attacker.player_id, defenderId, location);

    return res.status(200).json(
      success({
        battle_id: battle.battle_id,
        photon_room_name: battle.photon_room_name,
        attacker_id: battle.attacker_id,
        defender_id: battle.defender_id,
        status: battle.status,
        session_expires_at: battle.session_expires_at,
        // Sprint 6 final security correction: the attacker's client always
        // creates the Photon room, so it is this battle's Host Mode host
        // by convention — these three fields let it later sign an
        // authoritative result. They are returned ONLY here, to this one
        // caller, and must NEVER be added to GET /battle/{battleId}'s
        // response (which either participant can call) — see
        // battle.service.js resolveBattle's header comment.
        host_authority_secret: battle.host_authority_secret,
        match_nonce: battle.match_nonce,
        rules_version: battle.rules_version,
      })
    );
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /battle/{battleId}
 * Returns current session state. Any authenticated player who is a
 * participant may query it; anyone else gets FORBIDDEN.
 */
async function getBattle(req, res, next) {
  try {
    const requester = await resolveSelf(req);
    const battle = await battleService.checkForfeit(req.params.battleId);

    // Confirms participation without leaking session state to non-participants.
    battleService.resolveSide(battle, requester.player_id);

    return res.status(200).json(
      success({
        battle_id: battle.battle_id,
        attacker_id: battle.attacker_id,
        defender_id: battle.defender_id,
        status: battle.status,
        photon_room_name: battle.photon_room_name,
        attacker_ready: battle.attacker_ready,
        defender_ready: battle.defender_ready,
        attacker_disconnected_at: battle.attacker_disconnected_at,
        defender_disconnected_at: battle.defender_disconnected_at,
        forfeited_by: battle.forfeited_by,
        session_started_at: battle.session_started_at,
        session_expires_at: battle.session_expires_at,
        // Sprint 6 — Full Combat System: result retrieval. These columns
        // exist since 004_battles.sql but were always null until
        // resolveBattle() (Sprint 6) started populating them, so this is
        // additive exposure of existing data, not a new endpoint.
        winner_id: battle.winner_id,
        loser_id: battle.loser_id,
        duration_seconds: battle.duration_seconds,
      })
    );
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /battle/{battleId}/ready
 * Marks the caller ready (loading synchronization / ready confirmation).
 */
async function markReady(req, res, next) {
  try {
    const requester = await resolveSelf(req);
    const battle = await battleService.setReady(req.params.battleId, requester.player_id);
    return res.status(200).json(
      success({
        battle_id: battle.battle_id,
        attacker_ready: battle.attacker_ready,
        defender_ready: battle.defender_ready,
      })
    );
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /battle/{battleId}/disconnect
 * Starts the 15-second reconnect grace period for the caller.
 */
async function reportDisconnect(req, res, next) {
  try {
    const requester = await resolveSelf(req);
    const battle = await battleService.handleDisconnect(req.params.battleId, requester.player_id);
    return res.status(200).json(
      success({
        battle_id: battle.battle_id,
        attacker_reconnect_deadline: battle.attacker_reconnect_deadline,
        defender_reconnect_deadline: battle.defender_reconnect_deadline,
      })
    );
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /battle/{battleId}/reconnect
 * Clears disconnect state for the caller if still within the grace period.
 */
async function reportReconnect(req, res, next) {
  try {
    const requester = await resolveSelf(req);
    const battle = await battleService.handleReconnect(req.params.battleId, requester.player_id);
    return res.status(200).json(
      success({
        battle_id: battle.battle_id,
        status: battle.status,
      })
    );
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /battle/{battleId}/resolve
 * Body: { result: SignedBattleResult, signature: string }
 *
 * Sprint 6 final security correction: the body no longer carries a bare
 * outcome/winner_id/loser_id the server takes on faith at all — it
 * carries a full result payload (battle_id, room_name, rules_version,
 * match_nonce, event_seq, both participant ids, both final health
 * values, outcome, duration_seconds, issued_at) plus an HMAC signature
 * over that payload, produced only by this battle's Host Mode host using
 * the secret returned exclusively to it by POST /battle/challenge. See
 * battle.service.js resolveBattle's header comment for full validation
 * order and for why this is still only LIMITED anti-cheat in Host Mode
 * Alpha, not full server authority.
 */
async function resolveBattle(req, res, next) {
  try {
    const requester = await resolveSelf(req);

    const result = await battleService.resolveBattle(req.params.battleId, requester.player_id, {
      result: req.body.result,
      signature: req.body.signature,
    });

    return res.status(200).json(success(result));
  } catch (err) {
    return next(err);
  }
}

module.exports = { createChallenge, getBattle, markReady, reportDisconnect, reportReconnect, resolveBattle };
