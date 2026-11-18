import { describe, expect, it } from 'vitest';
import { sanitizeName, uniqueName, validateName } from '../src/core/names';

describe('validateName', () => {
  it('정상 이름은 통과', () => {
    expect(validateName('회의록 2026-11-17')).toBeNull();
    expect(validateName('업무 (중요)')).toBeNull();
  });
  it('빈 이름, 금지 문자, 점으로 시작하는 이름은 거부', () => {
    expect(validateName('   ')).not.toBeNull();
    for (const c of ['/', '\\', ':', '*', '?', '"', '<', '>', '|', '#', '^', '[', ']']) {
      expect(validateName(`a${c}b`)).not.toBeNull();
    }
    expect(validateName('.hidden')).not.toBeNull();
  });
});

describe('sanitizeName', () => {
  it('금지 문자를 공백으로 바꾸고 정리', () => {
    expect(sanitizeName('a/b:c')).toBe('a b c');
    expect(sanitizeName('  ...  ')).toBe('제목 없음');
  });
});

describe('uniqueName', () => {
  it('겹치지 않으면 그대로', () => {
    expect(uniqueName('노트', ['다른 노트'])).toBe('노트');
  });
  it('겹치면 숫자를 붙임 (대소문자 무시)', () => {
    expect(uniqueName('Note', ['note'])).toBe('Note 2');
    expect(uniqueName('노트', ['노트', '노트 2'])).toBe('노트 3');
  });
  it('이미 숫자가 붙은 이름은 이어서 센다', () => {
    expect(uniqueName('노트 2', ['노트 2'])).toBe('노트 3');
  });
});
