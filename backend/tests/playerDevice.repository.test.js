'use strict';

process.env.NODE_ENV = 'test';

/**
 * Sprint 8 correction (final pass) — player_devices security model:
 * a push token can never move from one player to another, current-device
 * sign-out never touches other devices, and account-wide deactivation is
 * a distinct function/call.
 */

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  checkConnection: jest.fn(),
  shutdown: jest.fn(),
  pool: { on: jest.fn(), query: jest.fn() },
}));

const db = require('../src/config/database');
const playerDeviceRepo = require('../src/repositories/playerDevice.repository');

describe('playerDevice.repository — registerDevice (Sprint 8 correction, final pass)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('Token cannot move between players — rejects with FCM_TOKEN_CONFLICT when the token already belongs to someone else', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ player_id: 'OTHER_PLAYER' }] }); // SELECT ... WHERE fcm_token = $1

    await expect(playerDeviceRepo.registerDevice('A', 'device-1', 'tok-shared', 'android')).rejects.toMatchObject({
      code: 'FCM_TOKEN_CONFLICT',
    });

    expect(db.query).toHaveBeenCalledTimes(1); // never reaches the INSERT/upsert
  });

  it('Re-registering the SAME player\'s SAME device is an ordinary upsert (their own existing token)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ player_id: 'A' }] }) // token already exists, but owned by the SAME player
      .mockResolvedValueOnce({ rows: [{ device_id: 'd-1', player_id: 'A', fcm_token: 'tok-1', platform: 'android', is_active: true }] });

    const device = await playerDeviceRepo.registerDevice('A', 'device-1', 'tok-1', 'android');

    expect(device.player_id).toBe('A');
    const [insertSql, insertParams] = db.query.mock.calls[1];
    expect(insertSql).toMatch(/ON CONFLICT \(player_id, device_key\) DO UPDATE/);
    expect(insertParams).toEqual(['A', 'device-1', 'tok-1', 'android']);
  });

  it('A race on the fcm_token unique index (caught at INSERT time) is also translated to FCM_TOKEN_CONFLICT, not a raw 500', async () => {
    const raceViolation = new Error('duplicate key value violates unique constraint "uniq_player_devices_fcm_token"');
    raceViolation.code = '23505';

    db.query
      .mockResolvedValueOnce({ rows: [] }) // SELECT finds nothing yet
      .mockRejectedValueOnce(raceViolation); // but someone else grabs it first

    await expect(playerDeviceRepo.registerDevice('A', 'device-1', 'tok-raced', 'ios')).rejects.toMatchObject({
      code: 'FCM_TOKEN_CONFLICT',
    });
  });

  it('a device_key-unrelated unique violation is NOT swallowed as a token conflict', async () => {
    const otherViolation = new Error('duplicate key value violates unique constraint "some_other_constraint"');
    otherViolation.code = '23505';

    db.query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(otherViolation);

    await expect(playerDeviceRepo.registerDevice('A', 'device-1', 'tok-x', 'ios')).rejects.toBe(otherViolation);
  });
});

describe('playerDevice.repository — deactivateDevice vs deactivateAllDevices (Sprint 8 correction, final pass)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('Current-device deactivation targets only (player_id, device_key) — leaves other devices untouched', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ device_id: 'd-1', player_id: 'A', device_key: 'device-1', is_active: false }] });

    const result = await playerDeviceRepo.deactivateDevice('A', 'device-1');

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/WHERE player_id = \$1 AND device_key = \$2/);
    expect(params).toEqual(['A', 'device-1']);
    expect(result.is_active).toBe(false);
  });

  it('Account-wide deactivation is a distinct call that targets every active device for the player', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ device_id: 'd-1' }, { device_id: 'd-2' }] });

    const result = await playerDeviceRepo.deactivateAllDevices('A');

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/WHERE player_id = \$1 AND is_active = TRUE/);
    expect(params).toEqual(['A']);
    expect(result).toHaveLength(2);
  });

  it('deactivateByToken (permanently invalid token) is not scoped to a single player_id', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ device_id: 'd-1', fcm_token: 'tok-dead', is_active: false }] });

    const result = await playerDeviceRepo.deactivateByToken('tok-dead');

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/WHERE fcm_token = \$1/);
    expect(params).toEqual(['tok-dead']);
    expect(result.is_active).toBe(false);
  });
});
