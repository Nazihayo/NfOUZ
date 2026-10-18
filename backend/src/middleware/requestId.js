'use strict';

const { v4: uuidv4 } = require('uuid');

// A client-supplied id is kept only if it looks like an id: it is written
// into every log line of the request, so it must stay short and plain.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Attaches a unique request id to every incoming request, echoed back
 * in the X-Request-Id response header. Used to correlate log lines
 * across controllers/services/repositories for a single request.
 */
function requestId(req, res, next) {
  const incomingId = req.headers['x-request-id'];
  req.requestId = typeof incomingId === 'string' && SAFE_REQUEST_ID.test(incomingId) ? incomingId : uuidv4();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

module.exports = requestId;
