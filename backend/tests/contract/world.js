'use strict';

/**
 * The fake database's world: one consistent set of rows the scenarios
 * start from. Only values business rules depend on are set; every other
 * column comes from the schema (NULL if nullable, else a typed default).
 *
 * Player A (token "uid-a") is the attacker / rescuer; player B ("uid-b") is
 * the defender, Controlled by A after losing, with an open SOS.
 */

const ids = {
  A: '11111111-1111-4111-8111-111111111111',
  B: '22222222-2222-4222-8222-222222222222',
  battle: '33333333-3333-4333-8333-333333333333',
  sos: '44444444-4444-4444-8444-444444444444',
  mission: '55555555-5555-4555-8555-555555555555',
  control: '66666666-6666-4666-8666-666666666666',
  quest: '77777777-7777-4777-8777-777777777777',
  playerQuest: '88888888-8888-4888-8888-888888888888',
  weapon: '99999999-9999-4999-8999-999999999999',
  consumable: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  device: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
};

const HOST_SECRET = 'contract-test-host-secret';

function iso(offsetMs) {
  return new Date(Date.now() + offsetMs).toISOString();
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function baseWorld() {
  const player = (id, uid, username, classType, extra) => ({
    player_id: id, firebase_uid: uid, username, class_type: classType,
    health: 100, max_health: 100, energy: 50, max_energy: 50, influence: 120,
    level: 3, experience: 40, rank: 'Recruit', credits: 250, battle_pass_xp: 30,
    is_controlled: false, is_visible: true,
    last_lat: 52.5978, last_lng: 9.0854, last_location_at: iso(-60 * 1000),
    created_at: iso(-30 * DAY), updated_at: iso(-60 * 1000),
    ...extra,
  });
  return {
    players: [
      player(ids.A, 'uid-a', 'alpha_one', 'Scout', {}),
      player(ids.B, 'uid-b', 'bravo_two', 'Titan', { last_lat: 52.5979, last_lng: 9.0855 }),
    ],
    battles: [{
      battle_id: ids.battle, attacker_id: ids.A, defender_id: ids.B, status: 'in_progress',
      photon_room_name: `battle_${ids.battle}`, started_at: iso(-60 * 1000),
      session_started_at: iso(-60 * 1000), session_expires_at: iso(10 * 60 * 1000),
      attacker_ready: true, defender_ready: true, location_lat: 52.5978, location_lng: 9.0854,
      host_player_id: ids.A, host_authority_secret: HOST_SECRET, match_nonce: 'nonce-1',
      rules_version: 'v1', last_event_seq: 0, battle_type: 'competitive',
    }],
    friendships: [{
      player_id: ids.A, friend_id: ids.B, status: 'accepted',
      created_at: iso(-3 * DAY), accepted_at: iso(-2 * DAY), expires_at: iso(4 * DAY), updated_at: iso(-2 * DAY),
    }],
    control_relationships: [{
      control_relationship_id: ids.control, controller_id: ids.A, controlled_player_id: ids.B,
      source_battle_id: ids.battle, status: 'active', started_at: iso(-HOUR), ends_at: iso(5 * HOUR),
    }],
    sos_requests: [{
      sos_id: ids.sos, player_id: ids.B, status: 'open', control_relationship_id: ids.control,
      created_at: iso(-10 * 60 * 1000),
    }],
    rescue_missions: [{
      mission_id: ids.mission, sos_id: ids.sos, rescuer_id: ids.A, status: 'reserved',
      attempt_number: 1, idempotency_key: 'rescue-accept-1',
      reserved_at: iso(-60 * 1000), reservation_expires_at: iso(4 * 60 * 1000),
      guard_battle_token: 'guard-token-1',
    }],
    items: [
      { item_id: ids.weapon, name: 'Pulse Blade', item_type: 'weapon', rarity: 'common' },
      { item_id: ids.consumable, name: 'Health Kit', item_type: 'consumable', rarity: 'common' },
    ],
    player_inventory: [
      { player_id: ids.A, item_id: ids.weapon, quantity: 1, is_equipped: false },
      { player_id: ids.A, item_id: ids.consumable, quantity: 2, is_equipped: false },
    ],
    quest_definitions: [{
      quest_id: ids.quest, title: 'Win 2 Battles', quest_type: 'daily', goal_type: 'win_battles',
      goal_target: 2, reward_coins: 100, reward_bp_xp: 30,
    }],
    player_quests: [{
      player_quest_id: ids.playerQuest, player_id: ids.A, quest_id: ids.quest, current_progress: 2,
      is_completed: true, is_claimed: false, assigned_at: iso(-HOUR), expires_at: iso(6 * HOUR),
    }],
    player_devices: [{
      device_id: ids.device, player_id: ids.A, device_key: 'device-key-1', fcm_token: 'fcm-token-1',
      platform: 'android', is_active: true,
    }],
    $expressions: { count: 0, total: 0, is_today: true, is_online: true },
  };
}

/**
 * Repository lookups that find nothing unless a scenario says otherwise:
 * "is this pair blocked?" and "does this player already have an active
 * battle?" must be false for any success path.
 */
const DEFAULT_ROW_COUNTS = {
  'friend.isBlockedEitherDirection': 0,
  'battle.findActiveBattleForPlayer': 0,
};

/** Player B lost to A: Controlled by A (needed by SOS and rescue). */
function controlledB(world) {
  Object.assign(world.players[1], {
    is_controlled: true, controller_id: ids.A, controlled_since: iso(-HOUR), controlled_until: iso(5 * HOUR),
  });
}

/** HMAC the backend expects for a host-signed result (same as the client). */
function signResult(result) {
  // eslint-disable-next-line global-require
  return require('../../src/utils/battleResultSignature').signResult(result, HOST_SECRET);
}

module.exports = { ids, baseWorld, signResult, controlledB, iso, DEFAULT_ROW_COUNTS, HOST_SECRET };
