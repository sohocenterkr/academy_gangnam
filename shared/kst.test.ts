import { describe, expect, it } from 'vitest';
import { getNowKSTISOString, getTodayKST } from './kst';

describe('KST time helpers', () => {
  it('returns the KST calendar date even when UTC is still on the previous day', () => {
    // 2026-08-14T15:30:00Z is 2026-08-15T00:30:00+09:00 in KST.
    const utcDate = new Date('2026-08-14T15:30:00.000Z');

    expect(getTodayKST(utcDate)).toBe('2026-08-15');
  });

  it('formats the full KST timestamp with a +09:00 offset', () => {
    const utcDate = new Date('2026-08-14T15:30:00.000Z');

    expect(getNowKSTISOString(utcDate)).toBe('2026-08-15T00:30:00+09:00');
  });
});
