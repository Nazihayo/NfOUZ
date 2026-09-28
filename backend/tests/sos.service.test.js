'use strict';

process.env.NODE_ENV = 'test';

/**
 * Sprint 8 — SOS system. `../src/config/database` is mocked (sequenced
 * query() resolutions, same style as creditsService.test.js); fcm.service,
 * friend.repository and playerDevice.repository are mocked directly for
 * the tests that only care about sos.service's own orchestration
 * (candidate selection, push failure isolation, no-coordinates payloads,
 * multi-round escalation), so each test stays focused on one concern
 * without re-deriving SQL semantics jest.mock already replaces.
 * controlRelationship.repository is NOT mocked as a module — like
 * sos.repository/friend.repository's raw SQL, it goes through the same
 * mocked db.query sequence, since sos.service.js now gets the SOS's
 * control_relationship_id from it rather than deriving a string.
 *
 * Final correction pass updates to this file:
 *   - every "Controlled" player fixture no longer needs controller_id/
 *     controlled_since for identifier derivation (that logic moved to
 *     control_relationships) — isControlActive only needs is_controlled/
 *     controlled_until.
 *   - createSos's call sequence now includes controlRelationshipRepo.
 *     getActiveForPlayer between "no existing open SOS" and the INSERT.
 *   - "Duplicate SOS" duplicate-press tests now also mock
 *     sosRepo.getLatestNotificationRound, and there are new tests for the
 *     multi-round escalation rule itself (round 2 after 15 minutes, no
 *     round beyond 3, no round before 15 minutes has passed).
 */

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  withTransaction: jest.fn(),
  checkConnection: jest.fn(),
  shutdown: jest.fn(),
  pool: { on: jest.fn(), query: jest.fn() },
}));

jest.mock('../src/repositories/friend.repository', () => ({
  getSosNotificationCandidates: jest.fn(),
}));

jest.mock('../src/repositories/playerDevice.repository', () => ({
  getActiveTokens: jest.fn(),
}));

// Sprint 8 Critical Security Patch — assertCanViewSos's one non-owner/
// non-rescuer path. Mocked directly (rather than extending the
// friend.repository mock above, which only exposes
// getSosNotificationCandidates) so this file doesn't need to also fake the
// underlying SQL friend.service.js's real implementation would issue.
jest.mock('../src/services/friend.service', () => ({
  assertEligibleRescueFriendship: jest.fn(),
}));

jest.mock('../src/services/fcm.service', () => ({
  sendSosNotification: jest.fn(),
  sendRescueAcceptedNotification: jest.fn(),
  sendRescueCompletedNotification: jest.fn(),
  sendRescueExpiredNotification: jest.fn(),
  sendToAllDevices: jest.fn(),
}));

const db = require('../src/config/database');
const friendRepo = require('../src/repositories/friend.repository');
const playerDeviceRepo = require('../src/repositories/playerDevice.repository');
const fcmService = require('../src/services/fcm.service');
const env = require('../src/config/env');
const friendService = require('../src/services/friend.service');
const sosService = require('../src/services/sos.service');

function realishSendToAllDevices(tokens, notifyFn) {
  if (!tokens || tokens.length === 0) {
    return Promise.resolve({ success: false, reason: 'no_token' });
  }
  return Promise.all(tokens.map((token) => notifyFn(token))).then((results) => {
    const anySuccess = results.some((r) => r.success);
    const lastFailure = [...results].reverse().find((r) => !r.success);
    return anySuccess ? { success: true } : { success: false, reason: lastFailure ? lastFailure.reason : 'unknown_error' };
  });
}

function controlledPlayer(overrides = {}) {
  return Object.assign(
    {
      player_id: 'A',
      username: 'alice',
      is_controlled: true,
      controlled_until: new Date(Date.now() + 60000),
    },
    overrides
  );
}

const ACTIVE_RELATIONSHIP = { control_relationship_id: 'rel-1', controlled_player_id: 'A', controller_id: 'CTRL-1', status: 'active' };

describe('sos.service (Sprint 8)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fcmService.sendToAllDevices.mockImplementation(realishSendToAllDevices);
  });

  it('SOS Without Control — rejects creating an SOS for a player who is not currently Controlled', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ player_id: 'A', is_controlled: false, controlled_until: null }] }); // getById

    await expect(sosService.createSos('A')).rejects.toMatchObject({ code: 'SOS_REQUIRES_CONTROL' });
    expect(friendRepo.getSosNotificationCandidates).not.toHaveBeenCalled();
  });

  it('Duplicate SOS — a second create for the same player returns the existing open SOS, no new round when none is due yet', async () => {
    const controlled = controlledPlayer();
    const existingOpen = { sos_id: 'sos-1', player_id: 'A', status: 'open' };
    db.query
      .mockResolvedValueOnce({ rows: [controlled] }) // getById
      .mockResolvedValueOnce({ rows: [existingOpen] }) // getOpenSosForPlayer -> already exists
      .mockResolvedValueOnce({ rows: [{ batch_number: 1, notified_at: new Date() }] }); // getLatestNotificationRound -> just sent, not due again

    const result = await sosService.createSos('A');

    expect(result.duplicate).toBe(true);
    expect(result.sos).toEqual(existingOpen);
    expect(result.notified_friend_ids).toEqual([]);
    expect(fcmService.sendSosNotification).not.toHaveBeenCalled();
  });

  it('Duplicate SOS — a concurrent create that loses the unique-index race is treated as a duplicate, not an error', async () => {
    const controlled = controlledPlayer();
    const raceWinner = { sos_id: 'sos-race', player_id: 'A', status: 'open' };
    const uniqueViolation = new Error(
      'duplicate key value violates unique constraint "uniq_sos_open_per_player" or "uniq_sos_per_control_relationship"'
    );
    uniqueViolation.code = '23505';

    db.query
      .mockResolvedValueOnce({ rows: [controlled] }) // getById
      .mockResolvedValueOnce({ rows: [] }) // getOpenSosForPlayer -> none yet, so we try to create
      .mockResolvedValueOnce({ rows: [ACTIVE_RELATIONSHIP] }) // controlRelationshipRepo.getActiveForPlayer
      .mockRejectedValueOnce(uniqueViolation) // createSos INSERT races and loses
      .mockResolvedValueOnce({ rows: [raceWinner] }); // getOpenSosForPlayer again -> the winner's row

    const result = await sosService.createSos('A');

    expect(result.duplicate).toBe(true);
    expect(result.sos).toEqual(raceWinner);
  });

  it('CONTROL_RELATIONSHIP_NOT_FOUND — a data-integrity error, not a silent fabrication, when isControlActive is true but no active relationship row exists', async () => {
    const controlled = controlledPlayer();
    db.query
      .mockResolvedValueOnce({ rows: [controlled] }) // getById
      .mockResolvedValueOnce({ rows: [] }) // getOpenSosForPlayer -> none
      .mockResolvedValueOnce({ rows: [] }); // controlRelationshipRepo.getActiveForPlayer -> none found (drift)

    await expect(sosService.createSos('A')).rejects.toMatchObject({ code: 'CONTROL_RELATIONSHIP_NOT_FOUND' });
  });

  it('Stable Control-relationship identifier — createSos reads the active control_relationships row and inserts its UUID', async () => {
    const controlled = controlledPlayer();
    const created = { sos_id: 'sos-2', player_id: 'A', status: 'open', control_relationship_id: 'rel-1' };
    db.query
      .mockResolvedValueOnce({ rows: [controlled] }) // getById
      .mockResolvedValueOnce({ rows: [] }) // getOpenSosForPlayer -> none
      .mockResolvedValueOnce({ rows: [ACTIVE_RELATIONSHIP] }) // controlRelationshipRepo.getActiveForPlayer
      .mockResolvedValueOnce({ rows: [created] }) // createSos INSERT
      .mockResolvedValue({ rows: [] });

    friendRepo.getSosNotificationCandidates.mockResolvedValueOnce([]);

    const result = await sosService.createSos('A');

    const [, insertParams] = db.query.mock.calls[3];
    expect(insertParams).toEqual(['A', 'rel-1']);
    expect(result.sos.control_relationship_id).toBe('rel-1');
  });

  it('Friendship Age minimum 24 hours — createSos passes env.SOS_FRIENDSHIP_MIN_AGE_HOURS through to candidate selection', async () => {
    const controlled = controlledPlayer();
    const created = { sos_id: 'sos-2b', player_id: 'A', status: 'open' };
    db.query
      .mockResolvedValueOnce({ rows: [controlled] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [ACTIVE_RELATIONSHIP] })
      .mockResolvedValueOnce({ rows: [created] })
      .mockResolvedValue({ rows: [] });

    friendRepo.getSosNotificationCandidates.mockResolvedValueOnce([]);

    await sosService.createSos('A');

    expect(friendRepo.getSosNotificationCandidates).toHaveBeenCalledWith('A', env.SOS_FRIENDSHIP_MIN_AGE_HOURS, expect.any(Date));
  });

  it('Notify up to 10 friends, online-first order preserved as returned by the repository', async () => {
    const controlled = controlledPlayer();
    const created = { sos_id: 'sos-3', player_id: 'A', status: 'open' };
    const candidates = Array.from({ length: 15 }, (_, i) => ({ friend_id: `F${i}`, username: `f${i}` }));

    db.query
      .mockResolvedValueOnce({ rows: [controlled] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [ACTIVE_RELATIONSHIP] })
      .mockResolvedValueOnce({ rows: [created] })
      .mockResolvedValue({ rows: [] }); // every recordNotification call

    friendRepo.getSosNotificationCandidates.mockResolvedValueOnce(candidates);
    playerDeviceRepo.getActiveTokens.mockImplementation(async (playerId) => [`tok-${playerId}`]);
    fcmService.sendSosNotification.mockResolvedValue({ success: true });

    const result = await sosService.createSos('A');

    expect(result.notified_friend_ids).toHaveLength(env.SOS_MAX_NOTIFIED_FRIENDS);
    expect(result.notified_friend_ids).toEqual(candidates.slice(0, env.SOS_MAX_NOTIFIED_FRIENDS).map((c) => c.friend_id));
  });

  it('FCM Failure — push failure must not fail SOS creation, and is recorded as a failed notification in batch 1', async () => {
    const controlled = controlledPlayer();
    const created = { sos_id: 'sos-4', player_id: 'A', status: 'open' };

    db.query
      .mockResolvedValueOnce({ rows: [controlled] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [ACTIVE_RELATIONSHIP] })
      .mockResolvedValueOnce({ rows: [created] })
      .mockResolvedValueOnce({ rows: [{ notification_id: 'notif-1', sos_id: 'sos-4', friend_id: 'F1', batch_number: 1, push_success: false, failure_code: 'FCM_SIMULATED_FAILURE' }] }); // recordNotification

    friendRepo.getSosNotificationCandidates.mockResolvedValueOnce([{ friend_id: 'F1', username: 'friend1' }]);
    playerDeviceRepo.getActiveTokens.mockResolvedValueOnce(['tok-1']);
    fcmService.sendSosNotification.mockResolvedValueOnce({ success: false, reason: 'FCM_SIMULATED_FAILURE' });

    const result = await sosService.createSos('A'); // must resolve, not reject

    expect(result.duplicate).toBe(false);
    expect(result.notified_friend_ids).toEqual(['F1']);
    const [, recordParams] = db.query.mock.calls[4];
    // (sos_id, friend_id, batch_number, push_success, failure_code)
    expect(recordParams[2]).toBe(1); // batch 1 — the initial round
    expect(recordParams[3]).toBe(false);
    expect(recordParams[4]).toBe('FCM_SIMULATED_FAILURE');
  });

  it('FCM Failure — a friend with zero active devices is recorded as no_token, not a thrown error', async () => {
    const controlled = controlledPlayer();
    const created = { sos_id: 'sos-4b', player_id: 'A', status: 'open' };

    db.query
      .mockResolvedValueOnce({ rows: [controlled] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [ACTIVE_RELATIONSHIP] })
      .mockResolvedValueOnce({ rows: [created] })
      .mockResolvedValueOnce({ rows: [{}] }); // recordNotification

    friendRepo.getSosNotificationCandidates.mockResolvedValueOnce([{ friend_id: 'F1', username: 'friend1' }]);
    playerDeviceRepo.getActiveTokens.mockResolvedValueOnce([]); // no registered devices

    const result = await sosService.createSos('A');

    expect(result.notified_friend_ids).toEqual(['F1']);
    expect(fcmService.sendSosNotification).not.toHaveBeenCalled();
    const [, recordParams] = db.query.mock.calls[4];
    expect(recordParams[3]).toBe(false);
    expect(recordParams[4]).toBe('no_token');
  });

  it('No Coordinates In Notification — sos.service never passes anything beyond sosId/requesterUsername to fcmService', async () => {
    const controlled = controlledPlayer({ lat: 1.23, lng: 4.56 });
    const created = { sos_id: 'sos-5', player_id: 'A', status: 'open' };

    db.query
      .mockResolvedValueOnce({ rows: [controlled] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [ACTIVE_RELATIONSHIP] })
      .mockResolvedValueOnce({ rows: [created] })
      .mockResolvedValue({ rows: [] });

    friendRepo.getSosNotificationCandidates.mockResolvedValueOnce([{ friend_id: 'F1', username: 'friend1' }]);
    playerDeviceRepo.getActiveTokens.mockResolvedValueOnce(['tok-1']);
    fcmService.sendSosNotification.mockResolvedValueOnce({ success: true });

    await sosService.createSos('A');

    const [, payload] = fcmService.sendSosNotification.mock.calls[0];
    expect(Object.keys(payload).sort()).toEqual(['requesterUsername', 'sosId']);
  });

  it('Notification round escalation — a duplicate create at least 15 minutes after round 1 triggers round 2', async () => {
    const controlled = controlledPlayer();
    const existingOpen = { sos_id: 'sos-6', player_id: 'A', status: 'open' };
    const sixteenMinutesAgo = new Date(Date.now() - 16 * 60 * 1000);

    db.query
      .mockResolvedValueOnce({ rows: [controlled] }) // getById
      .mockResolvedValueOnce({ rows: [existingOpen] }) // getOpenSosForPlayer
      .mockResolvedValueOnce({ rows: [{ batch_number: 1, notified_at: sixteenMinutesAgo }] }) // getLatestNotificationRound
      .mockResolvedValue({ rows: [] }); // recordNotification

    friendRepo.getSosNotificationCandidates.mockResolvedValueOnce([{ friend_id: 'F1', username: 'friend1' }]);
    playerDeviceRepo.getActiveTokens.mockResolvedValueOnce(['tok-1']);
    fcmService.sendSosNotification.mockResolvedValueOnce({ success: true });

    const result = await sosService.createSos('A');

    expect(result.duplicate).toBe(true);
    expect(result.notified_friend_ids).toEqual(['F1']);
    const [, recordParams] = db.query.mock.calls[3];
    expect(recordParams[2]).toBe(2); // round 2
  });

  it('Notification round escalation — a duplicate create less than 15 minutes after the last round sends nothing', async () => {
    const controlled = controlledPlayer();
    const existingOpen = { sos_id: 'sos-7', player_id: 'A', status: 'open' };
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    db.query
      .mockResolvedValueOnce({ rows: [controlled] })
      .mockResolvedValueOnce({ rows: [existingOpen] })
      .mockResolvedValueOnce({ rows: [{ batch_number: 1, notified_at: fiveMinutesAgo }] });

    const result = await sosService.createSos('A');

    expect(result.notified_friend_ids).toEqual([]);
    expect(friendRepo.getSosNotificationCandidates).not.toHaveBeenCalled();
  });

  it('Notification round escalation — never sends a 4th round even if 15+ minutes have passed since round 3', async () => {
    const controlled = controlledPlayer();
    const existingOpen = { sos_id: 'sos-8', player_id: 'A', status: 'open' };
    const longAgo = new Date(Date.now() - 60 * 60 * 1000);

    db.query
      .mockResolvedValueOnce({ rows: [controlled] })
      .mockResolvedValueOnce({ rows: [existingOpen] })
      .mockResolvedValueOnce({ rows: [{ batch_number: env.SOS_MAX_NOTIFICATION_ROUNDS, notified_at: longAgo }] });

    const result = await sosService.createSos('A');

    expect(result.notified_friend_ids).toEqual([]);
    expect(friendRepo.getSosNotificationCandidates).not.toHaveBeenCalled();
  });

  it('Control Expiry — getById self-heals an open SOS to expired once the target is no longer Controlled', async () => {
    const openSos = { sos_id: 'sos-9', player_id: 'A', status: 'open' };
    const expiredTarget = { player_id: 'A', is_controlled: false, controlled_until: new Date(Date.now() - 1000) };
    const expiredSos = { ...openSos, status: 'expired' };

    db.query
      .mockResolvedValueOnce({ rows: [openSos] }) // sosRepo.getById
      .mockResolvedValueOnce({ rows: [expiredTarget] }) // playerRepo.getById(sos.player_id)
      .mockResolvedValueOnce({ rows: [expiredSos] }); // sosRepo.markExpired

    const result = await sosService.getById('sos-9');

    expect(result.status).toBe('expired');
  });

  // Sprint 8 Critical Security Patch — "Prevent SOS IDOR": GET /sos/:sosId
  // used to hand back the full record to any authenticated caller who knew
  // the sos_id, with no ownership check at all.
  describe('assertCanViewSos (Sprint 8 Critical Security Patch)', () => {
    function sos(overrides = {}) {
      return { sos_id: 'sos-1', player_id: 'TARGET', status: 'open', rescuer_id: null, ...overrides };
    }

    it('Fake SOS ID access — a total stranger is rejected without ever reaching the DB-backed eligibility check being trusted blindly', async () => {
      const err = new Error('not eligible');
      err.code = 'NOT_ELIGIBLE_FRIEND';
      err.statusCode = 403;
      friendService.assertEligibleRescueFriendship.mockRejectedValue(err);

      await expect(sosService.assertCanViewSos(sos(), 'STRANGER')).rejects.toMatchObject({ code: 'NOT_ELIGIBLE_FRIEND' });
    });

    it('the SOS owner may always view it, without even consulting friend eligibility', async () => {
      await sosService.assertCanViewSos(sos(), 'TARGET');
      expect(friendService.assertEligibleRescueFriendship).not.toHaveBeenCalled();
    });

    it('the recorded rescuer (sos.rescuer_id) may view it, without consulting friend eligibility', async () => {
      await sosService.assertCanViewSos(sos({ rescuer_id: 'RESCUER' }), 'RESCUER');
      expect(friendService.assertEligibleRescueFriendship).not.toHaveBeenCalled();
    });

    it('an eligible friend of the owner may view it', async () => {
      friendService.assertEligibleRescueFriendship.mockResolvedValue({ status: 'accepted' });
      await sosService.assertCanViewSos(sos(), 'FRIEND'); // must not throw
      expect(friendService.assertEligibleRescueFriendship).toHaveBeenCalledWith('FRIEND', 'TARGET');
    });

    it('Friendship age bypass — a too-young friendship is rejected the same way acceptMission rejects it', async () => {
      const err = new Error('too new');
      err.code = 'FRIENDSHIP_TOO_NEW';
      friendService.assertEligibleRescueFriendship.mockRejectedValue(err);

      await expect(sosService.assertCanViewSos(sos(), 'NEW_FRIEND')).rejects.toMatchObject({ code: 'FRIENDSHIP_TOO_NEW' });
    });

    it('Block bypass — a blocked relationship is rejected', async () => {
      const err = new Error('blocked');
      err.code = 'PLAYER_BLOCKED';
      friendService.assertEligibleRescueFriendship.mockRejectedValue(err);

      await expect(sosService.assertCanViewSos(sos(), 'BLOCKED_PLAYER')).rejects.toMatchObject({ code: 'PLAYER_BLOCKED' });
    });
  });
});
