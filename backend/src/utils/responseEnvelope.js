'use strict';

/**
 * Standard response envelope used by every NFOUZ endpoint:
 * { success, data, error }
 * See REST API Specification v1.0, section 1.
 */

function success(data = null) {
  return { success: true, data, error: null };
}

function error(code, message) {
  return { success: false, data: null, error: { code, message } };
}

/**
 * Custom error class carrying an API error code and HTTP status.
 * Services throw this; errorHandler middleware converts it to the envelope.
 */
class ApiError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

module.exports = { success, error, ApiError };
