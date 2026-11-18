import { describe, expect, it } from 'vitest';
import { attachmentName, kindOf, parseEmbedSize, parsePdfPage } from '../src/core/attachments';

describe('kindOf', () => {
  it('확장자로 종류 판별', () => {
    expect(kindOf('사진.PNG')).toBe('image');
    expect(kindOf('문서.pdf')).toBe('pdf');
    expect(kindOf('녹음.m4a')).toBe('audio');
    expect(kindOf('영상.mp4')).toBe('video');
    expect(kindOf('보고서.docx')).toBe('file');
    expect(kindOf('다른 노트')).toBe('note');
    expect(kindOf('다른 노트.md')).toBe('note');
    expect(kindOf('v1.2 회의')).toBe('note'); // 공백이 섞인 "확장자"는 노트 이름의 일부
  });
});

describe('parseEmbedSize', () => {
  it('너비와 너비x높이', () => {
    expect(parseEmbedSize('300')).toEqual({ width: 300, height: undefined });
    expect(parseEmbedSize('300x200')).toEqual({ width: 300, height: 200 });
    expect(parseEmbedSize('별칭')).toBeNull();
    expect(parseEmbedSize(null)).toBeNull();
  });
});

describe('parsePdfPage', () => {
  it('page= 파싱', () => {
    expect(parsePdfPage('page=3')).toBe(3);
    expect(parsePdfPage(null)).toBe(1);
    expect(parsePdfPage('page=0')).toBe(1);
  });
});

describe('attachmentName', () => {
  const now = new Date(2026, 10, 17, 20, 35, 12);
  it('붙여넣은 이미지는 날짜 이름', () => {
    expect(attachmentName('image.png', 'image/png', [], now)).toBe('붙여넣은 이미지 20261117203512.png');
    expect(attachmentName('', 'image/jpeg', [], now)).toBe('붙여넣은 이미지 20261117203512.jpg');
  });
  it('금지 문자 제거와 중복 방지', () => {
    expect(attachmentName('회의#1 [최종].pdf', 'application/pdf', [], now)).toBe('회의 1 최종.pdf');
    expect(attachmentName('사진.png', 'image/png', ['사진.png'], now)).toBe('사진 2.png');
    expect(attachmentName('사진.png', 'image/png', ['사진.png', '사진 2.png'], now)).toBe('사진 3.png');
    expect(attachmentName('사진.png', 'image/png', ['사진.jpg'], now)).toBe('사진.png');
  });
});
