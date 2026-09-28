'use strict';

process.env.NODE_ENV = 'test';

const request = require('supertest');
const resultSignature = require('../src/utils/battleResultSignature');

/**
 * Sprint 6 final security correction: POST /battle/{battleId}/resolve now
 * takes a signed authoritative result payload — see battle.service.js
 * resolveBattle's header comment for the full threat model and the Host
 * Mode Alpha limitation (this is limited anti-cheat, not full server
 * authority, since the "host" is a player client, not a separate server
 * process).
 *
 * The mutating part of resolution runs inside db.withTransaction, mocked
 * here as a simple passthrough (`fn(txClient)`) so these tests can focus
 * on resolveBattle's validation and business logic; the real
 * BEGIN/COMMIT/ROLLBACK control flow is exercised for real, unmocked, in
 * database.transaction.test.js.
 */

const txClient = { query: jest.fn() };

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  withTransaction: jest.fn(),
  checkConnection: jest.fn().mockResolvedValue(true),
  shutdown: jest.fn(),
  pool: { on: jest.fn(), query: jest.fn() },
}));

jest.mock('../src/config/firebase', () => ({
  initializeFirebase: jest.fn(),
  checkFirebaseReady: jest.fn().mockReturnValue(true),
  verifyIdToken: jest.fn(),
  admin: {},
}));

const db = require('../src/config/database');
const { verifyIdToken } = require('../src/config/firebase');
const createApp = require('../src/app');

const ATTACKER = { player_id: 'attacker-id', firebase_uid: 'fb-attacker' };
const DEFENDER = { player_id: 'defender-id', firebase_uid: 'fb-defender' };

const HOST_SECRET = 'test-host-secret';
const RULES_VERSION = '6.1.0'; // matches env.COMBAT_RULES_VERSION's default
const MATCH_NONCE = 'test-match-nonce';

function baseBattleRow(overrides = {}) {
  return {
    battle_id: 'battle-1',
    attacker_id: ATTACKER.player_id,
    defender_id: DEFENDER.player_id,
    status: 'in_progress',
    photon_room_name: 'battle_battle-1',
    winner_id: null,
    loser_id: null,
    duration_seconds: null,
    host_player_id: ATTACKER.player_id,
    host_authority_secret: HOST_SECRET,
    match_nonce: MATCH_NONCE,
    last_event_seq: 0,
    rules_version: RULES_VERSION,
    ...overrides,
  };
}

function baseResult(overrides = {}) {
  return {
    battle_id: 'battle-1',
    room_name: 'battle_battle-1',
    rules_version: RULES_VERSION,
    match_nonce: MATCH_NONCE,
    event_seq: 1,
    attacker_id: ATTACKER.player_id,
    defender_id: DEFENDER.player_id,
    attacker_final_health: 40,
    defender_final_health: 0,
    outcome: 'attacker_win',
    duration_seconds: 42,
    issued_at: new Date().toISOString(),
    ...overrides,
  };
}

function sign(result, secret = HOST_SECRET) {
  return resultSignature.signResult(result, secret);
}

async function postResolve(app, result, signature) {
  return request(app)
    .post('/battle/battle-1/resolve')
    .set('Authorization', 'Bearer valid-token')
    .send({ result, signature });
}

describe('POST /battle/{battleId}/resolve — Sprint 6 final security correction (signed result)', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
    db.withTransaction.mockImplementation((fn) => fn(txClient));
    verifyIdToken.mockResolvedValue({ uid: ATTACKER.firebase_uid });
  });

  it('rejects requests with no Authorization header', async () => {
    const result = baseResult();
    const response = await request(app)
      .post('/battle/battle-1/resolve')
      .send({ result, signature: sign(result) });

    expect(response.status).toBe(401);
  });

  it('accepts a validly signed attacker_win result: applies +15/-10 Influence, releases/applies Control, logs both, unlocks rank, atomically', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ATTACKER] }) // resolveSelf
      .mockResolvedValueOnce({ rows: [baseBattleRow()] }); // getBattleById

    // Sprint 7 continuation + Sprint 8 correction call order inside the
    // transaction: 1 resolveBattle UPDATE, 2 adjustInfluence(winner),
    // 3 adjustInfluence(loser), 4 releaseOutgoingControl(loser),
    // 5 applyIncomingControl(loser <- winner), 6 controlRelationshipRepo.
    // closeAllActiveForController(loser), 7 closeActiveForControlled(loser),
    // 8 controlRelationshipRepo.create(loser, winner), 9-10
    // influenceLogRepo.log (winner, loser), 11-12 recordRankUnlock
    // (winner, loser).
    txClient.query
      .mockResolvedValueOnce({ rows: [{ ...baseBattleRow(), status: 'resolved', winner_id: ATTACKER.player_id, loser_id: DEFENDER.player_id, duration_seconds: 42 }] })
      .mockResolvedValueOnce({ rows: [{ player_id: ATTACKER.player_id, influence: 115, rank: 'Citizen', applied_delta: 15 }] })
      .mockResolvedValueOnce({ rows: [{ player_id: DEFENDER.player_id, influence: 90, rank: 'Citizen', applied_delta: -10 }] })
      .mockResolvedValueOnce({ rows: [] }) // releaseOutgoingControl(loser) -> no one was being controlled by the loser
      .mockResolvedValueOnce({ rows: [{ player_id: DEFENDER.player_id, is_controlled: true, controller_id: ATTACKER.player_id, controlled_until: new Date() }] }) // applyIncomingControl
      .mockResolvedValueOnce({ rows: [] }) // controlRelationshipRepo.closeAllActiveForController(loser)
      .mockResolvedValueOnce({ rows: [] }) // controlRelationshipRepo.closeActiveForControlled(loser)
      .mockResolvedValueOnce({ rows: [{ control_relationship_id: 'rel-1' }] }) // controlRelationshipRepo.create
      .mockResolvedValueOnce({ rows: [{ log_id: 'log-1' }] })
      .mockResolvedValueOnce({ rows: [{ log_id: 'log-2' }] })
      .mockResolvedValueOnce({ rows: [{ player_id: ATTACKER.player_id, rank_name: 'Citizen' }] }) // recordRankUnlock(winner)
      .mockResolvedValueOnce({ rows: [{ player_id: DEFENDER.player_id, rank_name: 'Citizen' }] }); // recordRankUnlock(loser)

    const result = baseResult();
    const response = await postResolve(app, result, sign(result));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.result).toBe('attacker_win');
    expect(response.body.data.winner_influence).toBe(115);
    expect(response.body.data.loser_influence).toBe(90);
    // Sprint 7 (Influence + Control): rank now rides along with the same
    // Influence write — see player.repository.js#adjustInfluence.
    expect(response.body.data.winner_rank).toBe('Citizen');
    expect(response.body.data.loser_rank).toBe('Citizen');

    const [resolveSql, resolveParams] = txClient.query.mock.calls[0];
    expect(resolveSql).toMatch(/UPDATE battles/);
    expect(resolveParams).toEqual(['battle-1', ATTACKER.player_id, DEFENDER.player_id, 42, 1, 'resolved']);

    // Sprint 7 continuation: influence_log gets the ACTUAL applied_delta
    // (not the nominal +15/-10 env constants) as its `delta` param, plus
    // the nominal constant as the trailing nominalDelta param.
    const [, winnerLogParams] = txClient.query.mock.calls[8];
    expect(winnerLogParams).toEqual([ATTACKER.player_id, 15, 'battle_win', 'battle-1', 15]);
    const [, loserLogParams] = txClient.query.mock.calls[9];
    expect(loserLogParams).toEqual([DEFENDER.player_id, -10, 'battle_loss', 'battle-1', -10]);

    // Sprint 8 correction — control_relationships is written alongside the
    // players-table control columns: outgoing relationships closed, any
    // existing incoming one superseded, then the new one opened.
    const [closeOutgoingSql, closeOutgoingParams] = txClient.query.mock.calls[5];
    expect(closeOutgoingSql).toMatch(/UPDATE control_relationships/);
    expect(closeOutgoingSql).toMatch(/WHERE controller_id = \$1/);
    expect(closeOutgoingParams).toEqual([DEFENDER.player_id, 'released_as_controller_defeated']);

    const [closeIncomingSql, closeIncomingParams] = txClient.query.mock.calls[6];
    expect(closeIncomingSql).toMatch(/WHERE controlled_player_id = \$1/);
    expect(closeIncomingParams).toEqual([DEFENDER.player_id, 'superseded_by_new_capture']);

    const [createRelSql, createRelParams] = txClient.query.mock.calls[7];
    expect(createRelSql).toMatch(/INSERT INTO control_relationships/);
    expect(createRelParams[0]).toBe(DEFENDER.player_id); // controlled
    expect(createRelParams[1]).toBe(ATTACKER.player_id); // controller
    expect(createRelParams[2]).toBe('battle-1'); // source_battle_id

    // releaseOutgoingControl(loser) must run BEFORE applyIncomingControl
    // for the same loser — verified by call order (index 3 then 4).
    const [releaseSql, releaseParams] = txClient.query.mock.calls[3];
    expect(releaseSql).toMatch(/WHERE controller_id = \$1/);
    expect(releaseParams).toEqual([DEFENDER.player_id]);
    const [applySql, applyParams] = txClient.query.mock.calls[4];
    expect(applySql).toMatch(/controlled_since = now\(\)/);
    expect(applyParams[0]).toBe(ATTACKER.player_id); // controllerId
    expect(applyParams[2]).toBe(DEFENDER.player_id); // playerId (the loser)
  });

  it('resolves a defender_win result correctly (winner/loser derived from the absolute outcome, not the caller)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ATTACKER] })
      .mockResolvedValueOnce({ rows: [baseBattleRow()] });

    txClient.query
      .mockResolvedValueOnce({ rows: [{ ...baseBattleRow(), status: 'resolved', winner_id: DEFENDER.player_id, loser_id: ATTACKER.player_id }] })
      .mockResolvedValueOnce({ rows: [{ player_id: DEFENDER.player_id, influence: 115, applied_delta: 15 }] })
      .mockResolvedValueOnce({ rows: [{ player_id: ATTACKER.player_id, influence: 90, applied_delta: -10 }] })
      .mockResolvedValueOnce({ rows: [] }) // releaseOutgoingControl(loser)
      .mockResolvedValueOnce({ rows: [{ player_id: ATTACKER.player_id, is_controlled: true, controller_id: DEFENDER.player_id, controlled_until: new Date() }] }) // applyIncomingControl
      .mockResolvedValueOnce({ rows: [] }) // controlRelationshipRepo.closeAllActiveForController(loser)
      .mockResolvedValueOnce({ rows: [] }) // controlRelationshipRepo.closeActiveForControlled(loser)
      .mockResolvedValueOnce({ rows: [{ control_relationship_id: 'rel-2' }] }) // controlRelationshipRepo.create
      .mockResolvedValueOnce({ rows: [{ log_id: 'log-1' }] })
      .mockResolvedValueOnce({ rows: [{ log_id: 'log-2' }] })
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [{}] });

    const result = baseResult({ outcome: 'defender_win', attacker_final_health: 0, defender_final_health: 30 });
    const response = await postResolve(app, result, sign(result));

    expect(response.status).toBe(200);
    expect(response.body.data.result).toBe('defender_win');
    const [, resolveParams] = txClient.query.mock.calls[0];
    expect(resolveParams).toEqual(['battle-1', DEFENDER.player_id, ATTACKER.player_id, 42, 1, 'resolved']);
  });

  it('Sprint 7 continuation: logs the ACTUAL post-floor delta, not the nominal -10, when the loser\'s Influence is below 10', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ATTACKER] })
      .mockResolvedValueOnce({ rows: [baseBattleRow()] });

    txClient.query
      .mockResolvedValueOnce({ rows: [{ ...baseBattleRow(), status: 'resolved', winner_id: ATTACKER.player_id, loser_id: DEFENDER.player_id, duration_seconds: 42 }] })
      .mockResolvedValueOnce({ rows: [{ player_id: ATTACKER.player_id, influence: 515, rank: 'Citizen', applied_delta: 15 }] })
      .mockResolvedValueOnce({ rows: [{ player_id: DEFENDER.player_id, influence: 0, rank: 'Citizen', applied_delta: -5 }] }) // was at 5, nominal -10 floors to -5
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ player_id: DEFENDER.player_id, is_controlled: true, controller_id: ATTACKER.player_id, controlled_until: new Date() }] })
      .mockResolvedValueOnce({ rows: [] }) // controlRelationshipRepo.closeAllActiveForController(loser)
      .mockResolvedValueOnce({ rows: [] }) // controlRelationshipRepo.closeActiveForControlled(loser)
      .mockResolvedValueOnce({ rows: [{ control_relationship_id: 'rel-3' }] }) // controlRelationshipRepo.create
      .mockResolvedValueOnce({ rows: [{ log_id: 'log-1' }] })
      .mockResolvedValueOnce({ rows: [{ log_id: 'log-2' }] })
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [{}] });

    const result = baseResult();
    const response = await postResolve(app, result, sign(result));

    expect(response.status).toBe(200);
    expect(response.body.data.loser_influence).toBe(0);

    const [, loserLogParams] = txClient.query.mock.calls[9];
    // delta = -5 (actual applied), nominalDelta = -10 (the env constant)
    expect(loserLogParams).toEqual([DEFENDER.player_id, -5, 'battle_loss', 'battle-1', -10]);
  });

  it('Sprint 7 continuation: when the LOSER was themselves controlling other players, those outgoing relationships are released before the new incoming one is applied', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ATTACKER] })
      .mockResolvedValueOnce({ rows: [baseBattleRow()] });

    txClient.query
      .mockResolvedValueOnce({ rows: [{ ...baseBattleRow(), status: 'resolved', winner_id: ATTACKER.player_id, loser_id: DEFENDER.player_id, duration_seconds: 42 }] })
      .mockResolvedValueOnce({ rows: [{ player_id: ATTACKER.player_id, influence: 515, rank: 'Citizen', applied_delta: 15 }] })
      .mockResolvedValueOnce({ rows: [{ player_id: DEFENDER.player_id, influence: 490, rank: 'Citizen', applied_delta: -10 }] })
      // DEFENDER (the loser) was controlling two other players — both must
      // be freed by this call, which runs BEFORE applyIncomingControl.
      .mockResolvedValueOnce({ rows: [{ player_id: 'thrall-1' }, { player_id: 'thrall-2' }] })
      .mockResolvedValueOnce({ rows: [{ player_id: DEFENDER.player_id, is_controlled: true, controller_id: ATTACKER.player_id, controlled_until: new Date() }] })
      .mockResolvedValueOnce({ rows: [{ player_id: 'thrall-1' }, { player_id: 'thrall-2' }] }) // controlRelationshipRepo.closeAllActiveForController(loser)
      .mockResolvedValueOnce({ rows: [] }) // controlRelationshipRepo.closeActiveForControlled(loser)
      .mockResolvedValueOnce({ rows: [{ control_relationship_id: 'rel-4' }] }) // controlRelationshipRepo.create
      .mockResolvedValueOnce({ rows: [{ log_id: 'log-1' }] })
      .mockResolvedValueOnce({ rows: [{ log_id: 'log-2' }] })
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [{}] });

    const result = baseResult();
    const response = await postResolve(app, result, sign(result));

    expect(response.status).toBe(200);

    const [releaseSql, releaseParams] = txClient.query.mock.calls[3];
    expect(releaseSql).toMatch(/WHERE controller_id = \$1/);
    expect(releaseParams).toEqual([DEFENDER.player_id]); // release everyone DEFENDER was controlling

    const [applySql, applyParams] = txClient.query.mock.calls[4];
    expect(applySql).toMatch(/controlled_since = now\(\)/);
    expect(applyParams[2]).toBe(DEFENDER.player_id); // THEN apply the new incoming control to DEFENDER

    // Both writes ran inside the same withTransaction call (one db.withTransaction invocation).
    expect(db.withTransaction).toHaveBeenCalledTimes(1);
  });

  it('Sprint 7 continuation: a training battle grants no Influence/Control despite a decisive outcome', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ATTACKER] })
      .mockResolvedValueOnce({ rows: [baseBattleRow({ battle_type: 'training' })] });

    txClient.query.mockResolvedValueOnce({
      rows: [{ ...baseBattleRow(), status: 'resolved', winner_id: ATTACKER.player_id, loser_id: DEFENDER.player_id, duration_seconds: 42, battle_type: 'training' }],
    });

    const result = baseResult();
    const response = await postResolve(app, result, sign(result));

    expect(response.status).toBe(200);
    expect(response.body.data.result).toBe('attacker_win');
    expect(response.body.data.winner_influence).toBeNull();
    expect(response.body.data.loser_influence).toBeNull();
    expect(response.body.data.loser_controlled_until).toBeNull();
    // Only the one resolve UPDATE ran — no Influence/Control/log/unlock writes.
    expect(txClient.query).toHaveBeenCalledTimes(1);
  });

  it('resolves a draw: no Influence change, no Control write, no influence_log rows', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ATTACKER] })
      .mockResolvedValueOnce({ rows: [baseBattleRow()] });

    txClient.query.mockResolvedValueOnce({
      rows: [{ ...baseBattleRow(), status: 'resolved', winner_id: null, loser_id: null, duration_seconds: 120 }],
    });

    const result = baseResult({ outcome: 'draw', attacker_final_health: 45, defender_final_health: 46, duration_seconds: 120 });
    const response = await postResolve(app, result, sign(result));

    expect(response.status).toBe(200);
    expect(response.body.data.result).toBe('draw');
    expect(response.body.data.winner_influence).toBeNull();
    expect(response.body.data.loser_influence).toBeNull();
    expect(response.body.data.loser_controlled_until).toBeNull();
    expect(txClient.query).toHaveBeenCalledTimes(1);
  });

  it('marks a suspiciously fast decisive result pending_review and grants no Influence/Control (Alpha security mode)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ATTACKER] })
      .mockResolvedValueOnce({ rows: [baseBattleRow()] });

    txClient.query.mockResolvedValueOnce({
      rows: [{ ...baseBattleRow(), status: 'pending_review', winner_id: ATTACKER.player_id, loser_id: DEFENDER.player_id, duration_seconds: 1 }],
    });

    // RESULT_SUSPICIOUS_MIN_DURATION_SECONDS defaults to 2 — 1s is
    // implausibly fast for a decisive kill, but not impossible outright,
    // so it must be provisional (pending_review), not a hard rejection.
    const result = baseResult({ duration_seconds: 1 });
    const response = await postResolve(app, result, sign(result));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.result).toBe('pending_review');
    expect(response.body.data.winner_influence).toBeNull();
    expect(response.body.data.loser_influence).toBeNull();
    expect(response.body.data.loser_controlled_until).toBeNull();

    // Recorded so it can never be replayed, but no Influence/Control
    // writes ran — the transaction only opened the one resolve UPDATE.
    expect(txClient.query).toHaveBeenCalledTimes(1);
    const [resolveSql, resolveParams] = txClient.query.mock.calls[0];
    expect(resolveSql).toMatch(/UPDATE battles/);
    expect(resolveParams).toEqual(['battle-1', ATTACKER.player_id, DEFENDER.player_id, 1, 1, 'pending_review']);
  });

  it('marks a result with implausibly high (but not hard-capped) final health pending_review', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ATTACKER] })
      .mockResolvedValueOnce({ rows: [baseBattleRow()] });

    txClient.query.mockResolvedValueOnce({
      rows: [{ ...baseBattleRow(), status: 'pending_review', winner_id: ATTACKER.player_id, loser_id: DEFENDER.player_id }],
    });

    // 200 is above RESULT_SUSPICIOUS_HEALTH_THRESHOLD (160, itself above
    // every approved class's MaxHealth) but well under the hard cap (500)
    // — provisional, not an outright rejection.
    const result = baseResult({ attacker_final_health: 200 });
    const response = await postResolve(app, result, sign(result));

    expect(response.status).toBe(200);
    expect(response.body.data.result).toBe('pending_review');
    expect(response.body.data.winner_influence).toBeNull();
    expect(txClient.query).toHaveBeenCalledTimes(1);
  });

  it('marks a result within the suspicious range just under the hard duration cap pending_review', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ATTACKER] })
      .mockResolvedValueOnce({ rows: [baseBattleRow()] });

    txClient.query.mockResolvedValueOnce({
      rows: [{ ...baseBattleRow(), status: 'pending_review', winner_id: ATTACKER.player_id, loser_id: DEFENDER.player_id }],
    });

    // RESULT_SUSPICIOUS_DURATION_SECONDS defaults to 125, hard cap is 130
    // — 127 is under the hard cap so it's not an outright rejection, but
    // close enough to it to warrant review.
    const result = baseResult({ duration_seconds: 127 });
    const response = await postResolve(app, result, sign(result));

    expect(response.status).toBe(200);
    expect(response.body.data.result).toBe('pending_review');
    expect(txClient.query).toHaveBeenCalledTimes(1);
  });

  it('a pending_review battle cannot be resolved a second time (idempotent, same as a resolved battle)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ATTACKER] })
      .mockResolvedValueOnce({ rows: [baseBattleRow({ status: 'pending_review' })] });

    const result = baseResult();
    const response = await postResolve(app, result, sign(result));

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('SESSION_EXPIRED');
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects a forged result from a non-host client with INVALID_SIGNATURE (missing signature)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ATTACKER] })
      .mockResolvedValueOnce({ rows: [baseBattleRow()] });

    const result = baseResult();
    const response = await postResolve(app, result, undefined);

    expect(response.status).toBe(400); // caught by the structural presence check before signature verification
    expect(response.body.error.code).toBe('INVALID_RESOLUTION');
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects a result signed with the wrong secret (INVALID_SIGNATURE)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ATTACKER] })
      .mockResolvedValueOnce({ rows: [baseBattleRow()] });

    const result = baseResult();
    const forgedSignature = sign(result, 'wrong-secret-a-cheating-client-guessed');
    const response = await postResolve(app, result, forgedSignature);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('INVALID_SIGNATURE');
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects a result whose fields were tampered with after signing (signature no longer matches)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ATTACKER] })
      .mockResolvedValueOnce({ rows: [baseBattleRow()] });

    const original = baseResult();
    const validSignature = sign(original);
    // Attacker's client (or a MITM) edits its own final health upward
    // after the host signed the original payload.
    const tampered = { ...original, attacker_final_health: 999 };

    const response = await postResolve(app, tampered, validSignature);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('INVALID_SIGNATURE');
  });

  it('rejects a duplicate/replayed event_seq (DUPLICATE_RESULT)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ATTACKER] })
      .mockResolvedValueOnce({ rows: [baseBattleRow({ last_event_seq: 5 })] });

    const result = baseResult({ event_seq: 5 }); // not strictly greater than last_event_seq
    const response = await postResolve(app, result, sign(result));

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('DUPLICATE_RESULT');
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects an event_seq lower than the last recorded value (stale replay)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ATTACKER] })
      .mockResolvedValueOnce({ rows: [baseBattleRow({ last_event_seq: 10 })] });

    const result = baseResult({ event_seq: 3 });
    const response = await postResolve(app, result, sign(result));

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('DUPLICATE_RESULT');
  });

  it('rejects a result naming the wrong participants (PARTICIPANT_MISMATCH)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ATTACKER] })
      .mockResolvedValueOnce({ rows: [baseBattleRow()] });

    const result = baseResult({ defender_id: 'someone-else-entirely' });
    const response = await postResolve(app, result, sign(result));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('PARTICIPANT_MISMATCH');
  });

  it('rejects a result with a mismatched battle_id (INVALID_RESOLUTION)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ATTACKER] })
      .mockResolvedValueOnce({ rows: [baseBattleRow()] });

    const result = baseResult({ battle_id: 'a-different-battle' });
    const response = await postResolve(app, result, sign(result));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_RESOLUTION');
  });

  it('rejects a result with a mismatched room_name (INVALID_RESOLUTION)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ATTACKER] })
      .mockResolvedValueOnce({ rows: [baseBattleRow()] });

    const result = baseResult({ room_name: 'battle_some-other-room' });
    const response = await postResolve(app, result, sign(result));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_RESOLUTION');
  });

  it('rejects a result signed under a stale rules_version (INVALID_RESOLUTION)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ATTACKER] })
      .mockResolvedValueOnce({ rows: [baseBattleRow({ rules_version: '5.0.0' })] });

    const staleResult = baseResult({ rules_version: '4.0.0' }); // does NOT match the battle's own stored version ('5.0.0')
    const response = await postResolve(app, staleResult, sign(staleResult));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_RESOLUTION');
  });

  it('rejects a result with a stale/mismatched match_nonce (INVALID_RESOLUTION)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ATTACKER] })
      .mockResolvedValueOnce({ rows: [baseBattleRow()] });

    const result = baseResult({ match_nonce: 'a-stale-nonce-from-before-a-reconnect' });
    const response = await postResolve(app, result, sign(result));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_RESOLUTION');
  });

  it('rejects an expired result payload (RESULT_EXPIRED)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ATTACKER] })
      .mockResolvedValueOnce({ rows: [baseBattleRow()] });

    const longAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago > RESULT_MAX_AGE_SECONDS (120s)
    const result = baseResult({ issued_at: longAgo });
    const response = await postResolve(app, result, sign(result));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('RESULT_EXPIRED');
  });

  it('rejects a result issued too far in the future beyond clock-skew tolerance (RESULT_EXPIRED)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ATTACKER] })
      .mockResolvedValueOnce({ rows: [baseBattleRow()] });

    const farFuture = new Date(Date.now() + 60 * 1000).toISOString(); // 60s ahead > RESULT_MAX_CLOCK_SKEW_SECONDS (15s)
    const result = baseResult({ issued_at: farFuture });
    const response = await postResolve(app, result, sign(result));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('RESULT_EXPIRED');
  });

  it('rejects a contradictory result: outcome "draw" while a combatant is at 0 health (CONTRADICTORY_RESULT)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ATTACKER] })
      .mockResolvedValueOnce({ rows: [baseBattleRow()] });

    const result = baseResult({ outcome: 'draw', attacker_final_health: 0, defender_final_health: 40 });
    const response = await postResolve(app, result, sign(result));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('CONTRADICTORY_RESULT');
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects a contradictory result: outcome "attacker_win" while the attacker is at 0 health (CONTRADICTORY_RESULT)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ATTACKER] })
      .mockResolvedValueOnce({ rows: [baseBattleRow()] });

    const result = baseResult({ outcome: 'attacker_win', attacker_final_health: 0, defender_final_health: 0 });
    const response = await postResolve(app, result, sign(result));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('CONTRADICTORY_RESULT');
  });

  it('rejects a contradictory result: outcome "defender_win" while the defender is at 0 health (CONTRADICTORY_RESULT)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ATTACKER] })
      .mockResolvedValueOnce({ rows: [baseBattleRow()] });

    const result = baseResult({ outcome: 'defender_win', attacker_final_health: 20, defender_final_health: 0 });
    const response = await postResolve(app, result, sign(result));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('CONTRADICTORY_RESULT');
  });

  it('rejects an implausible duration_seconds beyond the anomaly bound (INVALID_RESOLUTION)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ATTACKER] })
      .mockResolvedValueOnce({ rows: [baseBattleRow()] });

    const result = baseResult({ duration_seconds: 99999 });
    const response = await postResolve(app, result, sign(result));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_RESOLUTION');
  });

  it('rejects an implausible final-health value beyond the anomaly bound (INVALID_RESOLUTION)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ATTACKER] })
      .mockResolvedValueOnce({ rows: [baseBattleRow()] });

    const result = baseResult({ attacker_final_health: 999999 });
    const response = await postResolve(app, result, sign(result));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_RESOLUTION');
  });

  it('rejects an unrecognized outcome value (INVALID_RESOLUTION)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ATTACKER] })
      .mockResolvedValueOnce({ rows: [baseBattleRow()] });

    const result = baseResult({ outcome: 'victory_royale' });
    const response = await postResolve(app, result, sign(result));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_RESOLUTION');
  });

  it('rejects a missing required field in the result payload (INVALID_RESOLUTION)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ATTACKER] })
      .mockResolvedValueOnce({ rows: [baseBattleRow()] });

    const result = baseResult();
    delete result.event_seq;
    const response = await postResolve(app, result, sign({ ...result, event_seq: undefined }));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_RESOLUTION');
  });

  it('rejects resolving an already-resolved battle (idempotency — no double-resolve, no transaction opened)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ATTACKER] })
      .mockResolvedValueOnce({ rows: [baseBattleRow({ status: 'resolved', winner_id: ATTACKER.player_id, loser_id: DEFENDER.player_id })] });

    const result = baseResult();
    const response = await postResolve(app, result, sign(result));

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('SESSION_EXPIRED');
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects a duplicate resolve that races past the pre-check — the transactional UPDATE affects zero rows', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ATTACKER] })
      .mockResolvedValueOnce({ rows: [baseBattleRow()] }); // still looks in_progress at read time

    txClient.query.mockResolvedValueOnce({ rows: [] }); // UPDATE ... WHERE status = 'in_progress' matched nothing

    const result = baseResult();
    const response = await postResolve(app, result, sign(result));

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('SESSION_EXPIRED');
    expect(txClient.query).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-participant caller with FORBIDDEN, before signature verification even runs', async () => {
    const stranger = { player_id: 'stranger-id', firebase_uid: 'fb-stranger' };
    verifyIdToken.mockResolvedValue({ uid: stranger.firebase_uid });

    db.query
      .mockResolvedValueOnce({ rows: [stranger] })
      .mockResolvedValueOnce({ rows: [baseBattleRow()] });

    const result = baseResult();
    const response = await postResolve(app, result, sign(result));

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  it('exposes winner_id/loser_id/duration_seconds via GET /battle/{battleId} after resolution, and NEVER exposes host_authority_secret', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ATTACKER] })
      .mockResolvedValueOnce({
        rows: [baseBattleRow({ status: 'resolved', winner_id: ATTACKER.player_id, loser_id: DEFENDER.player_id, duration_seconds: 42 })],
      });

    const response = await request(app)
      .get('/battle/battle-1')
      .set('Authorization', 'Bearer valid-token');

    expect(response.status).toBe(200);
    expect(response.body.data.winner_id).toBe(ATTACKER.player_id);
    expect(response.body.data.loser_id).toBe(DEFENDER.player_id);
    expect(response.body.data.duration_seconds).toBe(42);
    expect(response.body.data.host_authority_secret).toBeUndefined();
    expect(response.body.data.match_nonce).toBeUndefined();
  });
});
