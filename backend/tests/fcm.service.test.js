'use strict';

process.env.NODE_ENV = 'test';

/**
 * Sprint 8 correction (final pass) — fcm.service.js's own unit tests.
 * Nothing else mocks fcm.service (every other test file mocks IT), so this
 * is the one place its actual sanitization, deactivation and multicast/
 * fallback logic runs for real against a fake firebase-admin.
 */

jest.mock('../src/repositories/playerDevice.repository', () => ({
  deactivateByToken: jest.fn().mockResolvedValue({ device_id: 'd-1', is_active: false }),
}));

const messagingMock = {
  send: jest.fn(),
};

jest.mock('../src/config/firebase', () => ({
  initializeFirebase: jest.fn(),
  checkFirebaseReady: jest.fn().mockReturnValue(true),
  verifyIdToken: jest.fn(),
  admin: {
    messaging: () => messagingMock,
  },
}));

const playerDeviceRepo = require('../src/repositories/playerDevice.repository');
const fcmService = require('../src/services/fcm.service');

describe('fcm.service — sendMulticastNotification (Sprint 8 correction, final pass)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete messagingMock.sendEachForMulticast;
    delete messagingMock.sendMulticast;
  });

  it('falls back to bounded per-token sends when the Admin SDK has neither multicast method (this sandbox\'s fake stub)', async () => {
    messagingMock.send = jest.fn().mockResolvedValue('fake-message-id');

    const result = await fcmService.sendMulticastNotification(['tok-1', 'tok-2'], { title: 't', body: 'b', data: { sos_id: 's-1' } });

    expect(result).toEqual({ success: true });
    expect(messagingMock.send).toHaveBeenCalledTimes(2);
  });

  it('prefers sendEachForMulticast when the Admin SDK provides it, sending exactly ONE batch call for many tokens', async () => {
    messagingMock.sendEachForMulticast = jest.fn().mockResolvedValue({
      responses: [{ success: true }, { success: true }, { success: true }],
      successCount: 3,
      failureCount: 0,
    });

    const result = await fcmService.sendMulticastNotification(['tok-1', 'tok-2', 'tok-3'], { title: 't', body: 'b' });

    expect(result).toEqual({ success: true });
    expect(messagingMock.sendEachForMulticast).toHaveBeenCalledTimes(1);
    const [batchArg] = messagingMock.sendEachForMulticast.mock.calls[0];
    expect(batchArg.tokens).toEqual(['tok-1', 'tok-2', 'tok-3']);
    expect(messagingMock.send).not.toHaveBeenCalled();
  });

  it('deactivates only the specific tokens the multicast batch reports as permanently invalid', async () => {
    const notRegisteredErr = { code: 'messaging/registration-token-not-registered' };
    messagingMock.sendEachForMulticast = jest.fn().mockResolvedValue({
      responses: [{ success: true }, { success: false, error: notRegisteredErr }, { success: false, error: notRegisteredErr }],
      successCount: 1,
      failureCount: 2,
    });

    const result = await fcmService.sendMulticastNotification(['tok-ok', 'tok-dead-1', 'tok-dead-2'], { title: 't', body: 'b' });

    expect(result).toEqual({ success: true }); // at least one succeeded
    expect(playerDeviceRepo.deactivateByToken).toHaveBeenCalledTimes(2);
    expect(playerDeviceRepo.deactivateByToken).toHaveBeenCalledWith('tok-dead-1');
    expect(playerDeviceRepo.deactivateByToken).toHaveBeenCalledWith('tok-dead-2');
  });

  it('reports failure with a sanitized reason (never the raw provider error) when every token in the batch fails', async () => {
    messagingMock.sendEachForMulticast = jest.fn().mockResolvedValue({
      responses: [{ success: false, error: { code: 'messaging/server-unavailable', message: 'internal detail that must never leak' } }],
      successCount: 0,
      failureCount: 1,
    });

    const result = await fcmService.sendMulticastNotification(['tok-1'], { title: 't', body: 'b' });

    expect(result).toEqual({ success: false, reason: 'unavailable' });
  });

  it('falls back to per-token sends if the multicast call itself throws', async () => {
    messagingMock.sendEachForMulticast = jest.fn().mockRejectedValue(new Error('network blip'));
    messagingMock.send = jest.fn().mockResolvedValue('fake-message-id');

    const result = await fcmService.sendMulticastNotification(['tok-1', 'tok-2'], { title: 't', body: 'b' });

    expect(result).toEqual({ success: true });
    expect(messagingMock.send).toHaveBeenCalledTimes(2);
  });

  it('returns no_token for an empty token list without calling the Admin SDK at all', async () => {
    const result = await fcmService.sendMulticastNotification([], { title: 't', body: 'b' });
    expect(result).toEqual({ success: false, reason: 'no_token' });
    expect(messagingMock.send).not.toHaveBeenCalled();
  });
});

describe('fcm.service — sendPushNotification sanitization (regression guard)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('never leaks the raw provider error message, only a sanitized code', async () => {
    messagingMock.send = jest.fn().mockRejectedValue({ code: 'messaging/invalid-registration-token', message: 'raw detail' });

    const result = await fcmService.sendPushNotification('tok-1', { title: 't', body: 'b' });

    expect(result).toEqual({ success: false, reason: 'invalid_token' });
    expect(JSON.stringify(result)).not.toContain('raw detail');
  });
});
