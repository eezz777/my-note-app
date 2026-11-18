// 백링크(이 노트를 가리키는 링크)와 링크 안 된 언급(노트 이름이 그냥 글자로 쓰인 곳) 찾기
import { excludedRanges, frontmatterRange } from './tags';
import { findLinks, isNoteLink, resolveName, type NameIndex } from './links';

export interface Mention {
  /** 원문 위치 */
  from: number;
  to: number;
  /** 0부터 줄 번호 */
  line: number;
  /** 앞뒤 문맥(한 줄, 길면 잘라냄) */
  context: string;
  /** context 안에서 강조할 범위 */
  hl: [number, number];
}

function contextOf(text: string, from: number, to: number): { line: number; context: string; hl: [number, number] } {
  const ls = text.lastIndexOf('\n', from - 1) + 1;
  let le = text.indexOf('\n', to);
  if (le < 0) le = text.length;
  let line = 0;
  for (let i = text.indexOf('\n'); i >= 0 && i < from; i = text.indexOf('\n', i + 1)) line++;
  // 너무 긴 줄은 앞뒤 60자만
  const a = Math.max(ls, from - 60);
  const b = Math.min(le, to + 60);
  const pre = a > ls ? '…' : '';
  const post = b < le ? '…' : '';
  const context = pre + text.slice(a, b).trim() + post;
  const lead = text.slice(a, b).length - text.slice(a, b).trimStart().length;
  const start = pre.length + (from - a) - lead;
  return { line, context, hl: [start, start + (to - from)] };
}

/** text 안에서 targetId 노트를 가리키는 링크들(text를 쓴 노트는 fromFolder에 있음) */
export function linksTo(text: string, targetId: string, fromFolder: string | null, index: NameIndex): Mention[] {
  return findLinks(text)
    .filter((l) => isNoteLink(l) && resolveName(l.name, fromFolder, index)?.id === targetId)
    .map((l) => ({ from: l.from, to: l.to, ...contextOf(text, l.from, l.to) }));
}

const ASCII_WORD = /[A-Za-z0-9_]/;

/**
 * 링크 안 된 언급: 노트 이름이 [[ ]] 밖에서 그냥 쓰인 곳(대소문자 무시).
 * 코드·링크·URL 안은 제외. 영문 이름은 단어 경계를 지킨다(한글은 조사가 붙어도 인정).
 */
export function unlinkedMentions(text: string, name: string): Mention[] {
  const needle = name.trim().toLocaleLowerCase('ko');
  if (needle.length < 2) return [];
  const fm = frontmatterRange(text);
  const skip: [number, number][] = [...excludedRanges(text, fm?.to ?? 0)];
  if (fm) skip.push([0, fm.to]);
  for (const l of findLinks(text)) skip.push([l.from, l.to]);
  for (const m of text.matchAll(/\[[^\]\n]*\]\([^)\n]*\)|https?:\/\/\S+/g)) skip.push([m.index!, m.index! + m[0].length]);
  const lower = text.toLocaleLowerCase('ko');
  const out: Mention[] = [];
  for (let i = lower.indexOf(needle); i >= 0; i = lower.indexOf(needle, i + needle.length)) {
    const j = i + needle.length;
    if (skip.some(([a, b]) => i < b && j > a)) continue;
    if (ASCII_WORD.test(needle[0]) && i > 0 && ASCII_WORD.test(text[i - 1])) continue;
    if (ASCII_WORD.test(needle[needle.length - 1]) && j < text.length && ASCII_WORD.test(text[j])) continue;
    out.push({ from: i, to: j, ...contextOf(text, i, j) });
  }
  return out;
}

/** 언급 하나를 [[링크]]로 바꾼 텍스트 */
export function linkMention(text: string, m: { from: number; to: number }, linkName: string): string {
  const shown = text.slice(m.from, m.to);
  const link = shown === linkName ? `[[${linkName}]]` : `[[${linkName}|${shown}]]`;
  return text.slice(0, m.from) + link + text.slice(m.to);
}
