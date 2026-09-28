'use strict';

const { v4: uuidv4 } = require('uuid');

/**
 * Attaches a unique request id to every incoming request, echoed back
 * in the X-Request-Id response header. Used to correlate log lines
 * across controllers/services/repositories for a single request.
 */
function requestId(req, res, next) {
  const incomingId = req.headers['x-request-id'];
  req.requestId = typeof incomingId === 'string' && incomingId.length > 0 ? incomingId : uuidv4();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

module.exports = requestId;
