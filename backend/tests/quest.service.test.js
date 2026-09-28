'use strict';

process.env.NODE_ENV = 'test';

/**
 * Sprint 9 — Quest System. Every collaborator (`questRepo`, `playerRepo`,
 * `db`) is mocked directly, mirroring inventory.service.test.js/
 * rescue.service.test.js's own convention — real SQL semantics (the
 * expression unique index's ON CONFLICT DO NOTHING, the guarded claim
 * UPDATE, etc.) are exercised for real in verify_sprint9_real.js.
 */

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  withTransaction: jest.fn(),
  checkConnection: jest.fn(),
  shutdown: jest.fn(),
  pool: { on: jest.fn(), query: jest.fn() },
}));

jest.mock('../src/repositories/quest.repository', () => ({
  listDailyQuestDefinitions: jest.fn(),
  assignQuestForToday: jest.fn(),
  getTodayQuestsForPlayer: jest.fn(),
  getPlayerQuestForClaim: jest.fn(),
  recordProgress: jest.fn(),
  claimIfEligible: jest.fn(),
  adjustBattlePassXp: jest.fn(),
}));

jest.mock('../src/repositories/player.repository', () => ({
  getById: jest.fn(),
  adjustCredits: jest.fn(),
}));

const db = require('../src/config/database');
const questRepo = require('../src/repositories/quest.repository');
const playerRepo = require('../src/repositories/player.repository');
const questService = require('../src/services/quest.service');

const txClient = { query: jest.fn() };

function eligibleQuestRow(overrides = {}) {
  return {
    player_quest_id: 'pq-1',
    quest_id: 'q-1',
    current_progress: 2,
    is_completed: true,
    is_claimed: false,
    assigned_at: new Date(),
    expires_at: new Date(Date.now() + 60 * 60 * 1000),
    reward_coins: 100,
    reward_bp_xp: 30,
    is_today: true,
    ...overrides,
  };
}

describe('quest.service (Sprint 9)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.withTransaction.mockImplementation((fn) => fn(txClient));
  });

  describe('assignTodayQuestsIfMissing / getQuests — Daily reset', () => {
    it('Daily reset — assigns every seeded daily quest definition exactly once per call, one insert attempt per definition', async () => {
      questRepo.listDailyQuestDefinitions.mockResolvedValue([
        { quest_id: 'q-1', title: 'Win 2 Battles', goal_type: 'win_battles', goal_target: 2, reward_coins: 100, reward_bp_xp: 30 },
        { quest_id: 'q-2', title: 'Travel 500m', goal_type: 'distance_traveled', goal_target: 500, reward_coins: 50, reward_bp_xp: 0 },
      ]);
      questRepo.assignQuestForToday.mockResolvedValue(null); // already exists — ON CONFLICT DO NOTHING no-op both times
      questRepo.getTodayQuestsForPlayer.mockResolvedValue([]);
      playerRepo.getById.mockResolvedValue({ player_id: 'P1', battle_pass_xp: 40 });

      const result = await questService.getQuests('P1');

      expect(questRepo.assignQuestForToday).toHaveBeenCalledTimes(2);
      expect(questRepo.assignQuestForToday).toHaveBeenCalledWith('P1', 'q-1', expect.any(Date));
      expect(questRepo.assignQuestForToday).toHaveBeenCalledWith('P1', 'q-2', expect.any(Date));
      expect(result.battle_pass_xp).toBe(40);
    });

    it('a second call the same day does not duplicate rows — assignQuestForToday is still called (the atomic guard is what prevents duplicates, not an app-level skip)', async () => {
      questRepo.listDailyQuestDefinitions.mockResolvedValue([{ quest_id: 'q-1', title: 'Win 2 Battles', goal_type: 'win_battles', goal_target: 2, reward_coins: 100, reward_bp_xp: 30 }]);
      questRepo.assignQuestForToday.mockResolvedValueOnce({ player_quest_id: 'pq-1' }).mockResolvedValueOnce(null);
      questRepo.getTodayQuestsForPlayer.mockResolvedValue([]);
      playerRepo.getById.mockResolvedValue({ player_id: 'P1', battle_pass_xp: 0 });

      await questService.getQuests('P1');
      await questService.getQuests('P1');

      expect(questRepo.assignQuestForToday).toHaveBeenCalledTimes(2); // once per getQuests call, each a harmless no-op at the DB level the 2nd time
    });

    it('Quest completion — GET /quests surfaces a completed-but-unclaimed quest', async () => {
      questRepo.listDailyQuestDefinitions.mockResolvedValue([]);
      questRepo.getTodayQuestsForPlayer.mockResolvedValue([
        { player_quest_id: 'pq-1', quest_id: 'q-1', title: 'Win 2 Battles', goal_type: 'win_battles', goal_target: 2, current_progress: 2, is_completed: true, is_claimed: false, reward_coins: 100, reward_bp_xp: 30, expires_at: new Date() },
      ]);
      playerRepo.getById.mockResolvedValue({ player_id: 'P1', battle_pass_xp: 0 });

      const result = await questService.getQuests('P1');

      expect(result.quests[0].is_completed).toBe(true);
      expect(result.quests[0].is_claimed).toBe(false);
    });
  });

  describe('claimQuest', () => {
    it('Reward grants — a completed, unclaimed, today-assigned quest grants Credits + Battle Pass XP transactionally', async () => {
      questRepo.getPlayerQuestForClaim.mockResolvedValue(eligibleQuestRow());
      questRepo.claimIfEligible.mockResolvedValue({ player_quest_id: 'pq-1', is_claimed: true });
      questRepo.adjustBattlePassXp.mockResolvedValue({ player_id: 'P1', battle_pass_xp: 130 });

      const result = await questService.claimQuest('P1', 'q-1', 'req-1');

      expect(result).toEqual({ quest_id: 'q-1', already_claimed: false, reward_coins: 100, reward_bp_xp: 30, battle_pass_xp: 130 });
      expect(playerRepo.adjustCredits).toHaveBeenCalledWith('P1', 100, txClient);
      expect(questRepo.adjustBattlePassXp).toHaveBeenCalledWith('P1', 30, txClient);
    });

    it('Battle Pass XP — the exact reward_bp_xp seeded for the quest is what gets added, nothing else', async () => {
      questRepo.getPlayerQuestForClaim.mockResolvedValue(eligibleQuestRow({ reward_bp_xp: 25, reward_coins: 150 }));
      questRepo.claimIfEligible.mockResolvedValue({ player_quest_id: 'pq-1', is_claimed: true });
      questRepo.adjustBattlePassXp.mockResolvedValue({ player_id: 'P1', battle_pass_xp: 25 });

      await questService.claimQuest('P1', 'q-1', 'req-1');

      expect(questRepo.adjustBattlePassXp).toHaveBeenCalledWith('P1', 25, txClient);
      expect(playerRepo.adjustCredits).toHaveBeenCalledWith('P1', 150, txClient);
    });

    it('Duplicate reward claim — claiming an already-claimed quest again grants nothing a second time', async () => {
      questRepo.getPlayerQuestForClaim.mockResolvedValue(eligibleQuestRow());
      questRepo.claimIfEligible.mockResolvedValue(null); // the atomic is_claimed guard lost the race / already claimed

      const result = await questService.claimQuest('P1', 'q-1', 'req-1');

      expect(result).toEqual({ quest_id: 'q-1', already_claimed: true, reward_coins: 0, reward_bp_xp: 0 });
      expect(playerRepo.adjustCredits).not.toHaveBeenCalled();
      expect(questRepo.adjustBattlePassXp).not.toHaveBeenCalled();
    });

    it('Expired quest — rejects claiming a quest whose expires_at has already passed', async () => {
      questRepo.getPlayerQuestForClaim.mockResolvedValue(eligibleQuestRow({ expires_at: new Date(Date.now() - 1000) }));

      await expect(questService.claimQuest('P1', 'q-1', 'req-1')).rejects.toMatchObject({ code: 'QUEST_EXPIRED' });
      expect(questRepo.claimIfEligible).not.toHaveBeenCalled();
    });

    it('Expired quest — rejects claiming a quest that is not assigned for today (a stale/yesterday row)', async () => {
      questRepo.getPlayerQuestForClaim.mockResolvedValue(eligibleQuestRow({ is_today: false }));

      await expect(questService.claimQuest('P1', 'q-1', 'req-1')).rejects.toMatchObject({ code: 'QUEST_EXPIRED' });
    });

    it('rejects claiming a quest that has not been completed yet', async () => {
      questRepo.getPlayerQuestForClaim.mockResolvedValue(eligibleQuestRow({ is_completed: false }));

      await expect(questService.claimQuest('P1', 'q-1', 'req-1')).rejects.toMatchObject({ code: 'QUEST_NOT_COMPLETED' });
      expect(questRepo.claimIfEligible).not.toHaveBeenCalled();
    });

    it('rejects claiming a quest that does not exist for this player', async () => {
      questRepo.getPlayerQuestForClaim.mockResolvedValue(null);
      await expect(questService.claimQuest('P1', 'q-missing', 'req-1')).rejects.toMatchObject({ code: 'QUEST_NOT_FOUND' });
    });

    it('rejects a missing request_id before touching any repository', async () => {
      await expect(questService.claimQuest('P1', 'q-1', undefined)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      expect(questRepo.getPlayerQuestForClaim).not.toHaveBeenCalled();
    });

    it('Transaction rollback — a mid-transaction failure propagates and no reward is left half-granted', async () => {
      questRepo.getPlayerQuestForClaim.mockResolvedValue(eligibleQuestRow());
      db.withTransaction.mockImplementation(async () => {
        throw new Error('SIMULATED_MID_TRANSACTION_FAILURE');
      });

      await expect(questService.claimQuest('P1', 'q-1', 'req-1')).rejects.toThrow('SIMULATED_MID_TRANSACTION_FAILURE');
      expect(playerRepo.adjustCredits).not.toHaveBeenCalled();
    });
  });

  describe('recordProgress — no client-reported progress trusted', () => {
    it('never throws, even when the repository call fails', async () => {
      questRepo.recordProgress.mockRejectedValue(new Error('DB_DOWN'));
      await expect(questService.recordProgress('P1', 'win_battles', 1)).resolves.toBeUndefined();
    });

    it('no-ops for a non-numeric/zero/negative amount without touching the repository', async () => {
      await questService.recordProgress('P1', 'win_battles', 'not-a-number');
      await questService.recordProgress('P1', 'win_battles', 0);
      await questService.recordProgress('P1', 'win_battles', -5);
      expect(questRepo.recordProgress).not.toHaveBeenCalled();
    });

    it('calls the repository with the exact goal_type and amount given', async () => {
      questRepo.recordProgress.mockResolvedValue({ player_quest_id: 'pq-1' });
      await questService.recordProgress('P1', 'distance_traveled', 12.5);
      expect(questRepo.recordProgress).toHaveBeenCalledWith('P1', 'distance_traveled', 12.5);
    });
  });
});
