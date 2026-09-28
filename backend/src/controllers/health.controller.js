'use strict';

const { checkConnection } = require('../config/database');
const { checkFirebaseReady } = require('../config/firebase');
const { success, error } = require('../utils/responseEnvelope');
const logger = require('../utils/logger');

/**
 * GET /health
 * Liveness/readiness probe used by uptime monitors, load balancers,
 * and the Alpha Release Checklist's "Backend Checklist" item.
 */
async function getHealth(req, res) {
  const [databaseOk, firebaseOk] = await Promise.all([
    checkConnection(),
    Promise.resolve(checkFirebaseReady()),
  ]);

  const allOk = databaseOk && firebaseOk;

  const payload = {
    status: allOk ? 'ok' : 'degraded',
    uptime_seconds: Math.round(process.uptime()),
    checks: {
      database: databaseOk ? 'ok' : 'unreachable',
      firebase: firebaseOk ? 'ok' : 'not_initialized',
    },
    timestamp: new Date().toISOString(),
  };

  if (!allOk) {
    logger.warn('Health check reporting degraded status', { requestId: req.requestId, payload });
    return res.status(503).json(error('SERVICE_DEGRADED', 'One or more dependencies are unavailable.'));
  }

  return res.status(200).json(success(payload));
}

module.exports = { getHealth };
