'use strict';

/**
 * One success-path scenario per endpoint the Unity client calls, keyed
 * like the extracted call sites ("METHOD /path/{}", {} = a path value).
 * Each says who calls (bearer token), the path values, query/body values
 * (by Unity DTO field name — the body itself is built from the Unity
 * request DTO), and which repository lookups find nothing (rowCounts)
 * so the backend takes its success path.
 */

const { ids, signResult, controlledB, iso } = require('./world');

module.exports = [
  { key: 'GET /auth/me', as: 'uid-a' },
  {
    key: 'POST /auth/register',
    as: 'uid-new',
    body: { username: 'charlie_3', class_type: 'Ranger' },
    rowCounts: { 'player.getByFirebaseUid': 0, 'player.getByUsername': 0 },
  },
  {
    key: 'PATCH /player/{}/location',
    as: 'uid-a',
    path: [ids.A],
    body: { lat: 52.5978, lng: 9.0854 },
  },
  {
    key: 'GET /player/nearby',
    as: 'uid-a',
    query: { lat: '52.5978', lng: '9.0854', radius: '1000' },
    // The nearby query has no id parameters, so the fake returns the first
    // player row: put B first so A sees someone other than themselves.
    world: (w) => { w.players.reverse(); },
  },
  {
    key: 'POST /battle/challenge',
    as: 'uid-a',
    body: { defender_id: ids.B, location: { lat: 52.5978, lng: 9.0854 } },
  },
  { key: 'GET /battle/{}', as: 'uid-a', path: [ids.battle] },
  { key: 'POST /battle/{}/ready', as: 'uid-a', path: [ids.battle] },
  { key: 'POST /battle/{}/disconnect', as: 'uid-b', path: [ids.battle] },
  { key: 'POST /battle/{}/reconnect', as: 'uid-b', path: [ids.battle] },
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
  },
  { key: 'GET /friends', as: 'uid-a' },
  { key: 'GET /friends/requests', as: 'uid-b' },
  { key: 'POST /friends/request', as: 'uid-a', body: { player_id: ids.B }, rowCounts: { 'friend.getRelationshipBetween': 0 } },
  { key: 'POST /friends/accept', as: 'uid-b', body: { player_id: ids.A } },
  { key: 'POST /friends/decline', as: 'uid-b', body: { player_id: ids.A } },
  { key: 'DELETE /friends/{}', as: 'uid-a', path: [ids.B] },
  { key: 'POST /friends/block', as: 'uid-a', body: { player_id: ids.B } },
  { key: 'POST /sos', as: 'uid-b', world: controlledB },
  { key: 'GET /sos/{}', as: 'uid-b', path: [ids.sos], world: controlledB },
  {
    key: 'POST /rescue/accept',
    as: 'uid-a',
    body: { sos_id: ids.sos },
    world: controlledB,
    rowCounts: { 'rescue.getActiveMissionForSos': 0 },
  },
  { key: 'POST /rescue/{}/guard-battle/start', as: 'uid-a', path: [ids.mission], world: controlledB },
  {
    key: 'POST /rescue/{}/guard-battle/resolve',
    as: 'uid-a',
    path: [ids.mission],
    body: { outcome: 'success', guard_battle_token: 'guard-token-1' },
    world: (w) => {
      controlledB(w);
      Object.assign(w.rescue_missions[0], {
        status: 'in_progress', guard_battle_started_at: iso(-30 * 1000), guard_battle_ends_at: iso(60 * 1000),
      });
    },
  },
  { key: 'GET /inventory', as: 'uid-a' },
  { key: 'POST /inventory/equip', as: 'uid-a', body: { item_key: 'Pulse Blade', request_id: 'req-equip-1' } },
  { key: 'POST /inventory/use', as: 'uid-a', body: { item_key: 'Health Kit', request_id: 'req-use-1' } },
  { key: 'GET /quests', as: 'uid-a' },
  { key: 'POST /quests/{}/claim', as: 'uid-a', path: [ids.quest], body: { request_id: 'req-claim-1' } },
  {
    key: 'PATCH /player/{}/fcm-token',
    as: 'uid-a',
    path: [ids.A],
    body: { device_key: 'device-key-1', fcm_token: 'fcm-token-1', platform: 'android' },
  },
  {
    key: 'POST /player/{}/devices/deactivate',
    as: 'uid-a',
    path: [ids.A],
    body: { device_key: 'device-key-1' },
  },
];
