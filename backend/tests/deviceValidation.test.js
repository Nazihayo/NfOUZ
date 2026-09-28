'use strict';

process.env.NODE_ENV = 'test';

const { parseRegisterDeviceBody, parseDeactivateDeviceBody, MAX_DEVICE_KEY_LENGTH, MAX_FCM_TOKEN_LENGTH } = require('../src/utils/deviceValidation');

describe('deviceValidation (Sprint 8 correction, final pass — strict body validation)', () => {
  it('accepts a well-formed registration body', () => {
    const result = parseRegisterDeviceBody({ device_key: 'device-1', fcm_token: 'tok-1', platform: 'android' });
    expect(result).toEqual({ deviceKey: 'device-1', fcmToken: 'tok-1', platform: 'android' });
  });

  it('rejects a missing device_key', () => {
    expect(() => parseRegisterDeviceBody({ fcm_token: 'tok-1', platform: 'android' })).toThrow(/device_key/);
  });

  it('rejects an empty fcm_token', () => {
    expect(() => parseRegisterDeviceBody({ device_key: 'd-1', fcm_token: '   ', platform: 'ios' })).toThrow(/fcm_token/);
  });

  it('rejects an oversized device_key', () => {
    const tooLong = 'x'.repeat(MAX_DEVICE_KEY_LENGTH + 1);
    expect(() => parseRegisterDeviceBody({ device_key: tooLong, fcm_token: 'tok-1', platform: 'android' })).toThrow(/exceeds the maximum length/);
  });

  it('rejects an oversized fcm_token', () => {
    const tooLong = 'x'.repeat(MAX_FCM_TOKEN_LENGTH + 1);
    expect(() => parseRegisterDeviceBody({ device_key: 'd-1', fcm_token: tooLong, platform: 'android' })).toThrow(/exceeds the maximum length/);
  });

  it('rejects an invalid platform', () => {
    expect(() => parseRegisterDeviceBody({ device_key: 'd-1', fcm_token: 'tok-1', platform: 'windows' })).toThrow(/platform must be one of/);
  });

  it('rejects unexpected extra fields', () => {
    expect(() =>
      parseRegisterDeviceBody({ device_key: 'd-1', fcm_token: 'tok-1', platform: 'android', player_id: 'someone-elses-id' })
    ).toThrow(/Unexpected field/);
  });

  it('parseDeactivateDeviceBody accepts { device_key }', () => {
    expect(parseDeactivateDeviceBody({ device_key: 'd-1' })).toEqual({ deviceKey: 'd-1' });
  });

  it('parseDeactivateDeviceBody rejects a missing device_key', () => {
    expect(() => parseDeactivateDeviceBody({})).toThrow(/device_key/);
  });
});
