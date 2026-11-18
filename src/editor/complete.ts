// 자동완성: # 태그, [[ 노트/첨부, [[노트# 제목, [[노트#^ 문단
import {
  acceptCompletion,
  autocompletion,
  closeCompletion,
  moveCompletionSelection,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { Prec, type ChangeSpec } from '@codemirror/state';
import { keymap, type Command, type EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { editorHost } from './host';
import { tagKey } from '../core/tags';
import { findBlocks, findHeadings, newBlockId } from '../core/links';

const TAG_TYPING = /(?:^|[\s(])#([\p{L}\p{N}\p{M}_\-/]*)$/u;

function inCode(ctx: CompletionContext, extra = /Code|Comment|HTML|URL|WikiLink|Embed/): boolean {
  for (let n: SyntaxNode | null = syntaxTree(ctx.state).resolveInner(ctx.pos, -1); n; n = n.parent) {
    if (extra.test(n.name)) return true;
  }
  return false;
}

function tagSource(ctx: CompletionContext): CompletionResult | null {
  const line = ctx.state.doc.lineAt(ctx.pos);
  const before = line.text.slice(0, ctx.pos - line.from);
  const m = TAG_TYPING.exec(before);
  if (!m) return null;
  // "# 제목"을 쓰려고 줄 맨 앞에 # 만 친 경우엔 제안하지 않음
  if (!m[1] && !ctx.explicit && before.trim() === '#') return null;
  if (inCode(ctx)) return null;
  const host = ctx.state.facet(editorHost);
  if (!host) return null;
  const typed = tagKey(m[1]);
  const from = ctx.pos - m[1].length;
  const options = host
    .listTags()
    .filter((t) => tagKey(t.name) !== typed)
    .map((t) => {
      const k = tagKey(t.name);
      // 앞부분 일치 > 중첩 태그의 부분 일치 > 포함
      const boost = k.startsWith(typed) ? 2 : k.includes('/' + typed) ? 1 : k.includes(typed) ? 0 : -1;
      return { t, boost };
    })
    .filter((o) => o.boost >= 0)
    .slice(0, 200)
    .map(({ t, boost }) => ({
      label: t.name,
      detail: `${t.count}`,
      type: 'keyword',
      boost: boost * 10 + Math.min(t.count, 9),
      apply: t.name + ' ',
    }));
  if (!options.length) return null;
  return { from, options, filter: false, validFor: /^[\p{L}\p{N}\p{M}_\-/]*$/u };
}

/** 커서 뒤에 ]] 가 이미 있으면 그만큼 건너뛰고, 없으면 붙인다 */
function closeAndPlace(view: EditorView, from: number, to: number, insert: string, extra: ChangeSpec[] = []) {
  const after = view.state.sliceDoc(to, to + 2);
  const hasClose = after === ']]';
  const text = insert + (hasClose ? '' : ']]');
  view.dispatch({
    changes: [{ from, to, insert: text }, ...(extra as ChangeSpec[])],
    selection: { anchor: from + text.length + (hasClose ? 2 : 0) },
    userEvent: 'input.complete',
  });
}

const WIKI_TYPING = /(!?)\[\[([^\[\]|]*)$/;

async function linkSource(ctx: CompletionContext): Promise<CompletionResult | null> {
  const line = ctx.state.doc.lineAt(ctx.pos);
  const before = line.text.slice(0, ctx.pos - line.from);
  const m = WIKI_TYPING.exec(before);
  if (!m) return null;
  if (inCode(ctx, /InlineCode|FencedCode|CodeBlock|HTML/)) return null;
  const host = ctx.state.facet(editorHost);
  if (!host) return null;
  const inner = m[2];
  const hash = inner.indexOf('#');

  // 1) 노트·첨부 이름
  if (hash < 0) {
    const from = ctx.pos - inner.length;
    const targets = host.listLinkTargets();
    const options: Completion[] = targets.map((t) => ({
      label: t.label,
      detail: t.detail,
      type: t.kind === 'note' ? 'text' : 'variable',
      boost: t.kind === 'note' ? 1 : 0,
      apply: (view, _c, f, to) => closeAndPlace(view, f, to, t.insert),
    }));
    return { from, options, validFor: /^[^\[\]|#]*$/ };
  }

  // 2) 제목 / 3) 문단
  const noteName = inner.slice(0, hash);
  const sub = inner.slice(hash + 1);
  const target = await host.getNoteText(noteName);
  if (!target) return null;
  const isSelf = target.id === host.currentNoteId();
  const text = isSelf ? ctx.state.doc.toString() : target.text;

  if (sub.startsWith('^')) {
    const from = ctx.pos - sub.length + 1;
    const blocks = findBlocks(text);
    const taken = blocks.map((b) => b.id ?? '');
    const options: Completion[] = blocks.map((b, i) => ({
      label: b.text.replace(/\s+/g, ' ').slice(0, 80),
      detail: b.id ? `^${b.id}` : '새 ID',
      type: 'text',
      boost: 99 - Math.min(i, 198), // 문서 순서대로 보이게
      apply: (view, _c, f, to) => {
        if (b.id) return closeAndPlace(view, f, to, b.id);
        const id = newBlockId(taken);
        if (isSelf) {
          // 지금 노트의 블록이면 같은 변경에 ^id 덧붙이기
          const l = view.state.doc.line(b.line + 1);
          const end = l.from + l.text.replace(/\s*$/, '').length;
          closeAndPlace(view, f, to, id, [{ from: end, to: l.to, insert: ` ^${id}` }]);
        } else {
          closeAndPlace(view, f, to, id);
          void host.addBlockId(target.id, b.line, id);
        }
      },
    }));
    return { from, options, validFor: /^[^\[\]|#^]*$/ };
  }

  const from = ctx.pos - sub.length;
  const hs = findHeadings(text);
  const options: Completion[] = hs.map((h, i) => ({
    label: h.text,
    detail: 'H' + h.level,
    type: 'keyword',
    boost: 99 - Math.min(i, 198), // 문서 순서대로 보이게
    section: undefined,
    apply: (view, _c, f, to) => closeAndPlace(view, f, to, h.text),
  }));
  return { from, options, validFor: /^[^\[\]|#^]*$/ };
}

/** IME(한글) 조합 중에는 Enter/Tab이 조합 확정에 쓰이도록 자동완성 선택을 하지 않는다 */
const guard = (cmd: Command): Command => (view) => (view.composing ? false : cmd(view));

export const completion = [
  autocompletion({
    override: [linkSource, tagSource],
    defaultKeymap: false,
    icons: false,
    closeOnBlur: true,
    activateOnTypingDelay: 80,
  }),
  Prec.highest(
    keymap.of([
      { key: 'ArrowDown', run: guard(moveCompletionSelection(true)) },
      { key: 'ArrowUp', run: guard(moveCompletionSelection(false)) },
      { key: 'Enter', run: guard(acceptCompletion) },
      { key: 'Tab', run: guard(acceptCompletion) },
      { key: 'Escape', run: closeCompletion },
    ]),
  ),
];
