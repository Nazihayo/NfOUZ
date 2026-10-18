'use strict';

process.env.NODE_ENV = 'test';

/**
 * Battle lifecycle wiring (database-free): the limits come from existing
 * settings, and the stale-battle cleanup runs before every check that
 * could otherwise block a player forever. The SQL itself is tested
 * against real PostgreSQL in tests/contract/db/battleLifecycle.dbtest.js.
 */

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  withTransaction: jest.fn((fn) => fn({ query: jest.fn() })),
}));
jest.mock('../src/repositories/battle.repository', () => ({
  lockPlayersForChallenge: jest.fn().mockResolvedValue(undefined),
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

  test('a challenge locks both players, then ends their stale battles before the duplicate check, in one transaction', async () => {
    playerRepo.getById.mockImplementation(async (id) => ({ player_id: id }));
    battleRepo.createBattle.mockImplementation(async (b) => ({ battle_id: b.battleId }));
    const order = [];
    battleRepo.lockPlayersForChallenge.mockImplementation(async () => { order.push('lock'); });
    battleRepo.expireStaleBattles.mockImplementation(async () => { order.push('expire'); return []; });
    battleRepo.findActiveBattleForPlayer.mockImplementation(async () => { order.push('lookup'); return null; });

    await battleService.createChallenge('p-a', 'p-b', null);

    const tx = battleRepo.lockPlayersForChallenge.mock.calls[0][1];
    expect(battleRepo.lockPlayersForChallenge).toHaveBeenCalledWith(['p-a', 'p-b'], tx);
    expect(battleRepo.expireStaleBattles).toHaveBeenCalledWith({ playerIds: ['p-a', 'p-b'] }, LIMITS, tx);
    expect(battleRepo.findActiveBattleForPlayer).toHaveBeenCalledWith('p-a', tx);
    expect(battleRepo.createBattle.mock.calls[0][1]).toBe(tx);
    expect(order).toEqual(['lock', 'expire', 'lookup', 'lookup']);
  });

  test('every battle endpoint sees the battle after the cleanup', async () => {
    battleRepo.getById.mockResolvedValue({ battle_id: '0b000000-0000-4000-8000-0000000000b1', status: 'cancelled', attacker_id: 'p-a', defender_id: 'p-b' });

    await expect(battleService.setReady('0b000000-0000-4000-8000-0000000000b1', 'p-a')).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(battleRepo.expireStaleBattles).toHaveBeenCalledWith({ battleId: '0b000000-0000-4000-8000-0000000000b1' }, LIMITS);
  });

  test('a reconnect after the caller\'s own forfeit still answers RECONNECT_WINDOW_EXPIRED', async () => {
    battleRepo.getById.mockResolvedValue({ battle_id: '0b000000-0000-4000-8000-0000000000b1', status: 'forfeited', forfeited_by: 'p-b', attacker_id: 'p-a', defender_id: 'p-b' });

    await expect(battleService.handleReconnect('0b000000-0000-4000-8000-0000000000b1', 'p-b')).rejects.toMatchObject({ code: 'RECONNECT_WINDOW_EXPIRED' });
    await expect(battleService.handleReconnect('0b000000-0000-4000-8000-0000000000b1', 'p-a')).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });
});
