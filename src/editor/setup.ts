// CodeMirror 6 구성: 마크다운 언어, 라이브 프리뷰, 단축키, 붙여넣기, 테마
import { Compartment, EditorState, Prec, type Extension, type TransactionSpec } from '@codemirror/state';
import { EditorView, keymap, placeholder, dropCursor, type Command } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentLess, indentMore, insertTab } from '@codemirror/commands';
import { indentUnit, syntaxHighlighting, HighlightStyle, indentOnInput } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { search, searchKeymap } from '@codemirror/search';
import { classHighlighter, tags as t } from '@lezer/highlight';
import { Hashtag, Highlight, WikiLink, mdTags } from './markdown-ext';
import { completion } from './complete';
import { startCompletion } from '@codemirror/autocomplete';
import { livePreview, sourceModeLinks } from './livepreview';
import { editorHost, type EditorHost } from './host';
import * as cmd from './commands';

/** 상태(EditorState)만으로 변경을 만드는 명령을 CodeMirror 명령으로 */
export function asCommand(make: (s: EditorState) => TransactionSpec | null): Command {
  return (view) => {
    // 한글 등 IME 조합 중에는 단축키가 입력을 깨뜨리지 않도록 건너뛴다
    if (view.composing) return false;
    const spec = make(view.state);
    if (!spec) return false;
    view.dispatch(view.state.update(spec, { scrollIntoView: true, userEvent: 'input.format' }));
    return true;
  };
}

export const commands = {
  bold: asCommand((s) => cmd.toggleWrap(s, '**')),
  italic: asCommand((s) => cmd.toggleWrap(s, '*')),
  strike: asCommand((s) => cmd.toggleWrap(s, '~~')),
  highlight: asCommand((s) => cmd.toggleWrap(s, '==')),
  code: asCommand((s) => cmd.toggleWrap(s, '`')),
  link: asCommand((s) => cmd.insertLink(s)),
  heading: asCommand((s) => cmd.cycleHeading(s)),
  bullet: asCommand((s) => cmd.toggleLinePrefix(s, 'bullet')),
  ordered: asCommand((s) => cmd.toggleLinePrefix(s, 'ordered')),
  task: asCommand((s) => cmd.toggleLinePrefix(s, 'task')),
  taskDone: asCommand((s) => cmd.toggleTaskDone(s)),
  quote: asCommand((s) => cmd.toggleLinePrefix(s, 'quote')),
  table: asCommand((s) => cmd.insertTable(s)),
  codeBlock: asCommand((s) => cmd.insertCodeBlock(s)),
  hr: asCommand((s) => cmd.insertHr(s)),
  // # 를 넣고 바로 태그 자동완성 목록을 연다
  tag: ((view) => {
    if (!asCommand((s) => cmd.insertText(s, '#'))(view)) return false;
    startCompletion(view);
    return true;
  }) as Command,
};

/** 목록 줄에서는 Tab/Shift+Tab으로 들여쓰기, 그 밖에는 탭 문자 입력 */
const LIST_LINE = /^\s*([-*+]|\d+[.)])\s/;
const onListLine = (view: EditorView) => LIST_LINE.test(view.state.doc.lineAt(view.state.selection.main.head).text);
const listIndent: Command = (view) => {
  if (view.composing) return false;
  return onListLine(view) || !view.state.selection.main.empty ? indentMore(view) : insertTab(view);
};
const listOutdent: Command = (view) => (view.composing ? false : indentLess(view));

const appKeymap = [
  { key: 'Mod-b', run: commands.bold },
  { key: 'Mod-i', run: commands.italic },
  { key: 'Mod-k', run: commands.link },
  { key: 'Mod-Shift-x', run: commands.strike },
  { key: 'Mod-Shift-h', run: commands.highlight },
  { key: 'Mod-`', run: commands.code },
  { key: 'Mod-Enter', run: commands.taskDone },
  { key: 'Mod-Shift-7', run: commands.ordered },
  { key: 'Mod-Shift-8', run: commands.bullet },
  { key: 'Mod-Shift-9', run: commands.task },
  { key: 'Tab', run: listIndent, shift: listOutdent },
];

/**
 * 붙여넣기: 파일(캡처 이미지 등)이면 첨부로 저장,
 * URL이고 텍스트가 선택돼 있으면 [텍스트](URL)로.
 * 끌어놓기: 파일이면 놓은 위치에 첨부로 넣는다.
 */
const pasteLink = EditorView.domEventHandlers({
  drop(e, view) {
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length) return false;
    const host = view.state.facet(editorHost);
    if (!host) return false;
    e.preventDefault();
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head;
    host.attachFiles(files, pos);
    return true;
  },
  paste(e, view) {
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.length) {
      const host = view.state.facet(editorHost);
      if (host) {
        e.preventDefault();
        host.attachFiles(files);
        return true;
      }
    }
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return false;
    const spec = cmd.linkifyPaste(view.state, text);
    if (!spec) return false;
    e.preventDefault();
    view.dispatch(view.state.update(spec, { userEvent: 'input.paste' }));
    return true;
  },
});

// 마크다운 요소 스타일(색/굵기). 크기·배경은 CSS(editor.css)에서.
const mdHighlight = HighlightStyle.define([
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--text-3)' },
  { tag: mdTags.highlight, class: 'cm-highlight' },
  { tag: t.monospace, class: 'cm-inline-code' },
  { tag: t.heading, fontWeight: '700' },
  { tag: t.link, color: 'var(--accent-strong)' },
  { tag: t.url, color: 'var(--accent-strong)' },
  { tag: t.processingInstruction, color: 'var(--text-3)' },
  { tag: t.quote, color: 'var(--text-2)' },
  { tag: t.meta, color: 'var(--text-3)' },
  { tag: t.contentSeparator, color: 'var(--text-3)' },
]);

const theme = EditorView.theme({
  '&': { fontSize: 'var(--font-size)', backgroundColor: 'transparent', color: 'var(--text)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font)', lineHeight: '1.75', overflow: 'visible' },
  '.cm-content': { padding: '0 0 40vh', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0' },
  '.cm-placeholder': { color: 'var(--text-3)' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--accent-soft)' },
  '.cm-panels': { backgroundColor: 'var(--surface-2)', color: 'var(--text)' },
  '.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, #f5c542 45%, transparent)' },
  // 자동완성 목록
  '.cm-tooltip': { border: '1px solid var(--border)', backgroundColor: 'var(--surface)', borderRadius: '12px', boxShadow: 'var(--shadow-2)', overflow: 'hidden' },
  '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font)', maxHeight: '15em', minWidth: '180px' },
  '.cm-tooltip-autocomplete > ul > li': { padding: '6px 12px !important', lineHeight: '1.6' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent-soft)', color: 'var(--accent-strong)' },
  '.cm-completionDetail': { marginLeft: '12px', color: 'var(--text-3)', fontStyle: 'normal', float: 'right' },
  '.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '700' },
});

// 검색 패널 한국어
const phrases = EditorState.phrases.of({
  Find: '찾기',
  Replace: '바꾸기',
  next: '다음',
  previous: '이전',
  all: '모두',
  'match case': '대소문자',
  regexp: '정규식',
  'by word': '단어',
  replace: '바꾸기',
  'replace all': '모두 바꾸기',
  close: '닫기',
});

export interface EditorOptions {
  host: EditorHost;
  livePreview: boolean;
  onChange: (text: string) => void;
  extraKeys?: { key: string; run: Command }[];
}

export const previewCompartment = new Compartment();

export function previewExtension(on: boolean): Extension {
  return on ? livePreview : sourceModeLinks;
}

export function createExtensions(opts: EditorOptions): Extension[] {
  return [
    history(),
    dropCursor(),
    indentOnInput(),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ spellcheck: 'false', autocapitalize: 'sentences', 'aria-label': '노트 본문' }),
    indentUnit.of('    '),
    EditorState.tabSize.of(4),
    markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [Highlight, WikiLink, Hashtag], addKeymap: true }),
    completion,
    syntaxHighlighting(mdHighlight),
    syntaxHighlighting(classHighlighter),
    search({ top: true }),
    // 빈 목록 항목 Enter 처리는 마크다운 기본 Enter보다 먼저
    Prec.highest(keymap.of([{ key: 'Enter', run: asCommand((s) => cmd.enterOnEmptyItem(s)) }])),
    keymap.of([...(opts.extraKeys ?? []), ...appKeymap, ...searchKeymap, ...historyKeymap, ...defaultKeymap]),
    previewCompartment.of(previewExtension(opts.livePreview)),
    placeholder('내용을 입력하세요'),
    pasteLink,
    phrases,
    theme,
    editorHost.of(opts.host),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) opts.onChange(u.state.doc.toString());
    }),
  ];
}
