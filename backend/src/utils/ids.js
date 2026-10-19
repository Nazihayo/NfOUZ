'use strict';

const { ApiError } = require('./responseEnvelope');

// Canonical UUID text form — what every id this API hands out looks like.
// PostgreSQL rejects anything that is not a UUID with an error that would
// otherwise surface as a 500, so ids are checked before they reach SQL.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * Route middleware (placed after verifyFirebaseToken, so token failures
 * still answer 401 first): a path id that is not a UUID cannot name an
 * existing row, so it gets the same not-found answer as an unknown id.
 */
function requireUuidParam(name, code, message) {
  return (req, res, next) => (isUuid(req.params[name]) ? next() : next(new ApiError(code, message, 404)));
}

module.exports = { isUuid, requireUuidParam };
