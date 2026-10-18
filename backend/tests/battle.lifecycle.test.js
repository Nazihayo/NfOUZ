'use strict';

process.env.NODE_ENV = 'test';

/**
 * Battle lifecycle wiring (database-free): the limits come from existing
 * settings, and the stale-battle cleanup runs before every check that
 * could otherwise block a player forever. The SQL itself is tested
 * against real PostgreSQL in tests/contract/db/battleLifecycle.dbtest.js.
 */

jest.mock('../src/repositories/battle.repository', () => ({
  expireStaleBattles: jest.fn().mockResolvedValue([]),
  findActiveBattleForPlayer: jest.fn().mockResolvedValue(null),
  getById: jest.fn(),
  createBattle: jest.fn(),
  clearDisconnect: jest.fn(),
}));
jest.mock('../src/repositories/player.repository', () => ({
  getById: jest.fn(),
  clearExpiredControl: jest.fn().mockResolvedValue(null),
  isControlActive: jest.fn().mockReturnValue(false),
  isProtected: jest.fn().mockReturnValue(false),
}));

const battleRepo = require('../src/repositories/battle.repository');
const playerRepo = require('../src/repositories/player.repository');
const battleService = require('../src/services/battle.service');
const { battleLifecycleLimits } = require('../src/utils/battleLifecycle');

const LIMITS = { readyTimeoutSeconds: 30, noResultCutoffSeconds: 298 };

describe('battle lifecycle wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    battleRepo.expireStaleBattles.mockResolvedValue([]);
    battleRepo.findActiveBattleForPlayer.mockResolvedValue(null);
  });

  test('limits are derived only from the existing settings', () => {
    expect(battleLifecycleLimits()).toEqual(LIMITS);
    expect(battleLifecycleLimits({
      BATTLE_READY_TIMEOUT_SECONDS: 10, BATTLE_COUNTDOWN_SECONDS: 1, RESULT_MAX_DURATION_SECONDS: 100,
      RESULT_MAX_AGE_SECONDS: 50, RESULT_MAX_CLOCK_SKEW_SECONDS: 5,
    })).toEqual({ readyTimeoutSeconds: 10, noResultCutoffSeconds: 166 });
  });

  test('a challenge ends both players\' stale battles before the duplicate check', async () => {
    playerRepo.getById.mockImplementation(async (id) => ({ player_id: id }));
    battleRepo.createBattle.mockImplementation(async (b) => ({ battle_id: b.battleId }));
    const order = [];
    battleRepo.expireStaleBattles.mockImplementation(async () => { order.push('expire'); return []; });
    battleRepo.findActiveBattleForPlayer.mockImplementation(async () => { order.push('lookup'); return null; });

    await battleService.createChallenge('p-a', 'p-b', null);

    expect(battleRepo.expireStaleBattles).toHaveBeenCalledWith({ playerIds: ['p-a', 'p-b'] }, LIMITS);
    expect(order).toEqual(['expire', 'lookup', 'lookup']);
  });

  test('every battle endpoint sees the battle after the cleanup', async () => {
    battleRepo.getById.mockResolvedValue({ battle_id: 'b-1', status: 'cancelled', attacker_id: 'p-a', defender_id: 'p-b' });

    await expect(battleService.setReady('b-1', 'p-a')).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(battleRepo.expireStaleBattles).toHaveBeenCalledWith({ battleId: 'b-1' }, LIMITS);
  });

  test('a reconnect after the caller\'s own forfeit still answers RECONNECT_WINDOW_EXPIRED', async () => {
    battleRepo.getById.mockResolvedValue({ battle_id: 'b-1', status: 'forfeited', forfeited_by: 'p-b', attacker_id: 'p-a', defender_id: 'p-b' });

    await expect(battleService.handleReconnect('b-1', 'p-b')).rejects.toMatchObject({ code: 'RECONNECT_WINDOW_EXPIRED' });
    await expect(battleService.handleReconnect('b-1', 'p-a')).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });
});
