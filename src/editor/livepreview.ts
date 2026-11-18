// 라이브 프리뷰: 커서가 없는 부분은 마크다운 기호를 숨기고 렌더링된 모습으로 보여 준다(옵시디언 방식).
// 커서(선택)가 닿은 요소나 줄에서는 원래 기호가 다시 보인다.
import { syntaxTree } from '@codemirror/language';
import { type EditorState, type Range, StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';
import type { SyntaxNodeRef } from '@lezer/common';
import { toggleTaskAt } from './commands';
import { editorHost, linkGuard } from './host';
import { parseWikiTarget } from './markdown-ext';
import { renderMarkdown } from '../render/markdown';
import { renderMath } from '../render/math';
import { hydrate } from '../render/hydrate';
import { calloutLabelText } from '../render/callout';
import { kindOf } from '../core/attachments';
import { mountEmbed } from '../media/embed';
import type { SyntaxNode } from '@lezer/common';

/** 첨부파일·노트 목록이 바뀌었을 때 장식을 다시 계산하게 하는 신호 */
export const refreshPreview = StateEffect.define<null>();

// ---------- 도우미 ----------

/** 선택이 [from, to] 범위에 닿는지 */
function touches(state: EditorState, from: number, to: number): boolean {
  for (const r of state.selection.ranges) if (r.from <= to && r.to >= from) return true;
  return false;
}

/** 선택이 걸친 줄 번호 집합 */
function activeLines(state: EditorState): Set<number> {
  const set = new Set<number>();
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    const b = state.doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) set.add(n);
  }
  return set;
}

const hide = Decoration.replace({});

// ---------- 위젯 ----------

class BulletWidget extends WidgetType {
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-bullet';
    s.textContent = '•';
    return s;
  }
  eq() {
    return true;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly line: number) {
    super();
  }
  eq(o: CheckboxWidget) {
    return o.checked === this.checked && o.line === this.line;
  }
  toDOM(view: EditorView) {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cm-task-box';
    box.checked = this.checked;
    box.setAttribute('aria-label', this.checked ? '완료됨' : '할 일');
    // 편집기가 포커스·커서를 옮기지 않도록 mousedown을 막고 클릭으로만 전환
    box.addEventListener('mousedown', (e) => e.preventDefault());
    box.addEventListener('click', (e) => {
      e.preventDefault();
      const spec = toggleTaskAt(view.state, this.line);
      if (spec) view.dispatch(spec);
    });
    return box;
  }
  ignoreEvent() {
    return true;
  }
}

class HrWidget extends WidgetType {
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-hr';
    return s;
  }
  eq() {
    return true;
  }
}

class CalloutLabelWidget extends WidgetType {
  constructor(readonly label: string) {
    super();
  }
  eq(o: CalloutLabelWidget) {
    return o.label === this.label;
  }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-callout-label';
    s.textContent = this.label;
    return s;
  }
}

class MathWidget extends WidgetType {
  constructor(readonly tex: string, readonly display: boolean) {
    super();
  }
  eq(o: MathWidget) {
    return o.tex === this.tex && o.display === this.display;
  }
  toDOM() {
    const el = document.createElement(this.display ? 'div' : 'span');
    el.className = this.display ? 'cm-math-block' : 'cm-math-inline';
    el.textContent = this.tex;
    void renderMath(this.tex, this.display).then((html) => (el.innerHTML = html));
    return el;
  }
  ignoreEvent() {
    return false; // 클릭하면 편집기가 커서를 옮겨 원문이 보이게
  }
}

/** ![[첨부]] 임베드(이미지, PDF, 오디오/비디오, 파일 카드) */
class EmbedWidget extends WidgetType {
  constructor(readonly raw: string, readonly version: string) {
    super();
  }
  eq(o: EmbedWidget) {
    return o.raw === this.raw && o.version === this.version;
  }
  toDOM(view: EditorView) {
    const el = document.createElement('span');
    const host = view.state.facet(editorHost);
    if (host) {
      const dispose = mountEmbed(el, this.raw, host);
      (el as HTMLElement & { _dispose?: () => void })._dispose = dispose;
    }
    // 이미지가 늦게 로드되면 높이가 바뀌므로 다시 재기
    el.addEventListener('load', () => view.requestMeasure(), true);
    return el;
  }
  destroy(dom: HTMLElement) {
    (dom as HTMLElement & { _dispose?: () => void })._dispose?.();
  }
  get estimatedHeight() {
    return 200;
  }
  ignoreEvent(e: Event) {
    // PDF 뷰어·오디오 등 위젯 안 조작은 위젯이 처리, 이미지 클릭은 편집기가 커서를 옮겨 원문 표시
    return !(e.type === 'mousedown' && (e.target as HTMLElement).tagName === 'IMG');
  }
}

class HtmlBlockWidget extends WidgetType {
  constructor(readonly source: string, readonly cls: string) {
    super();
  }
  eq(o: HtmlBlockWidget) {
    return o.source === this.source;
  }
  toDOM(view: EditorView) {
    const div = document.createElement('div');
    div.className = `cm-block-widget ${this.cls} md-body`;
    div.innerHTML = renderMarkdown(this.source);
    hydrate(div, view.state.facet(editorHost));
    return div;
  }
  ignoreEvent() {
    return false;
  }
}

// ---------- 인라인 장식 (보이는 영역만 계산) ----------

const CALLOUT_RE = /^(\s*>\s*)\[!([\w-]+)\]([+-]?)\s?/;
const INLINE_MATH_RE = /(?<![\\$])\$(?!\s)([^$\n]+?)(?<![\s\\])\$(?!\d)/g;
const FOOTREF_RE = /\[\^[^\]\s]+\]/g;
const BLOCK_ID_RE = /[ \t]\^[A-Za-z0-9-]+[ \t]*$/gm;

function isCode(state: EditorState, pos: number): boolean {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    if (n.name === 'InlineCode' || n.name === 'FencedCode' || n.name === 'CodeBlock' || n.name === 'HTMLBlock') return true;
  }
  return false;
}

function buildInline(view: EditorView): DecorationSet {
  const { state } = view;
  const deco: Range<Decoration>[] = [];
  const active = activeLines(state);
  const host = state.facet(editorHost);
  const lineOf = (pos: number) => state.doc.lineAt(pos);
  const lineActive = (pos: number) => active.has(lineOf(pos).number);

  /** 기호 숨기기(뒤따르는 공백 하나 포함 옵션) */
  const hideRange = (from: number, to: number, withSpace = false) => {
    if (withSpace && state.sliceDoc(to, to + 1) === ' ') to++;
    if (to > from) deco.push(hide.range(from, to));
  };

  // 맨 위 YAML frontmatter: 작은 고정폭 글꼴로 구분
  let fmEnd = -1;
  if (state.doc.lines > 1 && state.doc.line(1).text === '---') {
    for (let n = 2; n <= Math.min(state.doc.lines, 200); n++) {
      if (/^(---|\.\.\.)\s*$/.test(state.doc.line(n).text)) {
        fmEnd = state.doc.line(n).to;
        for (let k = 1; k <= n; k++) {
          deco.push(Decoration.line({ class: `cm-frontmatter${k === 1 ? ' cm-frontmatter-begin' : ''}${k === n ? ' cm-frontmatter-end' : ''}` }).range(state.doc.line(k).from));
        }
        break;
      }
    }
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node: SyntaxNodeRef) => {
        if (node.to <= fmEnd) return false; // frontmatter 안은 마크다운으로 꾸미지 않음
        const name = node.name;
        const m = /^ATXHeading(\d)$/.exec(name);
        if (m) {
          deco.push(Decoration.line({ class: `cm-h cm-h${m[1]}` }).range(lineOf(node.from).from));
          return;
        }
        switch (name) {
          case 'HeaderMark': {
            const parent = node.node.parent;
            if (parent && parent.name.startsWith('ATXHeading') && !lineActive(node.from)) {
              // 줄 끝의 닫는 # 은 앞 공백과 함께 숨김
              if (node.from > parent.from) hideRange(node.from - (state.sliceDoc(node.from - 1, node.from) === ' ' ? 1 : 0), node.to);
              else hideRange(node.from, node.to, true);
            }
            return;
          }
          case 'EmphasisMark':
          case 'StrikethroughMark':
          case 'HighlightMark':
          case 'CodeMark': {
            const parent = node.node.parent;
            if (!parent) return;
            if (name === 'CodeMark' && parent.name !== 'InlineCode') return; // 코드 블록 울타리는 그대로
            if (!touches(state, parent.from, parent.to)) hideRange(node.from, node.to);
            return;
          }
          case 'Link': {
            if (touches(state, node.from, node.to)) return;
            const marks = node.node.getChildren('LinkMark');
            const url = node.node.getChild('URL');
            if (marks.length < 2 || !url) return;
            const textFrom = marks[0].to;
            const textTo = marks[1].from;
            if (textTo <= textFrom) return;
            hideRange(node.from, textFrom);
            hideRange(textTo, node.to);
            deco.push(
              Decoration.mark({
                class: 'cm-link-rendered',
                attributes: { 'data-href': state.sliceDoc(url.from, url.to) },
              }).range(textFrom, textTo),
            );
            return false;
          }
          case 'URL': {
            // 꾸밈 없는 URL(자동 링크)
            const parent = node.node.parent;
            if (parent && (parent.name === 'Link' || parent.name === 'Image' || parent.name === 'LinkReference')) return;
            const href = state.sliceDoc(node.from, node.to).replace(/^<|>$/g, '');
            deco.push(Decoration.mark({ class: 'cm-url', attributes: { 'data-href': href } }).range(node.from, node.to));
            return;
          }
          case 'WikiLink':
          case 'Embed': {
            const target = node.node.getChild('WikiLinkTarget');
            if (!target) return false;
            const raw = state.sliceDoc(target.from, target.to);
            const parsed = parseWikiTarget(raw);
            const noteName = parsed.name;
            const kind = kindOf(noteName);
            const isEmbed = name === 'Embed';
            const touched = touches(state, node.from, node.to);
            // 첨부파일 임베드: 커서가 없으면 위젯으로, 이미지는 편집 중에도 아래에 미리보기
            if (isEmbed && host && noteName) {
              const att = kind === 'note' ? null : host.findAttachment(noteName);
              const version = kind === 'note' ? host.noteVersion(noteName) || 'missing' : att ? `${att.id}:${att.updatedAt}` : 'missing';
              if (!touched) {
                deco.push(Decoration.replace({ widget: new EmbedWidget(raw, version) }).range(node.from, node.to));
                return false;
              }
              if (kind === 'image') {
                deco.push(Decoration.widget({ widget: new EmbedWidget(raw, version), side: 1 }).range(node.to));
              }
            }
            // "|300"은 임베드에서는 크기, 첨부 링크에서는 별칭
            const alias = isEmbed ? null : parsed.alias;
            const resolved =
              !noteName || !host || (kind === 'note' ? host.noteExists(noteName) : !!host.findAttachment(noteName));
            const cls = `cm-wikilink${isEmbed ? ' cm-embed' : ''}${kind !== 'note' ? ' cm-attachment-link' : ''}${resolved ? '' : ' cm-unresolved'}`;
            if (touched) {
              deco.push(Decoration.mark({ class: cls }).range(target.from, target.to));
              return false;
            }
            hideRange(node.from, target.from);
            hideRange(target.to, node.to);
            let shownFrom = target.from;
            if (alias) {
              shownFrom = target.from + raw.indexOf('|') + 1;
              hideRange(target.from, shownFrom);
            }
            if (target.to > shownFrom) {
              deco.push(Decoration.mark({ class: cls, attributes: { 'data-wikilink': raw } }).range(shownFrom, target.to));
            }
            return false;
          }
          case 'Hashtag': {
            const tag = state.sliceDoc(node.from + 1, node.to);
            // 커서가 태그 안에 있으면 편집할 수 있게 클릭 이동을 끈다
            const attrs: Record<string, string> = touches(state, node.from, node.to) ? {} : { 'data-tag': tag };
            deco.push(Decoration.mark({ class: 'cm-hashtag', attributes: attrs }).range(node.from, node.to));
            return;
          }
          case 'ListMark': {
            const item = node.node.parent;
            const list = item?.parent;
            if (!item || !list || lineActive(node.from)) return;
            if (item.getChild('Task')) {
              hideRange(node.from, node.to, true); // 체크박스 앞 "- " 숨김
            } else if (list.name === 'BulletList') {
              deco.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to));
            }
            return;
          }
          case 'TaskMarker': {
            const text = state.sliceDoc(node.from, node.to);
            const checked = /x/i.test(text);
            const line = lineOf(node.from);
            if (checked) deco.push(Decoration.line({ class: 'cm-task-done' }).range(line.from));
            if (!touches(state, node.from, node.to)) {
              deco.push(Decoration.replace({ widget: new CheckboxWidget(checked, line.number) }).range(node.from, node.to));
            }
            return;
          }
          case 'Blockquote': {
            const first = lineOf(node.from);
            const last = lineOf(node.to);
            const cm = CALLOUT_RE.exec(first.text);
            const type = cm?.[2].toLowerCase();
            for (let n = first.number; n <= last.number; n++) {
              const l = state.doc.line(n);
              const cls = cm
                ? `cm-callout cm-callout-${type}${n === first.number ? ' cm-callout-title' : ''}${n === last.number ? ' cm-callout-end' : ''}`
                : 'cm-quote';
              deco.push(Decoration.line({ class: cls }).range(l.from));
            }
            if (cm && !active.has(first.number)) {
              const markFrom = first.from + cm[1].length;
              const markTo = first.from + cm[0].length;
              const rest = first.text.slice(cm[0].length).trim();
              if (rest) hideRange(markFrom, markTo);
              else deco.push(Decoration.replace({ widget: new CalloutLabelWidget(calloutLabelText(cm[2])) }).range(markFrom, markTo));
            }
            return;
          }
          case 'QuoteMark': {
            if (!lineActive(node.from)) hideRange(node.from, node.to, true);
            return;
          }
          case 'HorizontalRule': {
            if (!lineActive(node.from)) deco.push(Decoration.replace({ widget: new HrWidget() }).range(node.from, node.to));
            return;
          }
          case 'FencedCode': {
            const first = lineOf(node.from);
            const last = lineOf(node.to);
            for (let n = first.number; n <= last.number; n++) {
              let cls = 'cm-codeblock';
              if (n === first.number) cls += ' cm-codeblock-begin';
              if (n === last.number) cls += ' cm-codeblock-end';
              deco.push(Decoration.line({ class: cls }).range(state.doc.line(n).from));
            }
            return false;
          }
          case 'Table':
            return false; // 표는 블록 위젯에서 처리
        }
      },
    });

    // 정규식 기반: 인라인 수식, 각주 참조
    const text = state.sliceDoc(from, to);
    for (const mm of text.matchAll(INLINE_MATH_RE)) {
      const a = from + mm.index!;
      const b = a + mm[0].length;
      if (state.sliceDoc(a - 1, a) === '$' || state.sliceDoc(b, b + 1) === '$') continue; // $$ 블록 수식 제외
      if (isCode(state, a)) continue;
      if (touches(state, a, b)) deco.push(Decoration.mark({ class: 'cm-math-src' }).range(a, b));
      else deco.push(Decoration.replace({ widget: new MathWidget(mm[1], false) }).range(a, b));
    }
    // 문단 끝 블록 ID(^abc): 커서가 없는 줄에서는 숨김
    for (const mm of text.matchAll(BLOCK_ID_RE)) {
      const a = from + mm.index!;
      const b = a + mm[0].length;
      if (isCode(state, a)) continue;
      if (lineActive(a)) deco.push(Decoration.mark({ class: 'cm-blockid' }).range(a, b));
      else deco.push(hide.range(a, b));
    }
    for (const mm of text.matchAll(FOOTREF_RE)) {
      const a = from + mm.index!;
      if (isCode(state, a)) continue;
      deco.push(Decoration.mark({ class: 'cm-footref' }).range(a, a + mm[0].length));
    }
  }
  return Decoration.set(deco, true);
}

const inlinePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildInline(view);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.selectionSet ||
        u.focusChanged ||
        syntaxTree(u.startState) !== syntaxTree(u.state) ||
        u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshPreview)))
      ) {
        this.decorations = buildInline(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

// ---------- 블록 장식 (표, 블록 수식): StateField 필요 ----------

const BLOCK_MATH_RE = /^\$\$[ \t]*\n?([\s\S]*?)\n?[ \t]*\$\$[ \t]*$/gm;

function buildBlocks(state: EditorState): DecorationSet {
  const deco: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === 'FencedCode' || node.name === 'CodeBlock') return false;
      if (node.name !== 'Table') return;
      const from = state.doc.lineAt(node.from).from;
      const to = state.doc.lineAt(node.to).to;
      if (!touches(state, from, to)) {
        deco.push(
          Decoration.replace({ widget: new HtmlBlockWidget(state.sliceDoc(from, to), 'cm-table-widget'), block: true }).range(from, to),
        );
      }
      return false;
    },
  });
  const text = state.doc.toString();
  for (const m of text.matchAll(BLOCK_MATH_RE)) {
    const from = m.index!;
    const to = from + m[0].length;
    if (isCode(state, from)) continue;
    if (touches(state, from, to)) continue;
    deco.push(Decoration.replace({ widget: new MathWidget(m[1].trim(), true), block: true }).range(from, to));
  }
  return Decoration.set(deco, true);
}

const blockField = StateField.define<DecorationSet>({
  create: buildBlocks,
  update(deco, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      syntaxTree(tr.startState) !== syntaxTree(tr.state) ||
      tr.effects.some((e) => e.is(refreshPreview))
    )
      return buildBlocks(tr.state);
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ---------- 링크 클릭 ----------

const linkClicks = EditorView.domEventHandlers({
  mousedown(e, view) {
    if (e.button !== 0) return false;
    if (Date.now() < linkGuard.until) {
      e.preventDefault();
      return true;
    }
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-href], [data-wikilink], [data-tag]');
    if (!el) return false;
    const host = view.state.facet(editorHost);
    if (!host) return false;
    if (el.dataset.tag) {
      e.preventDefault();
      host.openTag(el.dataset.tag);
      return true;
    }
    // 원문이 보이는 상태(cm-url)에서는 Ctrl/Cmd+클릭만 연다
    if (el.classList.contains('cm-url') && !(e.ctrlKey || e.metaKey)) return false;
    e.preventDefault();
    if (el.dataset.href) host.openUrl(el.dataset.href);
    else if (el.dataset.wikilink) host.openWikiLink(el.dataset.wikilink, e.ctrlKey || e.metaKey);
    return true;
  },
});

export const livePreview = [inlinePlugin, blockField, linkClicks];

/** 소스 모드에서도 쓰는 최소 장식(링크 클릭만) */
export const sourceModeLinks = linkClicks;
