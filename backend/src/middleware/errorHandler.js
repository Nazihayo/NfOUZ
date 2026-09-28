'use strict';

const logger = require('../utils/logger');
const { error: errorEnvelope, ApiError } = require('../utils/responseEnvelope');

/**
 * Central error handler. Any controller/middleware that calls next(err)
 * ends up here. Converts known ApiError instances to the standard
 * envelope with their own status code; anything else becomes a
 * generic 500 INTERNAL_ERROR without leaking internals to the client.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const requestId = req.requestId;

  if (err instanceof ApiError) {
    logger.warn('Handled API error', {
      requestId,
      code: err.code,
      message: err.message,
      path: req.path,
    });
    return res.status(err.statusCode).json(errorEnvelope(err.code, err.message));
  }

  logger.error('Unhandled error', {
    requestId,
    message: err.message,
    stack: err.stack,
    path: req.path,
  });

  return res.status(500).json(errorEnvelope('INTERNAL_ERROR', 'An unexpected error occurred.'));
}

/**
 * 404 handler for routes that don't match anything.
 */
function notFoundHandler(req, res) {
  return res.status(404).json(errorEnvelope('NOT_FOUND', `Route ${req.method} ${req.path} not found.`));
}

module.exports = { errorHandler, notFoundHandler };
