import { describe, expect, it } from 'vitest';
import { fixImportedText, planImport } from '../src/core/importer';

const enc = (s: string) => new TextEncoder().encode(s);

describe('planImport', () => {
  it('옵시디언 볼트 ZIP: 최상위 폴더 벗기기, 숨김·설정 폴더 건너뛰기, 폴더·노트·첨부 분류', () => {
    const plan = planImport([
      { path: 'MyVault/.obsidian/app.json', data: enc('{}') },
      { path: 'MyVault/.trash/old.md', data: enc('x') },
      { path: 'MyVault/홈.md', data: enc('﻿# 홈\r\n[[회의]]') },
      { path: 'MyVault/업무/회의.md', data: enc('회의 ![[그림.png]]') },
      { path: 'MyVault/업무/자료/a#b.md', data: enc('이름에 금지 문자') },
      { path: 'MyVault/첨부/그림.png', data: new Uint8Array([1, 2, 3]) },
    ]);
    expect(plan.rootName).toBe('MyVault');
    expect(plan.skipped).toBe(2);
    expect(plan.folders).toEqual([['업무'], ['업무', '자료']]);
    expect(plan.notes.map((n) => `${n.folder.join('/')}|${n.name}`)).toEqual(['|홈', '업무|회의', '업무/자료|a b']);
    expect(plan.notes[0].text).toBe('# 홈\n[[회의]]');
    expect(plan.attachments.map((a) => a.path)).toEqual(['첨부/그림.png']);
  });
});

describe('fixImportedText', () => {
  it('바뀐 첨부·노트 이름에 맞춰 링크 고치기, 마크다운 이미지를 임베드로', () => {
    const att = new Map([
      ['첨부/그림.png', '그림 2.png'],
      ['그림.png', '그림 2.png'],
      ['이미지/사진 1.jpg', '사진 1.jpg'],
    ]);
    const notes = new Map([['a:b', 'a b']]);
    const t = '![[그림.png|300]] [[a:b]] ![사진](../이미지/사진%201.jpg) ![웹](https://x.com/a.png) [[그대로]]';
    expect(fixImportedText(t, '업무', att, notes)).toBe('![[그림 2.png|300]] [[a b]] ![[사진 1.jpg]] ![웹](https://x.com/a.png) [[그대로]]');
  });
});
