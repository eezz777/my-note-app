// 읽기 모드 렌더러(markdown-it). 옵시디언 문법(형광펜, 위키링크, 임베드, 콜아웃, 블록 ID, 수식, 체크박스)을 지원한다.
// 결과 HTML은 DOMPurify로 정리해 노트 안의 스크립트가 실행되지 않게 한다.
import MarkdownIt, { type StateBlock, type StateCore, type StateInline } from 'markdown-it';
// @ts-expect-error 타입 정의 없음
import footnote from 'markdown-it-footnote';
import DOMPurify from 'dompurify';
import { calloutLabelText } from './callout';
import { readTagAt } from '../core/tags';

const md = new MarkdownIt({ html: true, linkify: true, breaks: true, typographer: false });
md.use(footnote);
md.linkify.set({ fuzzyEmail: false });

// ---------- ==형광펜== ----------
function markRule(state: StateInline, silent: boolean): boolean {
  const start = state.pos;
  const src = state.src;
  if (src.charCodeAt(start) !== 0x3d || src.charCodeAt(start + 1) !== 0x3d || src.charCodeAt(start + 2) === 0x3d) return false;
  const end = src.indexOf('==', start + 2);
  if (end < 0 || end === start + 2 || end > state.posMax) return false;
  if (/\s/.test(src[start + 2]) || /\s/.test(src[end - 1])) return false;
  if (!silent) {
    const oldMax = state.posMax;
    state.push('mark_open', 'mark', 1);
    state.pos = start + 2;
    state.posMax = end;
    state.md.inline.tokenize(state);
    state.posMax = oldMax;
    state.push('mark_close', 'mark', -1);
  }
  state.pos = end + 2;
  return true;
}
md.inline.ruler.before('emphasis', 'mark', markRule);

// ---------- [[위키링크]] / ![[임베드]] ----------
function wikiRule(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  let pos = state.pos;
  let embed = false;
  if (src.charCodeAt(pos) === 0x21 /* ! */ && src.startsWith('[[', pos + 1)) {
    embed = true;
    pos++;
  } else if (!src.startsWith('[[', pos)) return false;
  const close = src.indexOf(']]', pos + 2);
  if (close < 0 || close > state.posMax) return false;
  const raw = src.slice(pos + 2, close);
  if (!raw.trim() || raw.includes('\n') || raw.includes('[')) return false;
  if (!silent) {
    const t = state.push(embed ? 'wiki_embed' : 'wikilink', '', 0);
    t.content = raw;
  }
  state.pos = close + 2;
  return true;
}
md.inline.ruler.before('link', 'wikilink', wikiRule);

const esc = (s: string) => md.utils.escapeHtml(s);

// ---------- #태그 ----------
function tagRule(state: StateInline, silent: boolean): boolean {
  if (state.src.charCodeAt(state.pos) !== 0x23 /* # */) return false;
  const hit = readTagAt(state.src.slice(0, state.posMax), state.pos);
  if (!hit) return false;
  if (!silent) state.push('hashtag', '', 0).content = hit.tag;
  state.pos = hit.to;
  return true;
}
md.inline.ruler.before('emphasis', 'hashtag', tagRule);
md.renderer.rules.hashtag = (tokens, idx) => {
  const t = esc(tokens[idx].content);
  return `<a class="tag" href="#" data-tag="${t}">#${t}</a>`;
};

md.renderer.rules.wikilink = (tokens, idx) => {
  const raw = tokens[idx].content;
  const bar = raw.indexOf('|');
  const shown = bar >= 0 ? raw.slice(bar + 1) : raw;
  return `<a class="wikilink" href="#" data-wikilink="${esc(raw)}">${esc(shown)}</a>`;
};
md.renderer.rules.wiki_embed = (tokens, idx) => {
  const raw = tokens[idx].content;
  return `<span class="embed" data-embed="${esc(raw)}">${esc(raw)}</span>`;
};

// ---------- 수식 $...$ / $$...$$ ----------
function mathInline(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;
  if (src.charCodeAt(start) !== 0x24 || src.charCodeAt(start + 1) === 0x24) return false;
  if (start > 0 && src.charCodeAt(start - 1) === 0x5c) return false;
  if (/\s/.test(src[start + 1] ?? ' ')) return false;
  let end = start + 1;
  while ((end = src.indexOf('$', end)) >= 0) {
    if (src.charCodeAt(end - 1) !== 0x5c) break;
    end++;
  }
  if (end < 0 || end > state.posMax || /\s/.test(src[end - 1]) || /\d/.test(src[end + 1] ?? '')) return false;
  if (!silent) state.push('math_inline', '', 0).content = src.slice(start + 1, end);
  state.pos = end + 1;
  return true;
}
function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const pos = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  const first = state.src.slice(pos, max);
  if (!first.startsWith('$$')) return false;
  let content = first.slice(2);
  let line = startLine;
  let found = content.trimEnd().endsWith('$$') && content.trim().length > 2;
  if (found) content = content.trimEnd().slice(0, -2);
  while (!found && ++line < endLine) {
    const l = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
    if (l.trimEnd().endsWith('$$')) {
      content += '\n' + l.trimEnd().slice(0, -2);
      found = true;
    } else content += '\n' + l;
  }
  if (!found) return false;
  if (silent) return true;
  const t = state.push('math_block', 'div', 0);
  t.content = content.trim();
  t.map = [startLine, line + 1];
  state.line = line + 1;
  return true;
}
md.inline.ruler.after('escape', 'math_inline', mathInline);
md.block.ruler.before('fence', 'math_block', mathBlock, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
md.renderer.rules.math_inline = (tokens, idx) => `<span class="math" data-tex="${esc(tokens[idx].content)}">${esc(tokens[idx].content)}</span>`;
md.renderer.rules.math_block = (tokens, idx) =>
  `<div class="math math-display" data-tex="${esc(tokens[idx].content)}">${esc(tokens[idx].content)}</div>`;

// ---------- 콜아웃, 블록 ID, 체크박스, 제목 표시 (inline 파싱 전에 내용 조정) ----------
const CALLOUT_RE = /^\[!([\w-]+)\]([+-]?)[ \t]*(.*)$/;
const BLOCK_ID_RE = /\s\^([A-Za-z0-9-]+)\s*$/;
const TASK_RE = /^\[([ xX])\]\s+/;

function preInline(state: StateCore) {
  const tokens = state.tokens;
  const lineOffset: number = (state.env as RenderEnv)?.lineOffset ?? 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // 콜아웃: > [!type] 제목
    if (t.type === 'blockquote_open' && tokens[i + 1]?.type === 'paragraph_open' && tokens[i + 2]?.type === 'inline') {
      const inline = tokens[i + 2];
      const firstLine = inline.content.split('\n')[0];
      const m = CALLOUT_RE.exec(firstLine);
      if (m) {
        const type = m[1].toLowerCase();
        t.attrJoin('class', `callout callout-${type}`);
        t.attrSet('data-callout', type);
        const title = m[3].trim() || calloutLabelText(type);
        inline.content = inline.content.slice(firstLine.length + 1);
        const titleTok = new state.Token('html_block', '', 0);
        titleTok.content = `<div class="callout-title">${esc(title)}</div>\n`;
        tokens.splice(i + 1, 0, titleTok);
        if (!inline.content.trim()) {
          // 제목만 있는 콜아웃: 빈 문단 제거
          tokens.splice(i + 2, 3);
        }
        continue;
      }
    }
    // 제목: [[노트#제목]] 이동용 표시
    if (t.type === 'heading_open' && tokens[i + 1]?.type === 'inline') {
      t.attrSet('data-heading', tokens[i + 1].content.trim());
    }
    if (t.type === 'inline') {
      // 문단 끝 ^블록ID
      const m = BLOCK_ID_RE.exec(t.content);
      const open = tokens[i - 1];
      if (m && open && (open.type === 'paragraph_open' || open.type === 'heading_open')) {
        t.content = t.content.slice(0, m.index);
        open.attrSet('data-block-id', m[1]);
        // 목록 항목 안의 문단이면 항목에도 표시
        for (let j = i - 2; j >= 0 && j >= i - 3; j--) {
          if (tokens[j].type === 'list_item_open') tokens[j].attrSet('data-block-id', m[1]);
        }
      }
      // 체크박스: - [ ] 할 일
      const li = tokens[i - 2];
      const tm = TASK_RE.exec(t.content);
      if (tm && li?.type === 'list_item_open' && open?.type === 'paragraph_open') {
        const checked = tm[1] !== ' ';
        t.content = t.content.slice(tm[0].length);
        const lineNo = (li.map?.[0] ?? 0) + 1 + lineOffset;
        li.attrJoin('class', `task-list-item${checked ? ' done' : ''}`);
        const box = new state.Token('html_inline', '', 0);
        box.content = `<input type="checkbox" class="task-box" data-line="${lineNo}"${checked ? ' checked' : ''}> `;
        // inline 파싱 뒤에 앞쪽에 붙이도록 표시
        (t as unknown as { taskBox?: typeof box }).taskBox = box;
      }
    }
  }
}
md.core.ruler.before('inline', 'obsidian_pre', preInline);
md.core.ruler.after('inline', 'task_box', (state) => {
  for (const t of state.tokens) {
    const box = (t as unknown as { taskBox?: never }).taskBox;
    if (box && t.children) t.children.unshift(box);
  }
});
// 체크박스가 있는 목록 자체에 표시
md.core.ruler.push('task_list_class', (state) => {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type === 'list_item_open' && String(tokens[i].attrGet('class') ?? '').includes('task-list-item')) {
      for (let j = i - 1; j >= 0; j--) {
        const tt = tokens[j];
        if ((tt.type === 'bullet_list_open' || tt.type === 'ordered_list_open') && tt.level === tokens[i].level - 1) {
          tt.attrJoin('class', 'contains-task-list');
          break;
        }
      }
    }
  }
});

// 외부 링크 표시
const defaultLinkOpen = md.renderer.rules.link_open ?? ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts));
md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
  const href = String(tokens[idx].attrGet('href') ?? '');
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) tokens[idx].attrJoin('class', 'external');
  return defaultLinkOpen(tokens, idx, opts, env, self);
};

// 넓은 표는 가로 스크롤
md.renderer.rules.table_open = () => '<div class="table-wrap"><table>\n';
md.renderer.rules.table_close = () => '</table></div>\n';

// ---------- frontmatter ----------
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/;

export interface RenderEnv {
  lineOffset?: number;
  [key: string]: unknown;
}

/** frontmatter를 떼어 내고 [본문, frontmatter, 본문 시작 줄 오프셋]을 돌려준다 */
export function splitFrontmatter(text: string): { body: string; yaml: string | null; offset: number } {
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return { body: text, yaml: null, offset: 0 };
  return { body: text.slice(m[0].length), yaml: m[1], offset: m[0].split('\n').length - 1 };
}

const purifyConfig = {
  ADD_ATTR: ['data-tag', 'data-wikilink', 'data-embed', 'data-tex', 'data-line', 'data-heading', 'data-block-id', 'data-callout'],
  FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form'],
};

export function sanitize(html: string): string {
  return DOMPurify.sanitize(html, purifyConfig) as string;
}

/** 마크다운 조각(표 등)을 HTML로 */
export function renderMarkdown(text: string, env: RenderEnv = {}): string {
  return sanitize(md.render(text, { ...env }));
}

/** 노트 전체를 HTML로(frontmatter는 속성 상자로) */
export function renderNote(text: string): string {
  const { body, yaml, offset } = splitFrontmatter(text);
  let props = '';
  if (yaml !== null && yaml.trim()) {
    const rows = yaml
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .map((l) => {
        const i = l.indexOf(':');
        return i > 0 && !/^\s/.test(l)
          ? `<div class="prop"><span class="prop-key">${esc(l.slice(0, i).trim())}</span><span class="prop-val">${esc(l.slice(i + 1).trim())}</span></div>`
          : `<div class="prop"><span class="prop-val">${esc(l)}</span></div>`;
      })
      .join('');
    props = `<div class="frontmatter">${rows}</div>`;
  }
  return sanitize(props + md.render(body, { lineOffset: offset } satisfies RenderEnv));
}
