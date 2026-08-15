import { describe, expect, it } from 'vitest';
import { maskName } from './masking';

describe('maskName', () => {
  it('masks the middle of a 3-character name, keeping first and last', () => {
    expect(maskName('김철수')).toBe('김*수');
  });

  it('masks every middle character of a 4-character name', () => {
    expect(maskName('김철수민')).toBe('김**민');
  });

  it('keeps only the first character of a 2-character name', () => {
    expect(maskName('이가')).toBe('이*');
  });

  it('fully masks a 1-character name', () => {
    expect(maskName('이')).toBe('*');
  });

  it('returns an empty string for empty input', () => {
    expect(maskName('')).toBe('');
  });
});
