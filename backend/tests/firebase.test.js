'use strict';

process.env.NODE_ENV = 'test';

const mockInitializeApp = jest.fn();
const mockCert = jest.fn((config) => config);
const mockVerifyIdToken = jest.fn();

jest.mock('firebase-admin', () => {
  const appsArray = [];
  return {
    apps: appsArray,
    initializeApp: (...args) => {
      mockInitializeApp(...args);
      appsArray.push({});
    },
    credential: { cert: mockCert },
    auth: () => ({ verifyIdToken: mockVerifyIdToken }),
  };
});

describe('firebase config', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    // Reset the mocked apps array between tests since initializeFirebase is idempotent.
    const admin = require('firebase-admin');
    admin.apps.length = 0;
  });

  it('initializeFirebase() initializes the Admin SDK exactly once', () => {
    const { initializeFirebase } = require('../src/config/firebase');

    initializeFirebase();
    initializeFirebase(); // second call should be a no-op

    expect(mockInitializeApp).toHaveBeenCalledTimes(1);
  });

  it('checkFirebaseReady() returns false before initialization', () => {
    const { checkFirebaseReady } = require('../src/config/firebase');

    expect(checkFirebaseReady()).toBe(false);
  });

  it('checkFirebaseReady() returns true after initialization', () => {
    const { initializeFirebase, checkFirebaseReady } = require('../src/config/firebase');

    initializeFirebase();

    expect(checkFirebaseReady()).toBe(true);
  });

  it('verifyIdToken() delegates to admin.auth().verifyIdToken', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'test-uid-123' });
    const { verifyIdToken } = require('../src/config/firebase');

    const decoded = await verifyIdToken('some-id-token');

    expect(mockVerifyIdToken).toHaveBeenCalledWith('some-id-token');
    expect(decoded.uid).toBe('test-uid-123');
  });
});
