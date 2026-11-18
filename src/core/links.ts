// [[위키링크]] 처리: 찾기, 노트 이름 해석, 제목·문단(블록) 추출, 이름 변경 시 링크 갱신
import { excludedRanges, frontmatterRange } from './tags';
import { nameKey } from './names';
import { kindOf } from './attachments';

export interface LinkHit {
  from: number; // [[ 또는 ![[ 시작
  to: number; // ]] 끝
  embed: boolean;
  /** [[ ]] 안의 원문: "폴더/노트#제목|별칭" */
  raw: string;
  /** 노트 이름(경로 포함 가능): "폴더/노트" */
  name: string;
  /** # 뒤: "제목" 또는 "^블록ID" */
  sub: string | null;
  alias: string | null;
}

export function splitTarget(raw: string): { name: string; sub: string | null; alias: string | null } {
  const bar = raw.indexOf('|');
  const target = bar >= 0 ? raw.slice(0, bar) : raw;
  const alias = bar >= 0 ? raw.slice(bar + 1) : null;
  const hash = target.indexOf('#');
  return {
    name: (hash >= 0 ? target.slice(0, hash) : target).trim(),
    sub: hash >= 0 ? target.slice(hash + 1).trim() : null,
    alias: alias?.trim() || null,
  };
}

/** 본문의 위키링크(코드·수식 안 제외) */
export function findLinks(text: string): LinkHit[] {
  const excluded = excludedRanges(text, 0);
  const out: LinkHit[] = [];
  const re = /(!?)\[\[([^\[\]\n]+?)\]\]/g;
  let m: RegExpExecArray | null;
  let ei = 0;
  while ((m = re.exec(text))) {
    const at = m.index;
    while (ei < excluded.length && excluded[ei][1] <= at) ei++;
    if (ei < excluded.length && excluded[ei][0] <= at) continue;
    const raw = m[2];
    out.push({ from: at, to: at + m[0].length, embed: m[1] === '!', raw, ...splitTarget(raw) });
  }
  return out;
}

/** 노트를 가리키는 링크인지(첨부파일 링크 제외) */
export function isNoteLink(l: { name: string }): boolean {
  return !!l.name && kindOf(l.name) === 'note';
}

/** 링크 이름에서 .md 확장자와 앞뒤 공백 정리 */
function cleanName(name: string): string {
  return name.trim().replace(/\.md$/i, '');
}

// ---------- 노트 이름 해석 ----------

export interface NoteRef {
  id: string;
  name: string;
  folderId: string | null;
  /** 폴더 경로 "업무/회의록" (루트는 "") */
  path: string;
}

/** 이름(소문자) → 노트들 */
export type NameIndex = Map<string, NoteRef[]>;

export function buildNameIndex(notes: NoteRef[]): NameIndex {
  const m: NameIndex = new Map();
  for (const n of notes) {
    const k = nameKey(n.name);
    const list = m.get(k);
    if (list) list.push(n);
    else m.set(k, [n]);
  }
  return m;
}

/**
 * 링크 이름을 노트로 해석한다.
 * - "폴더/노트"면 경로 끝이 일치하는 노트
 * - 같은 이름이 여러 개면 링크한 노트와 같은 폴더 → 루트 → 경로가 짧은 순
 */
export function resolveName(name: string, fromFolder: string | null, index: NameIndex): NoteRef | null {
  const parts = cleanName(name).split('/').map((p) => p.trim()).filter(Boolean);
  const base = parts.pop();
  if (!base) return null;
  const cands = index.get(nameKey(base)) ?? [];
  if (!cands.length) return null;
  let list = cands;
  if (parts.length) {
    const want = nameKey(parts.join('/'));
    const exact = cands.filter((n) => nameKey(n.path) === want);
    const suffix = cands.filter((n) => nameKey(n.path).endsWith(want) && (n.path.length === want.length || n.path[n.path.length - want.length - 1] === '/'));
    list = exact.length ? exact : suffix.length ? suffix : [];
    if (!list.length) return null;
  }
  if (list.length === 1) return list[0];
  return (
    list.find((n) => n.folderId === fromFolder) ??
    list.find((n) => n.folderId === null) ??
    [...list].sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path))[0]
  );
}

/** from 폴더에서 target을 가리키는 가장 짧은 링크 이름(이름만으로 해석되면 이름, 아니면 경로 포함) */
export function linkNameFor(target: NoteRef, fromFolder: string | null, index: NameIndex): string {
  const byName = resolveName(target.name, fromFolder, index);
  if (byName?.id === target.id) return target.name;
  return target.path ? `${target.path}/${target.name}` : target.name;
}

// ---------- 제목·문단 ----------

export interface Heading {
  level: number;
  text: string;
  line: number; // 0부터
  from: number;
}

/** 제목 목록(코드 블록·frontmatter 제외) */
export function findHeadings(text: string): Heading[] {
  const fm = frontmatterRange(text);
  const excluded = excludedRanges(text, fm?.to ?? 0);
  const out: Heading[] = [];
  const re = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;
  re.lastIndex = fm?.to ?? 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const at = m.index;
    if (excluded.some(([a, b]) => at >= a && at < b)) continue;
    out.push({
      level: m[1].length,
      text: m[2].replace(/\s+\^[A-Za-z0-9-]+$/, '').trim(),
      line: lineOf(text, at),
      from: at,
    });
  }
  return out;
}

function lineOf(text: string, pos: number): number {
  let n = 0;
  for (let i = text.indexOf('\n'); i >= 0 && i < pos; i = text.indexOf('\n', i + 1)) n++;
  return n;
}

export interface Block {
  /** 블록의 마지막 줄(0부터) — ^ID가 붙는 줄 */
  line: number;
  /** 첫 줄(0부터) */
  startLine: number;
  text: string;
  id: string | null;
}

const BLOCK_ID_AT_END = /\s\^([A-Za-z0-9-]+)\s*$/;
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s/;

/**
 * 문단·목록 항목 단위 블록(코드 블록·제목·frontmatter 제외).
 * 목록은 항목 한 줄이 한 블록, 일반 문단은 빈 줄로 나뉜 줄 묶음이 한 블록.
 */
export function findBlocks(text: string): Block[] {
  const lines = text.split('\n');
  const fm = frontmatterRange(text);
  const excluded = excludedRanges(text, fm?.to ?? 0).filter(([a, b]) => text.slice(a, b).includes('\n')); // 여러 줄 구간만
  const lineStarts: number[] = [];
  let p = 0;
  for (const l of lines) {
    lineStarts.push(p);
    p += l.length + 1;
  }
  const skip = (i: number) =>
    (fm && lineStarts[i] < fm.to) || excluded.some(([a, b]) => lineStarts[i] >= a && lineStarts[i] < b);
  const out: Block[] = [];
  let start = -1;
  const close = (end: number) => {
    if (start < 0) return;
    const body = lines.slice(start, end + 1).join('\n');
    const m = BLOCK_ID_AT_END.exec(lines[end]);
    out.push({ startLine: start, line: end, text: body.replace(BLOCK_ID_AT_END, '').trim(), id: m ? m[1] : null });
    start = -1;
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (skip(i) || !l.trim() || /^#{1,6}\s/.test(l) || /^\s*([-*_])(\s*\1){2,}\s*$/.test(l) || /^\s*\|/.test(l)) {
      close(i - 1);
      continue;
    }
    if (LIST_ITEM.test(l)) {
      close(i - 1);
      start = i;
      close(i);
      continue;
    }
    if (start < 0) start = i;
  }
  close(lines.length - 1);
  return out;
}

/** 새 블록 ID(6자리 영문 소문자+숫자) */
export function newBlockId(existing: Iterable<string> = []): string {
  const taken = new Set(existing);
  for (;;) {
    let s = '';
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    for (const b of bytes) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36];
    if (!taken.has(s)) return s;
  }
}

/**
 * line(0부터)에 있는 블록에 ID를 보장한다. 이미 있으면 그대로.
 * 반환: 바뀐 텍스트와 ID. 블록이 아니면 null.
 */
export function ensureBlockId(text: string, line: number, id?: string): { text: string; id: string } | null {
  const block = findBlocks(text).find((b) => line >= b.startLine && line <= b.line);
  if (!block) return null;
  if (block.id) return { text, id: block.id };
  const lines = text.split('\n');
  const newId = id ?? newBlockId(findBlocks(text).map((b) => b.id ?? ''));
  lines[block.line] = lines[block.line].replace(/\s*$/, '') + ` ^${newId}`;
  return { text: lines.join('\n'), id: newId };
}

/**
 * [[노트#sub]]의 sub에 해당하는 부분(제목 구간 또는 블록)을 찾는다.
 * 반환: 줄 범위(0부터, 끝 포함)와 해당 텍스트
 */
export function findSection(text: string, sub: string | null): { startLine: number; endLine: number; text: string } | null {
  const lines = text.split('\n');
  if (!sub) {
    const fm = frontmatterRange(text);
    const start = fm ? lineOf(text, fm.to) : 0;
    return { startLine: start, endLine: lines.length - 1, text: lines.slice(start).join('\n') };
  }
  if (sub.startsWith('^')) {
    const id = sub.slice(1).toLowerCase();
    const b = findBlocks(text).find((x) => x.id?.toLowerCase() === id);
    if (!b) return null;
    return { startLine: b.startLine, endLine: b.line, text: lines.slice(b.startLine, b.line + 1).join('\n').replace(BLOCK_ID_AT_END, '') };
  }
  // 제목: 같은 이름 제목, "상위#하위" 형식이면 마지막 부분 기준
  const want = nameKey(sub.split('#').pop()!.trim());
  const hs = findHeadings(text);
  const i = hs.findIndex((h) => nameKey(h.text) === want);
  if (i < 0) return null;
  const h = hs[i];
  const next = hs.slice(i + 1).find((x) => x.level <= h.level);
  const end = next ? next.line - 1 : lines.length - 1;
  return { startLine: h.line, endLine: end, text: lines.slice(h.line, end + 1).join('\n') };
}

// ---------- 링크 고쳐 쓰기 ----------

/**
 * 텍스트 안의 위키링크 중 replace가 새 이름을 돌려주는 것만 바꾼다(#제목, |별칭은 유지).
 */
export function rewriteLinks(text: string, replace: (link: LinkHit) => string | null): string {
  const links = findLinks(text);
  let out = text;
  for (let i = links.length - 1; i >= 0; i--) {
    const l = links[i];
    const name = replace(l);
    if (name === null || name === l.name) continue;
    const bar = l.raw.indexOf('|');
    const hash = l.raw.indexOf('#');
    const cut = hash >= 0 && (bar < 0 || hash < bar) ? hash : bar >= 0 ? bar : l.raw.length;
    const raw = name + l.raw.slice(cut);
    out = out.slice(0, l.from) + (l.embed ? '![[' : '[[') + raw + ']]' + out.slice(l.to);
  }
  return out;
}

/** 링크 색인용: 노트가 가리키는 링크 이름들(소문자, 노트 링크만) */
export function linkKeys(text: string): string[] {
  const set = new Set<string>();
  for (const l of findLinks(text)) if (isNoteLink(l)) set.add(nameKey(cleanName(l.name)));
  return [...set];
}
