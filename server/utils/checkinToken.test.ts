import { describe, expect, it, vi } from 'vitest';
import { createSelectionToken, verifySelectionToken } from './checkinToken';

const SECRET = 'test-checkin-token-secret';

describe('checkin selection token', () => {
  it('round-trips a valid token', () => {
    const token = createSelectionToken('11111111-1111-1111-1111-111111111111', SECRET);
    const payload = verifySelectionToken(token, SECRET);
    expect(payload).not.toBeNull();
    expect(payload!.studentId).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('rejects a token signed with a different secret', () => {
    const token = createSelectionToken('11111111-1111-1111-1111-111111111111', SECRET);
    expect(verifySelectionToken(token, 'wrong-secret')).toBeNull();
  });

  it('rejects a tampered token', () => {
    const token = createSelectionToken('11111111-1111-1111-1111-111111111111', SECRET);
    const tampered = token.slice(0, -4) + 'aaaa';
    expect(verifySelectionToken(tampered, SECRET)).toBeNull();
  });

  it('rejects garbage input', () => {
    expect(verifySelectionToken('not-a-real-token', SECRET)).toBeNull();
    expect(verifySelectionToken('', SECRET)).toBeNull();
  });

  it('rejects an expired token', () => {
    const realNow = Date.now;
    let now = realNow();
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    const token = createSelectionToken('11111111-1111-1111-1111-111111111111', SECRET);
    now += 61_000;
    expect(verifySelectionToken(token, SECRET)).toBeNull();

    vi.restoreAllMocks();
  });

  it('produces a different token each call (unique nonce)', () => {
    const a = createSelectionToken('11111111-1111-1111-1111-111111111111', SECRET);
    const b = createSelectionToken('11111111-1111-1111-1111-111111111111', SECRET);
    expect(a).not.toBe(b);
  });
});
