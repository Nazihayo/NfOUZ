'use strict';

process.env.NODE_ENV = 'test';

/**
 * Sprint 8 — Friends system. Mirrors the mocking style already used for
 * creditsService.test.js: only `../src/config/database` is mocked (as a
 * sequence of resolved query() calls in call-order), so friend.service.js
 * and friend.repository.js run for real against it — this exercises the
 * actual SQL-building/business-logic code, not a re-implementation of it.
 */

const txClient = { query: jest.fn() };

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  withTransaction: jest.fn(),
  checkConnection: jest.fn(),
  shutdown: jest.fn(),
  pool: { on: jest.fn(), query: jest.fn() },
}));

const db = require('../src/config/database');
const friendService = require('../src/services/friend.service');

describe('friend.service (Sprint 8)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.withTransaction.mockImplementation((fn) => fn(txClient));
  });

  it('Self Friend Request — rejects before touching the database', async () => {
    await expect(friendService.sendFriendRequest('A', 'A')).rejects.toMatchObject({ code: 'INVALID_FRIEND_REQUEST' });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('Duplicate Friend Request — a repeat send from the same sender returns the existing pending row, no second insert', async () => {
    const existingPending = { player_id: 'A', friend_id: 'B', status: 'pending', expires_at: new Date(Date.now() + 1000000) };
    db.query
      .mockResolvedValueOnce({ rows: [{ player_id: 'B' }] }) // getPlayerOrThrow(recipientId)
      .mockResolvedValueOnce({ rows: [] }) // isBlockedEitherDirection
      .mockResolvedValueOnce({ rows: [] }) // deleteIfExpired(senderId, recipientId)
      .mockResolvedValueOnce({ rows: [] }) // deleteIfExpired(recipientId, senderId)
      .mockResolvedValueOnce({ rows: [existingPending] }); // getRelationshipBetween -> already pending, sender-owned

    const result = await friendService.sendFriendRequest('A', 'B');

    expect(result).toEqual(existingPending);
    const insertCalls = db.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO friendships'));
    expect(insertCalls).toHaveLength(0);
  });

  it('Friend Limit — rejects a new request once the sender already has FRIEND_LIMIT accepted friends', async () => {
    const env = require('../src/config/env');
    db.query
      .mockResolvedValueOnce({ rows: [{ player_id: 'B' }] }) // getPlayerOrThrow
      .mockResolvedValueOnce({ rows: [] }) // isBlockedEitherDirection
      .mockResolvedValueOnce({ rows: [] }) // deleteIfExpired x2
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }) // getRelationshipBetween -> nothing yet
      .mockResolvedValueOnce({ rows: [{ count: env.FRIEND_LIMIT }] }); // countAcceptedFriends(sender)

    await expect(friendService.sendFriendRequest('A', 'B')).rejects.toMatchObject({ code: 'FRIEND_LIMIT_REACHED' });
  });

  it('Friend Limit — acceptFriendRequest rejects when EITHER side is already at the limit', async () => {
    const env = require('../src/config/env');
    db.query
      .mockResolvedValueOnce({ rows: [] }) // deleteIfExpired(senderId, recipientId)
      .mockResolvedValueOnce({ rows: [{ player_id: 'B', friend_id: 'A', status: 'pending' }] }) // getPendingRequest
      .mockResolvedValueOnce({ rows: [] }) // isBlockedEitherDirection
      .mockResolvedValueOnce({ rows: [{ count: 3 }] }) // countAcceptedFriends(sender)
      .mockResolvedValueOnce({ rows: [{ count: env.FRIEND_LIMIT }] }); // countAcceptedFriends(recipient) — at cap

    await expect(friendService.acceptFriendRequest('A', 'B')).rejects.toMatchObject({ code: 'FRIEND_LIMIT_REACHED' });
  });

  it('Request Expiry — a stale pending request is self-healed away before a fresh one can be sent', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ player_id: 'B' }] }) // getPlayerOrThrow
      .mockResolvedValueOnce({ rows: [] }) // isBlockedEitherDirection
      .mockResolvedValueOnce({ rows: [{ player_id: 'A', friend_id: 'B', status: 'pending' }] }) // deleteIfExpired(A,B) -> deleted the stale row
      .mockResolvedValueOnce({ rows: [] }) // deleteIfExpired(B,A)
      .mockResolvedValueOnce({ rows: [] }) // getRelationshipBetween -> clean now
      .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // countAcceptedFriends
      .mockResolvedValueOnce({ rows: [{ player_id: 'A', friend_id: 'B', status: 'pending' }] }); // createPendingRequest

    const result = await friendService.sendFriendRequest('A', 'B');
    expect(result.status).toBe('pending');

    const deleteExpiredCalls = db.query.mock.calls.filter(([sql]) => sql.includes('expires_at <= now()'));
    expect(deleteExpiredCalls).toHaveLength(2);
  });

  it('Blocked User — sendFriendRequest is rejected once either party has blocked the other', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ player_id: 'B' }] }) // getPlayerOrThrow
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // isBlockedEitherDirection -> true

    await expect(friendService.sendFriendRequest('A', 'B')).rejects.toMatchObject({ code: 'PLAYER_BLOCKED' });
  });

  it('Blocked User — blockPlayer runs delete-then-insert inside a single transaction', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ player_id: 'B' }] }); // getPlayerOrThrow(blockedId)
    txClient.query
      .mockResolvedValueOnce({ rows: [] }) // DELETE existing relationship
      .mockResolvedValueOnce({ rows: [{ player_id: 'A', friend_id: 'B', status: 'blocked' }] }); // INSERT blocked row

    const result = await friendService.blockPlayer('A', 'B');

    expect(result.status).toBe('blocked');
    expect(db.withTransaction).toHaveBeenCalledTimes(1);
  });

  // Sprint 8 Critical Security Patch — the one gate rescue.service.js#acceptMission
  // and sos.service.js#assertCanViewSos both now enforce server-side (see
  // this function's own doc comment in friend.service.js). Query order is
  // always isBlockedEitherDirection, then getRelationshipBetween — see the
  // function body.
  describe('assertEligibleRescueFriendship (Sprint 8 Critical Security Patch)', () => {
    it('Unauthorized rescue — total strangers (no friendship row at all) are rejected NOT_ELIGIBLE_FRIEND', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }) // isBlockedEitherDirection -> not blocked
        .mockResolvedValueOnce({ rows: [] }); // getRelationshipBetween -> nothing at all

      await expect(friendService.assertEligibleRescueFriendship('RESCUER', 'TARGET')).rejects.toMatchObject({ code: 'NOT_ELIGIBLE_FRIEND' });
    });

    it('a pending (never accepted) request is rejected NOT_ELIGIBLE_FRIEND', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }) // not blocked
        .mockResolvedValueOnce({ rows: [{ player_id: 'RESCUER', friend_id: 'TARGET', status: 'pending', accepted_at: null }] });

      await expect(friendService.assertEligibleRescueFriendship('RESCUER', 'TARGET')).rejects.toMatchObject({ code: 'NOT_ELIGIBLE_FRIEND' });
    });

    it('Friendship age bypass — an accepted friendship younger than SOS_FRIENDSHIP_MIN_AGE_HOURS is rejected FRIENDSHIP_TOO_NEW', async () => {
      db.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
        rows: [{ player_id: 'RESCUER', friend_id: 'TARGET', status: 'accepted', accepted_at: new Date(Date.now() - 60 * 60 * 1000) }], // 1 hour old
      });

      await expect(friendService.assertEligibleRescueFriendship('RESCUER', 'TARGET')).rejects.toMatchObject({ code: 'FRIENDSHIP_TOO_NEW' });
    });

    it('Block bypass — a blocked relationship is rejected PLAYER_BLOCKED before the friendship row is even read', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // isBlockedEitherDirection -> true

      await expect(friendService.assertEligibleRescueFriendship('RESCUER', 'TARGET')).rejects.toMatchObject({ code: 'PLAYER_BLOCKED' });
      expect(db.query).toHaveBeenCalledTimes(1); // never even queries getRelationshipBetween
    });

    it('an accepted friendship older than the minimum age, not blocked, is ELIGIBLE', async () => {
      const env = require('../src/config/env');
      const row = {
        player_id: 'TARGET',
        friend_id: 'RESCUER',
        status: 'accepted',
        accepted_at: new Date(Date.now() - (env.SOS_FRIENDSHIP_MIN_AGE_HOURS + 1) * 60 * 60 * 1000),
      };
      db.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [row] });

      const relationship = await friendService.assertEligibleRescueFriendship('RESCUER', 'TARGET');
      expect(relationship).toEqual(row);
    });

    it('threads a transaction client through to both underlying queries when given one', async () => {
      txClient.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

      await expect(friendService.assertEligibleRescueFriendship('RESCUER', 'TARGET', txClient)).rejects.toMatchObject({ code: 'NOT_ELIGIBLE_FRIEND' });
      expect(txClient.query).toHaveBeenCalledTimes(2);
      expect(db.query).not.toHaveBeenCalled();
    });
  });
});
