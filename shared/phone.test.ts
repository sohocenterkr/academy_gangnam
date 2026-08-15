import { describe, expect, it } from 'vitest';
import { maskPhone, normalizePhone } from './phone';

describe('normalizePhone', () => {
  it('strips all non-digit characters', () => {
    expect(normalizePhone('010-1234-5678')).toBe('01012345678');
    expect(normalizePhone('010 1234 5678')).toBe('01012345678');
    expect(normalizePhone('(02) 123-4567')).toBe('021234567');
  });

  it('returns an empty string for input with no digits', () => {
    expect(normalizePhone('abc')).toBe('');
  });
});

describe('maskPhone', () => {
  it('masks the middle segment of an 11-digit mobile number', () => {
    expect(maskPhone('01012345678')).toBe('010-****-5678');
  });

  it('masks the middle segment of a 10-digit number', () => {
    expect(maskPhone('0101234567')).toBe('010-***-4567');
  });

  it('masks a short number entirely', () => {
    expect(maskPhone('123')).toBe('***');
  });

  it('returns an empty string for empty input', () => {
    expect(maskPhone('')).toBe('');
  });
});
