// 해시태그 파서. 옵시디언 규칙을 따른다.
// - 본문의 #태그 (한글, 숫자, _ - / 허용, 숫자만으로 된 것은 제외, 중첩 태그 #업무/회의)
// - 코드 블록·인라인 코드·수식 안의 #, 제목 기호(# 제목), URL·링크 안의 # 는 태그가 아님
// - YAML frontmatter의 tags: [a, b] / tags: a, b / 목록 형식

/** 태그에 쓸 수 있는 문자 */
const TAG_CHAR = /[\p{L}\p{N}\p{M}_\-/]/u;
/** 태그 앞에 올 수 있는 문자(줄 시작, 공백, 여는 괄호) */
const BEFORE_OK = /[\s(（「『【]/u;

export interface TagHit {
  /** # 위치(원문 기준) */
  from: number;
  /** 태그 끝 위치 */
  to: number;
  /** # 뺀 태그 이름 */
  tag: string;
}

/** 대소문자 무시 비교 키 */
export function tagKey(tag: string): string {
  return tag.normalize('NFC').toLocaleLowerCase('ko');
}

/** 태그 이름이 유효한지(# 없이) */
export function isValidTag(tag: string): boolean {
  if (!tag || tag.startsWith('/') || tag.endsWith('/') || tag.includes('//')) return false;
  for (const ch of tag) if (!TAG_CHAR.test(ch)) return false;
  return !/^[\d/]+$/.test(tag); // 숫자만은 안 됨(#123 은 이슈 번호 등)
}

/** pos 위치의 # 에서 시작하는 태그를 읽는다. 태그가 아니면 null */
export function readTagAt(text: string, pos: number): TagHit | null {
  if (text[pos] !== '#') return null;
  if (pos > 0 && !BEFORE_OK.test(text[pos - 1])) return null;
  if (text.slice(pos - 2, pos) === '](') return null; // [링크](#목차) 의 문서 안 앵커
  let end = pos + 1;
  while (end < text.length) {
    // 서로게이트 쌍(이모지 등) 처리
    const cp = text.codePointAt(end)!;
    const ch = String.fromCodePoint(cp);
    if (!TAG_CHAR.test(ch)) break;
    end += ch.length;
  }
  // 끝의 / 는 태그에 포함하지 않음
  while (end > pos + 1 && text[end - 1] === '/') end--;
  const tag = text.slice(pos + 1, end);
  return isValidTag(tag) ? { from: pos, to: end, tag } : null;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

/** frontmatter 범위(없으면 null) */
export function frontmatterRange(text: string): { from: number; to: number; yaml: string } | null {
  const m = FRONTMATTER_RE.exec(text);
  return m ? { from: 0, to: m[0].length, yaml: m[1] } : null;
}

/**
 * 코드·수식처럼 태그를 찾지 않을 구간들을 [from, to) 목록으로 돌려준다.
 * (울타리 코드 블록, 인라인 코드, $$ 블록 수식, $ 인라인 수식, HTML 주석, %% 주석 %%)
 */
export function excludedRanges(text: string, start = 0): [number, number][] {
  const out: [number, number][] = [];
  // 울타리 코드 블록: ``` 또는 ~~~ (같은 기호, 같거나 긴 길이로 닫힘)
  const lineRe = /^([ \t]*)(`{3,}|~{3,})[^\n]*$/gm;
  lineRe.lastIndex = start;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(text))) {
    const fence = m[2];
    const open = m.index;
    const closeRe = new RegExp(`^[ \\t]*${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`, 'gm');
    closeRe.lastIndex = m.index + m[0].length + 1;
    const c = closeRe.exec(text);
    const end = c ? c.index + c[0].length : text.length;
    out.push([open, end]);
    lineRe.lastIndex = end + 1;
  }
  const inFence = (p: number) => out.some(([a, b]) => p >= a && p < b);
  const extra: [number, number][] = [];
  const add = (re: RegExp) => {
    re.lastIndex = start;
    while ((m = re.exec(text))) {
      if (!inFence(m.index)) extra.push([m.index, m.index + m[0].length]);
      if (m[0].length === 0) re.lastIndex++;
    }
  };
  add(/(`+)[^\n]+?\1/g); // 인라인 코드(같은 줄에서 같은 개수의 백틱으로 닫힘)
  add(/\$\$[\s\S]*?\$\$/g); // 블록 수식
  add(/(?<![\\$])\$(?!\s)[^$\n]+?(?<![\s\\])\$(?!\d)/g); // 인라인 수식
  add(/<!--[\s\S]*?-->/g);
  add(/%%[\s\S]*?%%/g);
  return [...out, ...extra].sort((a, b) => a[0] - b[0]);
}

/** 본문(frontmatter 제외)에서 태그 위치 찾기 */
export function findBodyTags(text: string): TagHit[] {
  const fm = frontmatterRange(text);
  const start = fm ? fm.to : 0;
  const excluded = excludedRanges(text, start);
  const hits: TagHit[] = [];
  let ei = 0;
  for (let i = text.indexOf('#', start); i >= 0; i = text.indexOf('#', i + 1)) {
    while (ei < excluded.length && excluded[ei][1] <= i) ei++;
    if (ei < excluded.length && excluded[ei][0] <= i) continue;
    const hit = readTagAt(text, i);
    if (hit) {
      hits.push(hit);
      i = hit.to - 1;
    }
  }
  return hits;
}

/** frontmatter의 tags/tag 값 목록(원문 그대로, # 제거) */
export function frontmatterTags(text: string): string[] {
  const fm = frontmatterRange(text);
  if (!fm) return [];
  const lines = fm.yaml.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(tags?|aliases_tags)\s*:\s*(.*)$/i.exec(lines[i]);
    if (!m || m[1].toLowerCase() === 'aliases_tags') continue;
    let val = m[2].trim();
    if (val) {
      val = val.replace(/^\[|\]$/g, '');
      out.push(...val.split(/[,\s]+/));
    } else {
      // 목록 형식: 다음 줄들의 "- 값"
      for (let j = i + 1; j < lines.length; j++) {
        const li = /^\s*-\s*(.+)$/.exec(lines[j]);
        if (!li) break;
        out.push(li[1]);
      }
    }
  }
  return out
    .map((t) => t.trim().replace(/^["']|["']$/g, '').replace(/^#/, ''))
    .filter(isValidTag);
}

/** 노트의 모든 태그(대소문자 무시 중복 제거, 처음 나온 표기 유지) */
export function extractTags(text: string): string[] {
  const seen = new Map<string, string>();
  for (const t of [...frontmatterTags(text), ...findBodyTags(text).map((h) => h.tag)]) {
    const k = tagKey(t);
    if (!seen.has(k)) seen.set(k, t);
  }
  return [...seen.values()];
}

/** 태그와 그 상위 태그들의 키: "업무/회의/주간" → ["업무", "업무/회의", "업무/회의/주간"] */
export function tagAncestry(tag: string): string[] {
  const parts = tagKey(tag).split('/');
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}

/** 노트 태그 목록이 선택한 태그(상위 태그 선택 시 하위 포함)를 가지는지 */
export function hasTag(noteTags: string[], selected: string): boolean {
  const k = tagKey(selected);
  return noteTags.some((t) => {
    const tk = tagKey(t);
    return tk === k || tk.startsWith(k + '/');
  });
}

export function matchTags(noteTags: string[], selected: string[], mode: 'and' | 'or'): boolean {
  if (!selected.length) return true;
  return mode === 'and' ? selected.every((s) => hasTag(noteTags, s)) : selected.some((s) => hasTag(noteTags, s));
}

export interface TagNode {
  /** 전체 태그 이름(표시용 대소문자) 예: "업무/회의" */
  full: string;
  /** 마지막 부분 예: "회의" */
  name: string;
  key: string;
  /** 이 태그 또는 하위 태그를 가진 노트 수 */
  count: number;
  children: TagNode[];
}

/**
 * 노트들의 태그로 중첩 태그 트리를 만든다. 상위 태그 수는 하위 태그를 가진 노트를 포함한다(노트당 한 번).
 * 반환: [트리 루트들, 키→노드 맵]
 */
export function buildTagTree(noteTags: (string[] | undefined)[]): { roots: TagNode[]; byKey: Map<string, TagNode> } {
  const byKey = new Map<string, TagNode>();
  for (const tags of noteTags) {
    if (!tags?.length) continue;
    const seen = new Set<string>();
    for (const tag of tags) {
      const parts = tag.split('/');
      for (let i = 0; i < parts.length; i++) {
        const full = parts.slice(0, i + 1).join('/');
        const key = tagKey(full);
        let node = byKey.get(key);
        if (!node) {
          node = { full, name: parts[i], key, count: 0, children: [] };
          byKey.set(key, node);
        }
        if (!seen.has(key)) {
          seen.add(key);
          node.count++;
        }
      }
    }
  }
  const roots: TagNode[] = [];
  for (const node of byKey.values()) {
    const i = node.key.lastIndexOf('/');
    const parent = i > 0 ? byKey.get(node.key.slice(0, i)) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  const sort = (list: TagNode[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }));
    list.forEach((n) => sort(n.children));
  };
  sort(roots);
  return { roots, byKey };
}

/** old 태그(및 하위 태그)를 new로 바꾼 태그 이름. 해당 없으면 null */
function renamed(tag: string, oldTag: string, newTag: string): string | null {
  const k = tagKey(tag);
  const ok = tagKey(oldTag);
  if (k === ok) return newTag;
  if (k.startsWith(ok + '/')) return newTag + tag.slice(oldTag.length);
  return null;
}

/**
 * 텍스트 안의 태그 이름 바꾸기(본문 #태그 + frontmatter tags).
 * 코드 블록 등은 건드리지 않는다. 바뀐 텍스트를 돌려준다.
 */
export function renameTagInText(text: string, oldTag: string, newTag: string): string {
  let out = text;
  // 본문: 뒤에서부터 바꿔 위치가 어긋나지 않게
  const hits = findBodyTags(out);
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i];
    const r = renamed(h.tag, oldTag, newTag);
    if (r !== null) out = out.slice(0, h.from + 1) + r + out.slice(h.to);
  }
  // frontmatter
  const fm = frontmatterRange(out);
  if (fm) {
    const lines = fm.yaml.split(/\r?\n/);
    let inList = false;
    const fixValue = (v: string) =>
      v.replace(/(^|[\s,[])(["']?)(#?)([^\s,[\]"']+)\2(?=$|[\s,\]])/g, (all, pre, q, hash, t) => {
        const r = renamed(t, oldTag, newTag);
        return r === null ? all : `${pre}${q}${hash}${r}${q}`;
      });
    for (let i = 0; i < lines.length; i++) {
      const m = /^(tags?\s*:\s*)(.*)$/i.exec(lines[i]);
      if (m) {
        inList = m[2].trim() === '';
        if (!inList) lines[i] = m[1] + fixValue(m[2]);
        continue;
      }
      const li = /^(\s*-\s*)(.+)$/.exec(lines[i]);
      if (inList && li) lines[i] = li[1] + fixValue(li[2]);
      else inList = false;
    }
    const yaml = lines.join('\n');
    if (yaml !== fm.yaml) {
      const head = out.slice(0, fm.to);
      out = head.replace(fm.yaml, yaml) + out.slice(fm.to);
    }
  }
  return out;
}
