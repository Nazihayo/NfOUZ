'use strict';

const db = require('../config/database');

/**
 * All SQL touching the `influence_log` table (007_influence_log.sql)
 * lives here. This table already existed before Sprint 6 — this is the
 * first sprint to actually write to it (battle win/loss audit trail),
 * per TDD v1.0 / Master Developer Handbook golden rule #5: every
 * Influence change must be auditable.
 */

/**
 * Records one Influence change. `reason` should be one of the values
 * already documented on the column ('battle_win' | 'battle_loss' |
 * 'ai_agent_win' | ...) — combat only ever writes 'battle_win' /
 * 'battle_loss' (a Draw writes neither — see battle.service.js
 * resolveBattle). `executor` defaults to the shared pool but accepts a
 * transaction client — Sprint 6 correction pass runs this inside the
 * same transaction as the battle-status UPDATE and the Influence/Control
 * writes; see config/database.js's withTransaction.
 *
 * `delta` is the ACTUAL amount applied (post floor-at-0 clamp — see
 * player.repository.js#adjustInfluence's `applied_delta`). `nominalDelta`
 * (migration 016) is the requested, pre-floor amount (the constant per
 * event — env.INFLUENCE_WIN_DELTA/INFLUENCE_LOSS_DELTA) and is recorded
 * alongside it so an audit can see both what was requested and what
 * actually landed (e.g. a -10 loss against 5 Influence: delta = -5,
 * nominalDelta = -10). Defaults to `delta` for any caller that hasn't
 * been updated to pass it explicitly, so an omitted nominalDelta never
 * produces a NULL where an old call site expected a value.
 */
async function log(playerId, delta, reason, battleId, executor = db, nominalDelta = delta) {
  const result = await executor.query(
    `INSERT INTO influence_log (player_id, delta, reason, battle_id, nominal_delta)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [playerId, delta, reason, battleId, nominalDelta]
  );
  return result.rows[0];
}

module.exports = { log };
