'use strict';

process.env.NODE_ENV = 'test';

/**
 * Sprint 9 — Inventory System. Every collaborator (`inventoryRepo`,
 * `battleRepo`, `db`) is mocked directly so each test isolates exactly one
 * piece of inventory.service.js's own control flow, the same convention
 * rescue.service.test.js uses — real SQL semantics (the idempotency
 * table's UNIQUE constraint, the `quantity > 0` atomic guard, etc.) are
 * exercised for real in the non-Jest execution proof
 * (verify_sprint9_real.js), not re-derived here.
 */

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  withTransaction: jest.fn(),
  checkConnection: jest.fn(),
  shutdown: jest.fn(),
  pool: { on: jest.fn(), query: jest.fn() },
}));

jest.mock('../src/repositories/inventory.repository', () => ({
  getItemByKey: jest.fn(),
  listInventory: jest.fn(),
  getInventoryRow: jest.fn(),
  unequipCurrentWeapon: jest.fn(),
  equipWeapon: jest.fn(),
  decrementConsumable: jest.fn(),
  claimIdempotencyKey: jest.fn(),
  getIdempotencyResult: jest.fn(),
  completeIdempotencyKey: jest.fn(),
}));

jest.mock('../src/repositories/battle.repository', () => ({
  findActiveBattleForPlayer: jest.fn(),
}));

const db = require('../src/config/database');
const inventoryRepo = require('../src/repositories/inventory.repository');
const battleRepo = require('../src/repositories/battle.repository');
const inventoryService = require('../src/services/inventory.service');

const txClient = { query: jest.fn() };

const WEAPON = { item_id: 'item-weapon-1', name: 'Pulse Blade', item_type: 'weapon', rarity: 'common' };
const CONSUMABLE = { item_id: 'item-consumable-1', name: 'Health Kit', item_type: 'consumable', rarity: 'common' };

describe('inventory.service (Sprint 9)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.withTransaction.mockImplementation((fn) => fn(txClient));
    battleRepo.findActiveBattleForPlayer.mockResolvedValue(null); // no active battle by default
    inventoryRepo.claimIdempotencyKey.mockResolvedValue({ idempotency_id: 'idem-1' }); // wins the claim by default
    inventoryRepo.completeIdempotencyKey.mockResolvedValue({});
  });

  describe('equipWeapon', () => {
    it('Equip weapon — succeeds for an owned weapon and atomically unequips the previous one first', async () => {
      inventoryRepo.getItemByKey.mockResolvedValue(WEAPON);
      inventoryRepo.getInventoryRow.mockResolvedValue({ player_id: 'P1', item_id: WEAPON.item_id, quantity: 1, is_equipped: false });
      inventoryRepo.equipWeapon.mockResolvedValue({ player_id: 'P1', item_id: WEAPON.item_id, is_equipped: true });

      const result = await inventoryService.equipWeapon('P1', 'Pulse Blade', 'req-1');

      expect(result).toEqual({ item_key: 'Pulse Blade', equipped: true });
      expect(inventoryRepo.unequipCurrentWeapon).toHaveBeenCalledWith('P1', txClient);
      expect(inventoryRepo.equipWeapon).toHaveBeenCalledWith('P1', WEAPON.item_id, txClient);
      // unequip must run BEFORE equip, inside the same transaction.
      const unequipOrder = inventoryRepo.unequipCurrentWeapon.mock.invocationCallOrder[0];
      const equipOrder = inventoryRepo.equipWeapon.mock.invocationCallOrder[0];
      expect(unequipOrder).toBeLessThan(equipOrder);
    });

    it('Invalid item ownership — rejects equipping a weapon the player does not own', async () => {
      inventoryRepo.getItemByKey.mockResolvedValue(WEAPON);
      inventoryRepo.getInventoryRow.mockResolvedValue(null);

      await expect(inventoryService.equipWeapon('P1', 'Pulse Blade', 'req-1')).rejects.toMatchObject({ code: 'ITEM_NOT_OWNED' });
      expect(inventoryRepo.unequipCurrentWeapon).not.toHaveBeenCalled();
      expect(inventoryRepo.equipWeapon).not.toHaveBeenCalled();
    });

    it('rejects equipping a consumable — service layer never sets is_equipped for a non-weapon item', async () => {
      inventoryRepo.getItemByKey.mockResolvedValue(CONSUMABLE);

      await expect(inventoryService.equipWeapon('P1', 'Health Kit', 'req-1')).rejects.toMatchObject({ code: 'ITEM_NOT_A_WEAPON' });
      expect(inventoryRepo.getInventoryRow).not.toHaveBeenCalled();
      expect(inventoryRepo.equipWeapon).not.toHaveBeenCalled();
    });

    it('rejects an unknown item_key', async () => {
      inventoryRepo.getItemByKey.mockResolvedValue(null);
      await expect(inventoryService.equipWeapon('P1', 'Nonexistent Sword', 'req-1')).rejects.toMatchObject({ code: 'ITEM_NOT_FOUND' });
    });

    it('rejects equip changes during an active battle', async () => {
      inventoryRepo.getItemByKey.mockResolvedValue(WEAPON);
      battleRepo.findActiveBattleForPlayer.mockResolvedValue({ battle_id: 'b-1', status: 'in_progress' });

      await expect(inventoryService.equipWeapon('P1', 'Pulse Blade', 'req-1')).rejects.toMatchObject({ code: 'ACTIVE_BATTLE_IN_PROGRESS' });
      expect(inventoryRepo.getInventoryRow).not.toHaveBeenCalled();
    });

    it('rejects a missing request_id before touching any repository', async () => {
      await expect(inventoryService.equipWeapon('P1', 'Pulse Blade', undefined)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      expect(inventoryRepo.claimIdempotencyKey).not.toHaveBeenCalled();
    });

    it('Duplicate item use (equip) — a retried request_id returns the prior stored result instead of re-equipping', async () => {
      inventoryRepo.claimIdempotencyKey.mockResolvedValue(null); // lost the claim: already processed
      inventoryRepo.getIdempotencyResult.mockResolvedValue({
        idempotency_id: 'idem-1',
        result_json: JSON.stringify({ item_key: 'Pulse Blade', equipped: true }),
      });

      const result = await inventoryService.equipWeapon('P1', 'Pulse Blade', 'req-1');

      expect(result).toEqual({ item_key: 'Pulse Blade', equipped: true, idempotent: true });
      expect(inventoryRepo.getItemByKey).not.toHaveBeenCalled();
      expect(inventoryRepo.equipWeapon).not.toHaveBeenCalled();
    });
  });

  describe('useConsumable', () => {
    it('Consumable usage — succeeds and decrements quantity by exactly one', async () => {
      inventoryRepo.getItemByKey.mockResolvedValue(CONSUMABLE);
      inventoryRepo.decrementConsumable.mockResolvedValue({ player_id: 'P1', item_id: CONSUMABLE.item_id, quantity: 2 });

      const result = await inventoryService.useConsumable('P1', 'Health Kit', 'req-2');

      expect(result).toEqual({ item_key: 'Health Kit', used: true, remaining_quantity: 2 });
      expect(inventoryRepo.decrementConsumable).toHaveBeenCalledWith('P1', CONSUMABLE.item_id, txClient);
    });

    it('rejects using a weapon as a consumable', async () => {
      inventoryRepo.getItemByKey.mockResolvedValue(WEAPON);
      await expect(inventoryService.useConsumable('P1', 'Pulse Blade', 'req-2')).rejects.toMatchObject({ code: 'ITEM_NOT_CONSUMABLE' });
      expect(inventoryRepo.decrementConsumable).not.toHaveBeenCalled();
    });

    it('Consumable during battle — rejects using a consumable while an active battle is in progress', async () => {
      inventoryRepo.getItemByKey.mockResolvedValue(CONSUMABLE);
      battleRepo.findActiveBattleForPlayer.mockResolvedValue({ battle_id: 'b-1', status: 'in_progress' });

      await expect(inventoryService.useConsumable('P1', 'Health Kit', 'req-2')).rejects.toMatchObject({ code: 'ACTIVE_BATTLE_IN_PROGRESS' });
      expect(inventoryRepo.decrementConsumable).not.toHaveBeenCalled();
    });

    it('rejects using an item the player owns none of (quantity guard returns null)', async () => {
      inventoryRepo.getItemByKey.mockResolvedValue(CONSUMABLE);
      inventoryRepo.decrementConsumable.mockResolvedValue(null);

      await expect(inventoryService.useConsumable('P1', 'Health Kit', 'req-2')).rejects.toMatchObject({ code: 'ITEM_NOT_OWNED' });
    });

    it('Duplicate item use — a retried request_id returns the prior stored result instead of double-decrementing', async () => {
      inventoryRepo.claimIdempotencyKey.mockResolvedValue(null);
      inventoryRepo.getIdempotencyResult.mockResolvedValue({
        idempotency_id: 'idem-2',
        result_json: JSON.stringify({ item_key: 'Health Kit', used: true, remaining_quantity: 2 }),
      });

      const result = await inventoryService.useConsumable('P1', 'Health Kit', 'req-2');

      expect(result).toEqual({ item_key: 'Health Kit', used: true, remaining_quantity: 2, idempotent: true });
      expect(inventoryRepo.decrementConsumable).not.toHaveBeenCalled();
    });
  });

  describe('listInventory', () => {
    it('lists owned items and the currently equipped weapon', async () => {
      inventoryRepo.listInventory.mockResolvedValue([
        { name: 'Pulse Blade', item_type: 'weapon', rarity: 'common', quantity: 1, is_equipped: true },
        { name: 'Health Kit', item_type: 'consumable', rarity: 'common', quantity: 3, is_equipped: false },
      ]);

      const result = await inventoryService.listInventory('P1');

      expect(result.equipped_weapon).toBe('Pulse Blade');
      expect(result.items).toHaveLength(2);
    });
  });
});
