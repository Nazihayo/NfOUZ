'use strict';

// Stand-in for src/config/firebase.js in the contract tests: no
// credentials, no network. The bearer token is used as the Firebase uid.
module.exports = {
  initializeFirebase: () => {},
  checkFirebaseReady: () => true,
  verifyIdToken: async (token) => ({ uid: token }),
  admin: {
    messaging: () => ({
      send: async () => 'message-id',
      sendEachForMulticast: async (m) => ({
        successCount: m.tokens.length,
        failureCount: 0,
        responses: m.tokens.map(() => ({ success: true })),
      }),
    }),
  },
};
