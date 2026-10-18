'use strict';

// Stand-in for src/config/firebase.js in the contract tests: no
// credentials, no network. The bearer token is used as the Firebase uid;
// a token starting with "rejected-" is refused the way firebase-admin
// refuses an expired one.
module.exports = {
  initializeFirebase: () => {},
  checkFirebaseReady: () => true,
  verifyIdToken: async (token) => {
    if (token.startsWith('rejected-')) {
      throw Object.assign(new Error('Firebase ID token has expired.'), { code: 'auth/id-token-expired' });
    }
    return { uid: token };
  },
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
