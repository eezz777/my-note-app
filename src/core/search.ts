// 전체 검색: 검색어 해석, 노트 일치 판정·점수, 결과 미리보기(하이라이트 범위)
// 한글은 부분 일치(글자 단위 포함 여부)로 찾는다.

export interface ParsedQuery {
  /** 모두 포함해야 하는 단어/구절(소문자) */
  terms: string[];
  /** 포함하면 안 되는 단어(-단어) */
  excludes: string[];
  /** tag:업무 → 태그(하위 태그 포함) */
  tags: string[];
  /** folder:프로젝트 → 폴더 경로에 포함 */
  folders: string[];
  /** title:회의 → 제목에 포함 */
  titles: string[];
}

export const norm = (s: string) => s.normalize('NFC').toLocaleLowerCase('ko');

/** 검색어 해석: 공백으로 나누고 "따옴표 구절", -제외, tag: folder: title: 지원 */
export function parseQuery(q: string): ParsedQuery {
  const out: ParsedQuery = { terms: [], excludes: [], tags: [], folders: [], titles: [] };
  const re = /(-?)(?:(tag|folder|path|title|file):)?(?:"([^"]*)"?|(\S+))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q))) {
    const neg = m[1] === '-';
    const op = m[2]?.toLowerCase();
    const val = norm((m[3] ?? m[4] ?? '').trim());
    if (!val) continue;
    if (op === 'tag') out.tags.push(val.replace(/^#/, ''));
    else if (op === 'folder' || op === 'path') out.folders.push(val);
    else if (op === 'title' || op === 'file') out.titles.push(val);
    else if (neg) out.excludes.push(val);
    else out.terms.push(val);
  }
  return out;
}

export function isEmptyQuery(p: ParsedQuery): boolean {
  return !p.terms.length && !p.tags.length && !p.folders.length && !p.titles.length;
}

export interface SearchDoc {
  id: string;
  title: string;
  /** 폴더 경로 "업무/회의록" */
  path: string;
  tags: string[];
  body: string;
  updatedAt: number;
}

/** 검색용으로 미리 소문자로 바꿔 둔 문서 */
export interface PreparedDoc extends SearchDoc {
  lTitle: string;
  lBody: string;
  lPath: string;
  lTags: string[];
}

export function prepare(d: SearchDoc): PreparedDoc {
  return { ...d, lTitle: norm(d.title), lBody: norm(d.body), lPath: norm(d.path), lTags: d.tags.map(norm) };
}

export interface Snippet {
  text: string;
  /** text 안 강조 범위 */
  ranges: [number, number][];
  /** 원문 줄 번호(0부터) */
  line: number;
}

export interface SearchResult {
  id: string;
  score: number;
  title: string;
  path: string;
  tags: string[];
  titleRanges: [number, number][];
  snippets: Snippet[];
  /** 본문에서 찾은 총 횟수 */
  hits: number;
}

function hasTag(lTags: string[], t: string): boolean {
  return lTags.some((x) => x === t || x.startsWith(t + '/'));
}

function countOf(hay: string, needle: string, cap = 50): number {
  let n = 0;
  for (let i = hay.indexOf(needle); i >= 0 && n < cap; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
}

function rangesIn(lower: string, terms: string[]): [number, number][] {
  const r: [number, number][] = [];
  for (const t of terms) {
    for (let i = lower.indexOf(t); i >= 0; i = lower.indexOf(t, i + t.length)) r.push([i, i + t.length]);
  }
  r.sort((a, b) => a[0] - b[0]);
  // 겹치는 범위 합치기
  const merged: [number, number][] = [];
  for (const x of r) {
    const last = merged[merged.length - 1];
    if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]);
    else merged.push([...x]);
  }
  return merged;
}

/** 본문에서 검색어가 나오는 곳 주변 미리보기(최대 n개, 줄 단위) */
export function makeSnippets(doc: PreparedDoc, terms: string[], n = 3, radius = 50): Snippet[] {
  if (!terms.length || doc.lBody.length !== doc.body.length) return [];
  const all = rangesIn(doc.lBody, terms);
  const out: Snippet[] = [];
  let lastEnd = -1;
  for (const [a, b] of all) {
    if (a < lastEnd) continue;
    const ls = doc.body.lastIndexOf('\n', a - 1) + 1;
    let le = doc.body.indexOf('\n', b);
    if (le < 0) le = doc.body.length;
    const from = Math.max(ls, a - radius);
    const to = Math.min(le, b + radius);
    const pre = from > ls ? '…' : '';
    const post = to < le ? '…' : '';
    const text = pre + doc.body.slice(from, to) + post;
    const ranges = all
      .filter(([x, y]) => x >= from && y <= to)
      .map(([x, y]) => [x - from + pre.length, y - from + pre.length] as [number, number]);
    let line = 0;
    for (let i = doc.body.indexOf('\n'); i >= 0 && i < a; i = doc.body.indexOf('\n', i + 1)) line++;
    out.push({ text, ranges, line });
    lastEnd = le;
    if (out.length >= n) break;
  }
  return out;
}

/** 노트 하나 검사. 일치하지 않으면 null. withSnippets=false면 미리보기는 나중에(보여 줄 결과만) 만든다 */
export function matchDoc(doc: PreparedDoc, q: ParsedQuery, withSnippets = true): SearchResult | null {
  for (const t of q.tags) if (!hasTag(doc.lTags, t)) return null;
  for (const f of q.folders) if (!doc.lPath.includes(f)) return null;
  for (const t of q.titles) if (!doc.lTitle.includes(t)) return null;
  for (const x of q.excludes) {
    if (doc.lTitle.includes(x) || doc.lBody.includes(x) || doc.lTags.some((t) => t.includes(x))) return null;
  }
  let score = 0;
  let hits = 0;
  for (const t of q.terms) {
    const inTitle = doc.lTitle.includes(t);
    const inTag = doc.lTags.some((x) => x.includes(t));
    const c = countOf(doc.lBody, t);
    if (!inTitle && !inTag && !c) return null; // 모든 단어가 어딘가에 있어야 함
    hits += c;
    score += (inTitle ? (doc.lTitle === t ? 40 : doc.lTitle.startsWith(t) ? 25 : 15) : 0) + (inTag ? 8 : 0) + Math.min(c, 10);
  }
  const highlight = [...q.terms, ...q.titles];
  return {
    id: doc.id,
    score,
    title: doc.title,
    path: doc.path,
    tags: doc.tags,
    titleRanges: doc.lTitle.length === doc.title.length ? rangesIn(doc.lTitle, highlight) : [],
    snippets: withSnippets ? makeSnippets(doc, q.terms) : [],
    hits,
  };
}

/** 여러 노트 검색: 점수 높은 순, 같으면 최근 수정 순 */
export function searchDocs(docs: Iterable<PreparedDoc>, query: string, limit = 200): { results: SearchResult[]; total: number } {
  const q = parseQuery(query);
  if (isEmptyQuery(q)) return { results: [], total: 0 };
  const found: { r: SearchResult; d: PreparedDoc }[] = [];
  for (const d of docs) {
    const r = matchDoc(d, q, false);
    if (r) found.push({ r, d });
  }
  found.sort((a, b) => b.r.score - a.r.score || b.d.updatedAt - a.d.updatedAt);
  // 보여 줄 결과에만 미리보기 만들기
  const results = found.slice(0, limit).map((f) => ({ ...f.r, snippets: makeSnippets(f.d, q.terms) }));
  return { results, total: found.length };
}
