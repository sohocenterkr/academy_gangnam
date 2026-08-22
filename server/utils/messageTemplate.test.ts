import { describe, expect, it } from 'vitest';
import { classifyMessageLength, renderMessageBody } from './messageTemplate';

describe('renderMessageBody', () => {
  it('substitutes known variables and leaves unknown ones untouched', () => {
    expect(renderMessageBody('{{이름}} 학생, 등원했습니다.', { 이름: '홍길동' })).toBe('홍길동 학생, 등원했습니다.');
    expect(renderMessageBody('{{모름}} 텍스트', {})).toBe('{{모름}} 텍스트');
  });
});

describe('classifyMessageLength', () => {
  it('classifies short Korean text as SMS and long text as LMS', () => {
    expect(classifyMessageLength('짧은 안내문')).toBe('SMS');
    expect(classifyMessageLength('가'.repeat(46))).toBe('LMS');
    expect(classifyMessageLength('가'.repeat(45))).toBe('SMS');
  });
});
