'use strict';

/**
 * One success-path scenario per endpoint the Unity client calls, keyed
 * like the extracted call sites ("METHOD /path/{}", {} = a path value).
 * Each says who calls (bearer token), the path values, query/body values
 * (by Unity DTO field name — the body itself is built from the Unity
 * request DTO), and how the shared world (world.js) differs for it.
 *
 * Mode-specific parts (see README "Fake and real modes"):
 *   rowCounts  fake mode only: repository lookups that find nothing (the
 *              fake cannot evaluate WHERE). The real mode checks every
 *              such hint is true in PostgreSQL.
 *   real       real mode only: `expect` — values in the response (exact,
 *              or a predicate); `after` — read-only SELECTs of the state
 *              the call left in the database.
 */

const { ids, signResult, controlledB, iso } = require('./world');

const HOUR_MS = 60 * 60 * 1000;

const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const isIsoTime = (v) => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(v);

/** The base world has an in-progress battle A vs B; inventory changes are refused during a battle. */
function noActiveBattle(w) {
  w.battles[0].status = 'resolved';
}

/** A has challenged B and B has not answered yet (migration 021). */
function pendingChallenge(w) {
  w.battles[0].accepted_at = null;
}

/** A has sent B a friend request that B has not answered yet. */
function pendingFromAToB(w) {
  Object.assign(w.friendships[0], { status: 'pending', accepted_at: null });
}

module.exports = [
  {
    key: 'GET /auth/me',
    as: 'uid-a',
    real: { expect: { player_id: ids.A, credits: 250, influence: 120, controller_id: null, controlled_until: null } },
  },
  {
    key: 'POST /auth/register',
    as: 'uid-new',
    body: { username: 'charlie_3', class_type: 'Ranger' },
    rowCounts: { 'player.getByFirebaseUid': 0, 'player.getByUsername': 0 },
    real: {
      expect: { username: 'charlie_3', class_type: 'Ranger', player_id: isUuid, credits: 0 },
      after: [{
        sql: "SELECT username, class_type FROM players WHERE firebase_uid = 'uid-new'",
        rows: [{ username: 'charlie_3', class_type: 'Ranger' }],
      }],
    },
  },
  {
    key: 'PATCH /player/{}/location',
    as: 'uid-a',
    path: [ids.A],
    body: { lat: 52.5981, lng: 9.0859 },
    real: {
      expect: { last_lat: 52.5981, last_lng: 9.0859 },
      after: [{ sql: 'SELECT last_lat, last_lng FROM players WHERE player_id = $1', params: [ids.A], rows: [{ last_lat: 52.5981, last_lng: 9.0859 }] }],
    },
  },
  {
    key: 'GET /player/nearby',
    as: 'uid-a',
    query: { lat: '52.5978', lng: '9.0854', radius: '1000' },
    // The nearby query has no id parameters, so the fake returns the first
    // player row: put B first so A sees someone other than themselves.
    world: (w) => { w.players.reverse(); },
    // PostgreSQL applies the bounding box and leaves out the caller.
    real: { expect: { 'players.length': 2, 'players.0.player_id': ids.B, 'players.1.player_id': ids.C } },
  },
  {
    key: 'POST /battle/challenge',
    as: 'uid-a',
    body: { defender_id: ids.B },
    world: noActiveBattle,
    real: {
      expect: {
        attacker_id: ids.A, defender_id: ids.B, status: 'in_progress', battle_id: isUuid,
        session_expires_at: isIsoTime, host_authority_secret: (v) => typeof v === 'string' && v.length >= 32,
      },
      after: [{
        sql: "SELECT count(*)::int AS n FROM battles WHERE status = 'in_progress' AND attacker_id = $1 AND defender_id = $2",
        params: [ids.A, ids.B],
        rows: [{ n: 1 }],
      }],
    },
  },
  {
    key: 'GET /battle/{}',
    as: 'uid-a',
    path: [ids.battle],
    real: { expect: { status: 'in_progress', attacker_ready: false, winner_id: null, duration_seconds: null } },
  },
  {
    key: 'GET /battle/incoming',
    as: 'uid-b',
    world: pendingChallenge,
    real: {
      expect: {
        'challenges.length': 1, 'challenges.0.battle_id': ids.battle, 'challenges.0.attacker_id': ids.A,
        'challenges.0.attacker_username': 'alpha_one', 'challenges.0.expires_at': isIsoTime,
      },
    },
  },
  {
    key: 'POST /battle/{}/accept',
    as: 'uid-b',
    path: [ids.battle],
    world: pendingChallenge,
    real: {
      // The room name only: the defender never receives the host secret
      // (ChallengeAnswerData has no such field, so it would fail as extra).
      expect: { challenge_state: 'accepted', status: 'in_progress', photon_room_name: `battle_${ids.battle}`, defender_id: ids.B },
      after: [{ sql: 'SELECT accepted_at IS NOT NULL AS accepted, declined_at IS NULL AS not_declined, status FROM battles WHERE battle_id = $1', params: [ids.battle], rows: [{ accepted: true, not_declined: true, status: 'in_progress' }] }],
    },
  },
  {
    key: 'POST /battle/{}/decline',
    as: 'uid-b',
    path: [ids.battle],
    world: pendingChallenge,
    real: {
      expect: { challenge_state: 'declined', status: 'cancelled' },
      after: [{ sql: 'SELECT declined_at IS NOT NULL AS declined, accepted_at IS NULL AS not_accepted, status FROM battles WHERE battle_id = $1', params: [ids.battle], rows: [{ declined: true, not_accepted: true, status: 'cancelled' }] }],
    },
  },
  {
    key: 'POST /battle/{}/ready',
    as: 'uid-a',
    path: [ids.battle],
    real: {
      expect: { attacker_ready: true, defender_ready: false },
      after: [{ sql: 'SELECT attacker_ready, defender_ready FROM battles WHERE battle_id = $1', params: [ids.battle], rows: [{ attacker_ready: true, defender_ready: false }] }],
    },
  },
  {
    key: 'POST /battle/{}/disconnect',
    as: 'uid-b',
    path: [ids.battle],
    real: {
      after: [{
        sql: 'SELECT defender_disconnected_at IS NOT NULL AS disconnected, defender_reconnect_deadline > now() AS in_grace FROM battles WHERE battle_id = $1',
        params: [ids.battle],
        rows: [{ disconnected: true, in_grace: true }],
      }],
    },
  },
  {
    key: 'POST /battle/{}/reconnect',
    as: 'uid-b',
    path: [ids.battle],
    world: (w) => { Object.assign(w.battles[0], { defender_disconnected_at: iso(-5 * 1000), defender_reconnect_deadline: iso(10 * 1000) }); },
    real: {
      expect: { status: 'in_progress' },
      after: [{ sql: 'SELECT defender_disconnected_at IS NULL AS reconnected FROM battles WHERE battle_id = $1', params: [ids.battle], rows: [{ reconnected: true }] }],
    },
  },
  {
    key: 'POST /battle/{}/resolve',
    as: 'uid-a',
    path: [ids.battle],
    body: () => {
      const result = {
        battle_id: ids.battle, room_name: `battle_${ids.battle}`, rules_version: 'v1', match_nonce: 'nonce-1',
        event_seq: 1, attacker_id: ids.A, defender_id: ids.B, attacker_final_health: 60, defender_final_health: 0,
        outcome: 'attacker_win', duration_seconds: 45, issued_at: new Date().toISOString(),
      };
      return { result, signature: signResult(result) };
    },
    real: {
      // GDD Influence +15 / -10 from 120; the loser becomes Controlled.
      expect: { result: 'attacker_win', winner_influence: 135, loser_influence: 110, loser_controlled_until: isIsoTime },
      after: [
        { sql: 'SELECT status, winner_id, loser_id, duration_seconds FROM battles WHERE battle_id = $1', params: [ids.battle], rows: [{ status: 'resolved', winner_id: ids.A, loser_id: ids.B, duration_seconds: 45 }] },
        { sql: 'SELECT username, influence, is_controlled FROM players WHERE player_id IN ($1, $2) ORDER BY username', params: [ids.A, ids.B], rows: [{ username: 'alpha_one', influence: 135, is_controlled: false }, { username: 'bravo_two', influence: 110, is_controlled: true }] },
      ],
    },
  },
  {
    key: 'GET /friends',
    as: 'uid-a',
    real: { expect: { 'friends.length': 1, 'friends.0.friend_id': ids.B, 'friends.0.username': 'bravo_two' } },
  },
  {
    key: 'GET /friends/requests',
    as: 'uid-b',
    // B has one incoming (from A) and one outgoing (to C) request.
    world: (w) => {
      pendingFromAToB(w);
      w.friendships.push({ player_id: ids.B, friend_id: ids.C, status: 'pending', created_at: iso(-HOUR_MS), expires_at: iso(6 * 24 * HOUR_MS) });
    },
    real: { expect: { 'incoming.length': 1, 'incoming.0.sender_id': ids.A, 'outgoing.length': 1, 'outgoing.0.recipient_id': ids.C } },
  },
  {
    key: 'POST /friends/request',
    as: 'uid-a',
    body: { player_id: ids.B },
    world: (w) => { w.friendships = []; },
    rowCounts: { 'friend.getRelationshipBetween': 0 },
    real: {
      expect: { status: 'pending', player_id: ids.A, friend_id: ids.B, accepted_at: null, expires_at: isIsoTime },
      after: [{ sql: 'SELECT status FROM friendships WHERE player_id = $1 AND friend_id = $2', params: [ids.A, ids.B], rows: [{ status: 'pending' }] }],
    },
  },
  {
    key: 'POST /friends/accept',
    as: 'uid-b',
    body: { player_id: ids.A },
    world: pendingFromAToB,
    real: {
      expect: { status: 'accepted', accepted_at: isIsoTime },
      after: [{ sql: 'SELECT status, accepted_at IS NOT NULL AS has_accepted_at FROM friendships WHERE player_id = $1 AND friend_id = $2', params: [ids.A, ids.B], rows: [{ status: 'accepted', has_accepted_at: true }] }],
    },
  },
  {
    key: 'POST /friends/decline',
    as: 'uid-b',
    body: { player_id: ids.A },
    world: pendingFromAToB,
    real: { expect: { declined: true }, after: [{ sql: 'SELECT count(*)::int AS n FROM friendships', rows: [{ n: 0 }] }] },
  },
  {
    key: 'DELETE /friends/{}',
    as: 'uid-a',
    path: [ids.B],
    real: { expect: { removed: true }, after: [{ sql: 'SELECT count(*)::int AS n FROM friendships', rows: [{ n: 0 }] }] },
  },
  {
    key: 'POST /friends/block',
    as: 'uid-a',
    body: { player_id: ids.B },
    real: {
      expect: { status: 'blocked' },
      after: [{ sql: 'SELECT status FROM friendships WHERE player_id = $1 AND friend_id = $2', params: [ids.A, ids.B], rows: [{ status: 'blocked' }] }],
    },
  },
  {
    key: 'POST /sos',
    as: 'uid-b',
    world: controlledB,
    // B already has an open SOS: the call is idempotent and re-notifies friends.
    real: { expect: { sos_id: ids.sos, status: 'open', duplicate: true, notified_friend_ids: [ids.A] } },
  },
  {
    key: 'GET /sos/{}',
    as: 'uid-b',
    path: [ids.sos],
    world: controlledB,
    real: { expect: { sos_id: ids.sos, player_id: ids.B, status: 'open', rescuer_id: null } },
  },
  {
    key: 'POST /rescue/accept',
    as: 'uid-a',
    body: { sos_id: ids.sos },
    world: (w) => { controlledB(w); w.rescue_missions = []; },
    rowCounts: { 'rescue.getActiveMissionForSos': 0 },
    real: {
      expect: { sos_id: ids.sos, status: 'reserved', mission_id: isUuid, reservation_expires_at: isIsoTime },
      after: [{ sql: 'SELECT rescuer_id, status FROM rescue_missions WHERE sos_id = $1', params: [ids.sos], rows: [{ rescuer_id: ids.A, status: 'reserved' }] }],
    },
  },
  {
    key: 'POST /rescue/{}/guard-battle/start',
    as: 'uid-a',
    path: [ids.mission],
    world: controlledB,
    real: {
      expect: { mission_id: ids.mission, status: 'in_progress', guard_battle_ends_at: isIsoTime, guard_battle_token: (v) => typeof v === 'string' && v.length >= 32 },
      after: [{
        sql: "SELECT status, guard_battle_outcome IN ('success', 'failure') AS outcome_rolled FROM rescue_missions WHERE mission_id = $1",
        params: [ids.mission],
        rows: [{ status: 'in_progress', outcome_rolled: true }],
      }],
    },
  },
  {
    key: 'POST /rescue/{}/guard-battle/resolve',
    as: 'uid-a',
    path: [ids.mission],
    body: { outcome: 'success', guard_battle_token: 'guard-token-1' },
    world: (w) => {
      controlledB(w);
      Object.assign(w.rescue_missions[0], {
        status: 'in_progress', guard_battle_started_at: iso(-30 * 1000), guard_battle_ends_at: iso(60 * 1000),
        // Decided by the server at guard-battle start; the client's report never overrides it.
        guard_battle_outcome: 'success',
      });
    },
    real: {
      expect: { mission_id: ids.mission, status: 'succeeded', rewarded: true },
      after: [
        { sql: 'SELECT status FROM rescue_missions WHERE mission_id = $1', params: [ids.mission], rows: [{ status: 'succeeded' }] },
        { sql: 'SELECT is_controlled FROM players WHERE player_id = $1', params: [ids.B], rows: [{ is_controlled: false }] },
      ],
    },
  },
  {
    key: 'GET /inventory',
    as: 'uid-a',
    real: { expect: { 'items.length': 2, 'items.0.item_key': 'Health Kit', 'items.0.quantity': 2, equipped_weapon: null } },
  },
  {
    key: 'POST /inventory/equip',
    as: 'uid-a',
    body: { item_key: 'Pulse Blade', request_id: 'req-equip-1' },
    world: noActiveBattle,
    real: {
      expect: { item_key: 'Pulse Blade', equipped: true },
      after: [{ sql: 'SELECT is_equipped FROM player_inventory WHERE player_id = $1 AND item_id = $2', params: [ids.A, ids.weapon], rows: [{ is_equipped: true }] }],
    },
  },
  {
    key: 'POST /inventory/use',
    as: 'uid-a',
    body: { item_key: 'Health Kit', request_id: 'req-use-1' },
    world: noActiveBattle,
    real: {
      expect: { item_key: 'Health Kit', used: true, remaining_quantity: 1 },
      after: [{ sql: 'SELECT quantity FROM player_inventory WHERE player_id = $1 AND item_id = $2', params: [ids.A, ids.consumable], rows: [{ quantity: 1 }] }],
    },
  },
  {
    key: 'GET /quests',
    as: 'uid-a',
    // reward_coins is BIGINT: a JSON number only because the service converts it.
    real: { expect: { 'quests.length': 1, 'quests.0.reward_coins': 100, 'quests.0.is_completed': true, battle_pass_xp: 30 } },
  },
  {
    key: 'POST /quests/{}/claim',
    as: 'uid-a',
    path: [ids.quest],
    body: { request_id: 'req-claim-1' },
    real: {
      expect: { already_claimed: false, reward_coins: 100, reward_bp_xp: 30, battle_pass_xp: 60 },
      after: [
        { sql: 'SELECT credits, battle_pass_xp FROM players WHERE player_id = $1', params: [ids.A], rows: [{ credits: 350, battle_pass_xp: 60 }] },
        { sql: 'SELECT is_claimed FROM player_quests WHERE player_quest_id = $1', params: [ids.playerQuest], rows: [{ is_claimed: true }] },
      ],
    },
  },
  {
    key: 'PATCH /player/{}/fcm-token',
    as: 'uid-a',
    path: [ids.A],
    body: { device_key: 'device-key-1', fcm_token: 'fcm-token-2', platform: 'android' },
    real: {
      expect: { device_id: ids.device, is_active: true, platform: 'android' },
      after: [{ sql: 'SELECT fcm_token, is_active FROM player_devices WHERE player_id = $1', params: [ids.A], rows: [{ fcm_token: 'fcm-token-2', is_active: true }] }],
    },
  },
  {
    key: 'POST /player/{}/devices/deactivate',
    as: 'uid-a',
    path: [ids.A],
    body: { device_key: 'device-key-1' },
    real: {
      expect: { device_id: ids.device, is_active: false },
      after: [{ sql: 'SELECT is_active FROM player_devices WHERE player_id = $1', params: [ids.A], rows: [{ is_active: false }] }],
    },
  },
];

/**
 * Error paths, run only by the real-database mode (they depend on WHERE
 * clauses and stored state the fake database does not evaluate). Each
 * sends the Unity call exactly as the client does and checks the HTTP
 * status, the error code and the error envelope.
 */
module.exports.errorScenarios = [
  { name: 'unknown player signs in', key: 'GET /auth/me', as: 'uid-unknown', status: 404, code: 'PLAYER_NOT_FOUND' },
  {
    name: 'registering an already registered account',
    key: 'POST /auth/register', as: 'uid-a', body: { username: 'another_name', class_type: 'Scout' },
    status: 409, code: 'PLAYER_ALREADY_REGISTERED',
  },
  {
    name: 'registering a taken username',
    key: 'POST /auth/register', as: 'uid-new', body: { username: 'bravo_two', class_type: 'Scout' },
    status: 409, code: 'USERNAME_TAKEN',
  },
  {
    name: 'friend request to an existing friend',
    key: 'POST /friends/request', as: 'uid-a', body: { player_id: ids.B }, status: 409, code: 'ALREADY_FRIENDS',
  },
  {
    name: 'friend request to a player who blocked you',
    key: 'POST /friends/request', as: 'uid-a', body: { player_id: ids.B },
    world: (w) => { Object.assign(w.friendships[0], { player_id: ids.B, friend_id: ids.A, status: 'blocked', accepted_at: null }); },
    status: 403, code: 'PLAYER_BLOCKED',
  },
  {
    name: 'accepting a request that does not exist',
    key: 'POST /friends/accept', as: 'uid-b', body: { player_id: ids.C }, status: 404, code: 'FRIEND_REQUEST_NOT_FOUND',
  },
  {
    name: 'challenge while the attacker is already in a battle',
    key: 'POST /battle/challenge', as: 'uid-a', body: { defender_id: ids.C },
    world: (w) => { Object.assign(w.players[2], { last_lat: 52.5978, last_lng: 9.0854 }); },
    status: 409, code: 'DUPLICATE_CHALLENGE',
  },
  {
    name: 'challenge to a player outside the 20 m range (stored locations only)',
    key: 'POST /battle/challenge', as: 'uid-a', body: { defender_id: ids.C },
    world: noActiveBattle,
    status: 400, code: 'TARGET_OUT_OF_RANGE',
  },
  {
    name: 'the attacker accepting their own challenge',
    key: 'POST /battle/{}/accept', as: 'uid-a', path: [ids.battle],
    world: pendingChallenge,
    status: 403, code: 'NOT_CHALLENGE_DEFENDER',
  },
  {
    name: 'declining a challenge that was already accepted',
    key: 'POST /battle/{}/decline', as: 'uid-b', path: [ids.battle],
    status: 409, code: 'CHALLENGE_ALREADY_ANSWERED',
  },
  {
    name: 'ready on a battle that is over',
    key: 'POST /battle/{}/ready', as: 'uid-a', path: [ids.battle],
    world: (w) => { w.battles[0].status = 'resolved'; },
    status: 409, code: 'SESSION_EXPIRED',
  },
  {
    name: 'reconnect after the grace period',
    key: 'POST /battle/{}/reconnect', as: 'uid-b', path: [ids.battle],
    world: (w) => { Object.assign(w.battles[0], { defender_disconnected_at: iso(-60 * 1000), defender_reconnect_deadline: iso(-45 * 1000) }); },
    status: 409, code: 'RECONNECT_WINDOW_EXPIRED',
  },
  {
    name: 'claiming a quest that is not completed',
    key: 'POST /quests/{}/claim', as: 'uid-a', path: [ids.quest], body: { request_id: 'req-claim-err' },
    world: (w) => { Object.assign(w.player_quests[0], { current_progress: 1, is_completed: false }); },
    status: 409, code: 'QUEST_NOT_COMPLETED',
  },
  {
    name: 'using a weapon as a consumable',
    key: 'POST /inventory/use', as: 'uid-a', body: { item_key: 'Pulse Blade', request_id: 'req-use-err' },
    world: noActiveBattle,
    status: 400, code: 'ITEM_NOT_CONSUMABLE',
  },
  {
    name: 'equipping an item the player does not own',
    key: 'POST /inventory/equip', as: 'uid-a', body: { item_key: 'Pulse Blade', request_id: 'req-equip-err' },
    world: (w) => { noActiveBattle(w); w.player_inventory = []; },
    status: 403, code: 'ITEM_NOT_OWNED',
  },
  {
    name: 'claiming the same quest twice is idempotent',
    key: 'POST /quests/{}/claim', as: 'uid-a', path: [ids.quest], body: { request_id: 'req-claim-again' },
    world: (w) => { w.player_quests[0].is_claimed = true; },
    status: 200,
    real: {
      expect: { already_claimed: true, reward_coins: 0 },
      after: [{ sql: 'SELECT credits FROM players WHERE player_id = $1', params: [ids.A], rows: [{ credits: 250 }] }],
    },
  },
  { name: 'SOS while not Controlled', key: 'POST /sos', as: 'uid-a', status: 403, code: 'SOS_REQUIRES_CONTROL' },
  {
    name: 'rescue with a friendship younger than 24 h',
    key: 'POST /rescue/accept', as: 'uid-a', body: { sos_id: ids.sos },
    world: (w) => { controlledB(w); w.rescue_missions = []; Object.assign(w.friendships[0], { accepted_at: iso(-HOUR_MS) }); },
    status: 403, code: 'FRIENDSHIP_TOO_NEW',
  },
];
