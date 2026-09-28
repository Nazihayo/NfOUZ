'use strict';

const admin = require('firebase-admin');
const env = require('./env');
const logger = require('../utils/logger');

let initialized = false;

/**
 * Initializes the Firebase Admin SDK exactly once per process.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
function initializeFirebase() {
  if (initialized) {
    return admin;
  }

  if (admin.apps.length > 0) {
    initialized = true;
    return admin;
  }

  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: env.FIREBASE_PRIVATE_KEY,
      }),
    });
    initialized = true;
    logger.info('Firebase Admin SDK initialized', { projectId: env.FIREBASE_PROJECT_ID });
  } catch (err) {
    logger.error('Firebase Admin SDK initialization failed', { error: err.message });
    throw err;
  }

  return admin;
}

/**
 * Verifies the Firebase Admin SDK is initialized and can reach the project.
 * Used by the health endpoint. Does not make a network call by default —
 * a lightweight check is sufficient for a liveness probe.
 * @returns {boolean}
 */
function checkFirebaseReady() {
  return initialized && admin.apps.length > 0;
}

/**
 * Verifies a Firebase ID token. Throws if invalid or expired.
 * Used by auth middleware in later sprints.
 * @param {string} idToken
 */
async function verifyIdToken(idToken) {
  initializeFirebase();
  return admin.auth().verifyIdToken(idToken);
}

module.exports = { admin, initializeFirebase, checkFirebaseReady, verifyIdToken };
