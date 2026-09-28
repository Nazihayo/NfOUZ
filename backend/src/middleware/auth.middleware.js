'use strict';

const { verifyIdToken } = require('../config/firebase');
const { error: errorEnvelope } = require('../utils/responseEnvelope');
const logger = require('../utils/logger');

/**
 * Verifies the Firebase ID token on every protected request and attaches
 * the trusted uid as req.firebaseUid. No controller or service ever
 * trusts a firebase_uid or player_id supplied in the request body for
 * "act as the current player" operations — see Firebase Security
 * Package v1.0, section 1.1, and Backend Implementation Guide v1.0,
 * section 5.1.
 */
async function verifyFirebaseToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res
      .status(401)
      .json(errorEnvelope('INVALID_TOKEN', 'Missing or malformed Authorization header.'));
  }

  const idToken = authHeader.slice('Bearer '.length).trim();
  if (!idToken) {
    return res.status(401).json(errorEnvelope('INVALID_TOKEN', 'Empty bearer token.'));
  }

  try {
    const decodedToken = await verifyIdToken(idToken);
    req.firebaseUid = decodedToken.uid;
    next();
  } catch (err) {
    logger.warn('Firebase token verification failed', {
      requestId: req.requestId,
      error: err.message,
    });
    return res.status(401).json(errorEnvelope('INVALID_TOKEN', 'Token verification failed.'));
  }
}

module.exports = { verifyFirebaseToken };
