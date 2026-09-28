'use strict';

process.env.NODE_ENV = 'test';

const resultSignature = require('../src/utils/battleResultSignature');

const SAMPLE_RESULT = {
  battle_id: 'battle-1',
  room_name: 'battle_battle-1',
  rules_version: '6.1.0',
  match_nonce: 'nonce-abc',
  event_seq: 3,
  attacker_id: 'attacker-id',
  defender_id: 'defender-id',
  attacker_final_health: 40,
  defender_final_health: 0,
  outcome: 'attacker_win',
  duration_seconds: 42,
  issued_at: '2026-01-01T00:00:00.000Z',
};

describe('battleResultSignature', () => {
  it('produces the same signature for the same result + secret every time (deterministic)', () => {
    const a = resultSignature.signResult(SAMPLE_RESULT, 'secret-1');
    const b = resultSignature.signResult(SAMPLE_RESULT, 'secret-1');
    expect(a).toBe(b);
  });

  it('produces a different signature for a different secret', () => {
    const a = resultSignature.signResult(SAMPLE_RESULT, 'secret-1');
    const b = resultSignature.signResult(SAMPLE_RESULT, 'secret-2');
    expect(a).not.toBe(b);
  });

  it('produces a different signature if any single field changes', () => {
    const a = resultSignature.signResult(SAMPLE_RESULT, 'secret-1');
    const b = resultSignature.signResult({ ...SAMPLE_RESULT, attacker_final_health: 41 }, 'secret-1');
    expect(a).not.toBe(b);
  });

  it('verifySignature accepts a correctly-signed result', () => {
    const signature = resultSignature.signResult(SAMPLE_RESULT, 'secret-1');
    expect(resultSignature.verifySignature(SAMPLE_RESULT, signature, 'secret-1')).toBe(true);
  });

  it('verifySignature rejects a signature made with the wrong secret', () => {
    const signature = resultSignature.signResult(SAMPLE_RESULT, 'secret-1');
    expect(resultSignature.verifySignature(SAMPLE_RESULT, signature, 'secret-2')).toBe(false);
  });

  it('verifySignature rejects a tampered result even with the original signature', () => {
    const signature = resultSignature.signResult(SAMPLE_RESULT, 'secret-1');
    const tampered = { ...SAMPLE_RESULT, outcome: 'defender_win' };
    expect(resultSignature.verifySignature(tampered, signature, 'secret-1')).toBe(false);
  });

  it('verifySignature returns false (never throws) for a missing/empty signature or secret', () => {
    expect(resultSignature.verifySignature(SAMPLE_RESULT, '', 'secret-1')).toBe(false);
    expect(resultSignature.verifySignature(SAMPLE_RESULT, undefined, 'secret-1')).toBe(false);
    expect(resultSignature.verifySignature(SAMPLE_RESULT, 'abc123', undefined)).toBe(false);
    expect(resultSignature.verifySignature(SAMPLE_RESULT, 'abc123', null)).toBe(false);
  });

  it('verifySignature returns false for a malformed (non-hex / wrong-length) signature rather than throwing', () => {
    expect(resultSignature.verifySignature(SAMPLE_RESULT, 'not-a-valid-hex-signature!!', 'secret-1')).toBe(false);
    expect(resultSignature.verifySignature(SAMPLE_RESULT, 'ab', 'secret-1')).toBe(false);
  });

  it('generateSecret and generateNonce produce distinct, sufficiently long random values', () => {
    const secret1 = resultSignature.generateSecret();
    const secret2 = resultSignature.generateSecret();
    const nonce1 = resultSignature.generateNonce();
    const nonce2 = resultSignature.generateNonce();

    expect(secret1).not.toBe(secret2);
    expect(nonce1).not.toBe(nonce2);
    expect(secret1.length).toBeGreaterThanOrEqual(32);
    expect(nonce1.length).toBeGreaterThanOrEqual(16);
  });
});
