// 서식 명령. EditorState만 받아 변경(TransactionSpec)을 돌려주는 순수 함수로 두어 테스트하기 쉽게 한다.
import { EditorSelection, type EditorState, type Line, type TransactionSpec } from '@codemirror/state';

const URL_RE = /^(https?:\/\/|www\.)[^\s]+$/i;
export const isUrl = (s: string) => URL_RE.test(s.trim());

/**
 * 선택 영역을 기호로 감싸거나(굵게 ** 등) 이미 감싸져 있으면 벗긴다.
 * 선택이 없으면 기호 한 쌍을 넣고 커서를 가운데에 둔다.
 */
export function toggleWrap(state: EditorState, mark: string, endMark = mark): TransactionSpec {
  return state.changeByRange((range) => {
    const { from, to } = range;
    const before = state.sliceDoc(from - mark.length, from);
    const after = state.sliceDoc(to, to + endMark.length);
    // 선택 바깥에 기호가 있으면 제거
    if (before === mark && after === endMark) {
      return {
        changes: [
          { from: from - mark.length, to: from },
          { from: to, to: to + endMark.length },
        ],
        range: EditorSelection.range(from - mark.length, to - mark.length),
      };
    }
    // 선택 안쪽 양 끝에 기호가 있으면 제거
    const text = state.sliceDoc(from, to);
    if (text.length >= mark.length + endMark.length && text.startsWith(mark) && text.endsWith(endMark)) {
      const inner = text.slice(mark.length, text.length - endMark.length);
      return {
        changes: { from, to, insert: inner },
        range: EditorSelection.range(from, from + inner.length),
      };
    }
    return {
      changes: [
        { from, insert: mark },
        { from: to, insert: endMark },
      ],
      range: EditorSelection.range(from + mark.length, to + mark.length),
    };
  });
}

/** 선택된 줄들(빈 선택이면 커서 줄) */
function selectedLines(state: EditorState): Line[] {
  const seen = new Set<number>();
  const lines: Line[] = [];
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number;
    let last = state.doc.lineAt(r.to).number;
    // 줄 맨 앞까지 선택한 경우 그 줄은 제외
    if (last > first && state.doc.line(last).from === r.to) last--;
    for (let n = first; n <= last; n++) {
      if (!seen.has(n)) {
        seen.add(n);
        lines.push(state.doc.line(n));
      }
    }
  }
  return lines;
}

// 줄 앞 기호 패턴: 들여쓰기 + (인용 | 목록 | 체크박스)
const INDENT = /^(\s*)/;
const LIST_PREFIX = /^(\s*)([-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/;
const TASK_PREFIX = /^(\s*)[-*+]\s+\[([ xX])\]\s+/;
const BULLET_PREFIX = /^(\s*)[-*+]\s+(?!\[[ xX]\])/;
const ORDERED_PREFIX = /^(\s*)\d+[.)]\s+/;
const QUOTE_PREFIX = /^(\s*)>\s?/;
const HEADING_PREFIX = /^(#{1,6})\s+/;

export type LineKind = 'bullet' | 'ordered' | 'task' | 'quote';

/** 줄 앞 기호(글머리/번호/체크박스/인용) 켜고 끄기 */
export function toggleLinePrefix(state: EditorState, kind: LineKind): TransactionSpec {
  const lines = selectedLines(state);
  const test = { bullet: BULLET_PREFIX, ordered: ORDERED_PREFIX, task: TASK_PREFIX, quote: QUOTE_PREFIX }[kind];
  const nonEmpty = lines.filter((l) => l.text.trim() !== '');
  const allHave = (nonEmpty.length ? nonEmpty : lines).every((l) => test.test(l.text));
  const changes: { from: number; to: number; insert: string }[] = [];
  let num = 1;
  for (const line of lines) {
    if (lines.length > 1 && line.text.trim() === '') continue;
    const text = line.text;
    let next: string;
    if (allHave) {
      next = text.replace(test, '$1');
    } else if (kind === 'quote') {
      next = `> ${text}`;
    } else {
      const indent = text.match(INDENT)![1];
      const body = text.replace(LIST_PREFIX, '').replace(INDENT, '');
      const prefix = kind === 'bullet' ? '- ' : kind === 'task' ? '- [ ] ' : `${num++}. `;
      next = indent + prefix + body;
    }
    if (next !== text) changes.push({ from: line.from, to: line.to, insert: next });
  }
  const spec: TransactionSpec = { changes };
  // 한 줄에 커서만 있을 때는 커서를 줄 끝으로
  if (lines.length === 1 && state.selection.main.empty && changes.length) {
    const c = changes[0];
    spec.selection = EditorSelection.cursor(c.from + c.insert.length);
  }
  return spec;
}

/** 체크박스 완료/미완료 전환. 체크박스가 아닌 줄은 체크박스로 만든다. */
export function toggleTaskDone(state: EditorState): TransactionSpec {
  const lines = selectedLines(state);
  const changes: { from: number; to: number; insert: string }[] = [];
  for (const line of lines) {
    const m = line.text.match(TASK_PREFIX);
    if (m) {
      const pos = line.from + line.text.indexOf('[') + 1;
      changes.push({ from: pos, to: pos + 1, insert: m[2] === ' ' ? 'x' : ' ' });
    } else if (line.text.trim() !== '' || lines.length === 1) {
      const indent = line.text.match(INDENT)![1];
      const body = line.text.replace(LIST_PREFIX, '').replace(INDENT, '');
      changes.push({ from: line.from, to: line.to, insert: `${indent}- [ ] ${body}` });
    }
  }
  return { changes };
}

/** 특정 위치의 체크박스 전환(미리보기에서 클릭) */
export function toggleTaskAt(state: EditorState, lineNo: number): TransactionSpec | null {
  if (lineNo < 1 || lineNo > state.doc.lines) return null;
  const line = state.doc.line(lineNo);
  const m = line.text.match(TASK_PREFIX);
  if (!m) return null;
  const pos = line.from + line.text.indexOf('[') + 1;
  return { changes: { from: pos, to: pos + 1, insert: m[2] === ' ' ? 'x' : ' ' } };
}

/** 제목 단계 순환: 없음 → # → ## → ### → 없음. level을 주면 그 단계로 설정/해제 */
export function cycleHeading(state: EditorState, level?: number): TransactionSpec {
  const changes = selectedLines(state).map((line) => {
    const m = line.text.match(HEADING_PREFIX);
    const cur = m ? m[1].length : 0;
    const body = line.text.replace(HEADING_PREFIX, '');
    const nextLevel = level !== undefined ? (cur === level ? 0 : level) : cur >= 3 ? 0 : cur + 1;
    return { from: line.from, to: line.to, insert: nextLevel ? `${'#'.repeat(nextLevel)} ${body}` : body };
  });
  const spec: TransactionSpec = { changes };
  if (changes.length === 1 && state.selection.main.empty) {
    spec.selection = EditorSelection.cursor(changes[0].from + changes[0].insert.length);
  }
  return spec;
}

/** 링크 넣기: 선택이 URL이면 [](url), 일반 텍스트면 [텍스트](), 없으면 []() */
export function insertLink(state: EditorState, url = ''): TransactionSpec {
  return state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    if (!url && text && isUrl(text)) {
      const insert = `[](${text})`;
      return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(range.from + 1) };
    }
    const insert = `[${text}](${url})`;
    // 텍스트가 있으면 커서를 URL 자리로, 없으면 텍스트 자리로
    const cursor = text ? range.from + text.length + 3 + url.length : range.from + 1;
    return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(cursor) };
  });
}

/** URL을 붙여넣을 때 선택한 텍스트가 있으면 [텍스트](URL)로 바꾼다. 해당 없으면 null */
export function linkifyPaste(state: EditorState, pasted: string): TransactionSpec | null {
  const url = pasted.trim();
  if (!isUrl(url) || /\s/.test(url)) return null;
  const sel = state.selection.main;
  if (sel.empty) return null;
  const text = state.sliceDoc(sel.from, sel.to);
  if (isUrl(text) || text.includes('\n')) return null;
  const insert = `[${text}](${url})`;
  return {
    changes: { from: sel.from, to: sel.to, insert },
    selection: EditorSelection.cursor(sel.from + insert.length),
  };
}

/** 커서 위치에 블록(표, 구분선 등)을 독립된 줄로 넣는다 */
export function insertBlock(state: EditorState, block: string, cursorOffset = block.length): TransactionSpec {
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  const atLineStart = line.text.trim() === '';
  const prefix = atLineStart ? '' : '\n';
  const from = atLineStart ? line.from : line.to;
  const to = atLineStart ? line.to : line.to;
  const insert = prefix + block + '\n';
  return {
    changes: { from, to, insert },
    selection: EditorSelection.cursor(from + prefix.length + cursorOffset),
  };
}

export const TABLE_TEMPLATE = '| 제목1 | 제목2 |\n| --- | --- |\n|  |  |';

export function insertTable(state: EditorState): TransactionSpec {
  // 커서를 첫 데이터 칸에 둔다
  return insertBlock(state, TABLE_TEMPLATE, TABLE_TEMPLATE.lastIndexOf('|  |') + 2);
}

/** 코드 블록: 선택한 줄을 ``` 로 감싼다 */
export function insertCodeBlock(state: EditorState, lang = ''): TransactionSpec {
  const sel = state.selection.main;
  if (sel.empty) return insertBlock(state, '```' + lang + '\n\n```', 4 + lang.length);
  const first = state.doc.lineAt(sel.from);
  const last = state.doc.lineAt(sel.to);
  const body = state.sliceDoc(first.from, last.to);
  const insert = '```' + lang + '\n' + body + '\n```';
  return {
    changes: { from: first.from, to: last.to, insert },
    selection: EditorSelection.cursor(first.from + 3 + lang.length),
  };
}

export function insertHr(state: EditorState): TransactionSpec {
  return insertBlock(state, '---\n', 4);
}

const EMPTY_ITEM = /^(\s*)([-*+]\s+\[[ xX]\]|[-*+]|\d+[.)])\s*$/;

/**
 * 빈 목록 항목에서 Enter: 들여쓴 항목이면 한 단계 내어쓰기, 최상위면 기호를 지워 목록을 끝낸다.
 * 해당 없으면 null (기본 동작: 다음 항목 이어 쓰기)
 */
export function enterOnEmptyItem(state: EditorState, unit = '    '): TransactionSpec | null {
  const sel = state.selection.main;
  if (!sel.empty || state.selection.ranges.length > 1) return null;
  const line = state.doc.lineAt(sel.head);
  if (sel.head !== line.to) return null;
  const m = EMPTY_ITEM.exec(line.text);
  if (!m) return null;
  const indent = m[1];
  if (indent.length > 0) {
    // 한 단계 내어쓰기 (탭이면 탭 하나, 공백이면 unit 길이만큼)
    const cut = indent.endsWith('\t') ? 1 : Math.min(indent.length, unit.length);
    const next = indent.slice(0, indent.length - cut) + line.text.slice(indent.length).trimEnd() + ' ';
    return { changes: { from: line.from, to: line.to, insert: next }, selection: EditorSelection.cursor(line.from + next.length) };
  }
  return { changes: { from: line.from, to: line.to, insert: '' }, selection: EditorSelection.cursor(line.from) };
}

/** 커서 위치에 텍스트를 넣는다(태그 # 등) */
export function insertText(state: EditorState, text: string): TransactionSpec {
  return state.changeByRange((range) => ({
    changes: { from: range.from, to: range.to, insert: text },
    range: EditorSelection.cursor(range.from + text.length),
  }));
}
