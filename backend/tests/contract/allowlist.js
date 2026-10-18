'use strict';

/**
 * Intentional differences between backend responses/requests and the
 * Unity DTOs. Every entry is exact and must keep matching:
 *   - an entry excuses only the fields it lists, at the endpoint (and
 *     nested position, `at`) it names — any other difference still fails;
 *   - the test fails when an entry, or one of its fields, no longer
 *     matches anything ("stale"), so exceptions cannot pile up unseen;
 *   - every entry needs a reason.
 * Endpoints are written as the test extracts them from the Unity call
 * sites: METHOD + path, with {} for a path value.
 */

module.exports = {
  /** Keys the server sends that the client's DTO does not read. */
  ignoredServerKeys: [
    {
      dto: 'PlayerSessionData',
      keys: ['faction_id'],
      reason: 'Faction System is not approved yet: nothing assigns a faction and the client has no faction field (HANDOFF item 14).',
    },
    {
      dto: 'FriendActionResponseData',
      keys: ['created_at', 'updated_at', 'expires_at', 'accepted_at'],
      reason: 'request/accept/block return the friendship row; the client only needs player_id, friend_id and status, and shows no friendship timestamps.',
    },
  ],

  /** DTO fields a given endpoint does not send (the client keeps the C# default). */
  absentFields: [
    {
      endpoint: 'POST /battle/challenge',
      dto: 'BattleSessionData',
      fields: ['attacker_ready', 'defender_ready', 'attacker_disconnected_at', 'defender_disconnected_at',
        'forfeited_by', 'session_started_at', 'winner_id', 'loser_id', 'duration_seconds'],
      reason: 'A just-created battle: ready flags are false, nothing is disconnected/forfeited/resolved yet, which is exactly the C# default; the client never reads session_started_at.',
    },
    {
      endpoint: 'GET /battle/{}',
      dto: 'BattleSessionData',
      fields: ['host_authority_secret', 'match_nonce', 'rules_version'],
      reason: 'Host-signing material is returned only once, on the attacker\'s challenge response (security rule, see BattleSessionData.cs); the poll response must never carry it.',
    },
    {
      endpoint: 'GET /friends/requests',
      dto: 'PendingFriendRequestData',
      at: 'data.incoming[]',
      fields: ['recipient_id'],
      reason: 'One DTO for both lists: incoming requests carry sender_id, recipient_id is outgoing-only (SocialModels.cs).',
    },
    {
      endpoint: 'GET /friends/requests',
      dto: 'PendingFriendRequestData',
      at: 'data.outgoing[]',
      fields: ['sender_id'],
      reason: 'One DTO for both lists: outgoing requests carry recipient_id, sender_id is incoming-only (SocialModels.cs).',
    },
    {
      endpoint: 'POST /friends/request',
      dto: 'FriendActionResponseData',
      fields: ['declined', 'removed', 'unblocked'],
      reason: 'FriendActionResponseData is shared by all friend actions; each action sends only its own result flag.',
    },
    {
      endpoint: 'POST /friends/accept',
      dto: 'FriendActionResponseData',
      fields: ['declined', 'removed', 'unblocked'],
      reason: 'FriendActionResponseData is shared by all friend actions; each action sends only its own result flag.',
    },
    {
      endpoint: 'POST /friends/block',
      dto: 'FriendActionResponseData',
      fields: ['declined', 'removed', 'unblocked'],
      reason: 'FriendActionResponseData is shared by all friend actions; each action sends only its own result flag.',
    },
    {
      endpoint: 'POST /friends/decline',
      dto: 'FriendActionResponseData',
      fields: ['removed', 'unblocked', 'player_id', 'friend_id', 'status'],
      reason: 'Decline deletes the request and answers only { declined: true }; there is no friendship row left to return.',
    },
    {
      endpoint: 'DELETE /friends/{}',
      dto: 'FriendActionResponseData',
      fields: ['declined', 'unblocked', 'player_id', 'friend_id', 'status'],
      reason: 'Remove deletes the friendship and answers only { removed: true }; there is no friendship row left to return.',
    },
    {
      endpoint: 'POST /rescue/accept',
      dto: 'RescueMissionData',
      fields: ['guard_battle_ends_at', 'guard_battle_token'],
      reason: 'Accept only reserves the mission; the guard-battle token and deadline exist once guard-battle/start runs, whose response the client stores.',
    },
    {
      endpoint: 'POST /rescue/{}/guard-battle/start',
      dto: 'RescueMissionData',
      fields: ['sos_id', 'reservation_expires_at'],
      reason: 'After start the client only reads mission_id, guard_battle_token and guard_battle_ends_at (RescueMissionController); the reservation is over.',
    },
    {
      endpoint: 'POST /inventory/equip',
      dto: 'InventoryEquipResponseData',
      fields: ['idempotent'],
      reason: 'Sent (as true) only when the request_id is a replay; a first execution omits it and the C# default false is the correct meaning.',
    },
    {
      endpoint: 'POST /inventory/use',
      dto: 'InventoryUseResponseData',
      fields: ['idempotent'],
      reason: 'Sent (as true) only when the request_id is a replay; a first execution omits it and the C# default false is the correct meaning.',
    },
  ],

  /**
   * Responses that carry only some fields of their DTO. The test checks
   * the response has exactly `fields`, that every Unity call site hands
   * it to `apply` (never to a full-session replace), and that `apply`
   * reads nothing else from it.
   */
  partialResponses: [
    {
      endpoint: 'POST /battle/{}/ready',
      dto: 'BattleSessionData',
      fields: ['battle_id', 'attacker_ready', 'defender_ready'],
      apply: 'BattleSession.ApplyReadyState',
      reason: 'battle.controller.js setReady answers only the ready flags (fixed client bug 0d63d5c: replacing the session lost the host secret and ended the match).',
    },
    {
      endpoint: 'POST /battle/{}/reconnect',
      dto: 'BattleSessionData',
      fields: ['battle_id', 'status'],
      apply: 'BattleSession.ApplyStatus',
      reason: 'battle.controller.js reconnect answers only the session status (fixed client bug 0d63d5c).',
    },
  ],

  /**
   * Fields a response must carry when a call site hands it to a
   * full-session replace. '*' = every field of the DTO. An absentFields
   * entry cannot excuse these.
   */
  fullSessionFields: {
    'BattleSession.UpdateFromServer': ['battle_id', 'photon_room_name', 'attacker_id', 'defender_id', 'status'],
    'PlayerSession.UpdateFromServer': '*',
  },

  /** C# value-type fields the server may send as null. */
  nullableFields: [
    {
      endpoint: 'GET /battle/{}',
      dto: 'BattleSessionData',
      field: 'duration_seconds',
      reason: 'NULL until the battle is resolved; JsonUtility keeps 0 and the client reads results only once status is no longer in_progress.',
    },
  ],

  /** Request fields one side sends/reads that the other does not. */
  requestFields: [],

  /** Error codes the client handles that never come from the backend. */
  clientOnlyErrorCodes: [
    {
      code: 'NETWORK_ERROR',
      reason: 'Generated by ApiClient itself for transport failures, timeouts and cancellation.',
    },
    {
      code: 'SOS_ALREADY_ACTIVE',
      reason: 'Unused legacy constant: POST /sos is idempotent and answers duplicate: true instead of an error.',
    },
  ],

  /** ApiResponse fields that are set by the client only. */
  clientOnlyEnvelopeFields: [
    {
      field: 'isTransportFailure',
      reason: 'Set by ApiClient for transport failures; the server never sends it.',
    },
  ],
};
