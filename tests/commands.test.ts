import { EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
  cycleHeading,
  enterOnEmptyItem,
  insertLink,
  insertTable,
  linkifyPaste,
  toggleLinePrefix,
  toggleTaskAt,
  toggleTaskDone,
  toggleWrap,
} from '../src/editor/commands';

/** "|" 를 커서, "[ ]" 대신 {..} 로 선택을 표시한 문자열로 상태를 만든다 */
function st(doc: string): EditorState {
  const a = doc.indexOf('{');
  if (a >= 0) {
    const b = doc.indexOf('}');
    const text = doc.slice(0, a) + doc.slice(a + 1, b) + doc.slice(b + 1);
    return EditorState.create({ doc: text, selection: EditorSelection.range(a, b - 1), extensions: EditorState.allowMultipleSelections.of(true) });
  }
  const c = doc.indexOf('|');
  return EditorState.create({ doc: doc.replace('|', ''), selection: EditorSelection.cursor(c < 0 ? 0 : c) });
}

function apply(state: EditorState, spec: ReturnType<typeof toggleWrap>): string {
  const s = state.update(spec).state;
  const sel = s.selection.main;
  const d = s.doc.toString();
  if (sel.empty) return d.slice(0, sel.head) + '|' + d.slice(sel.head);
  return d.slice(0, sel.from) + '{' + d.slice(sel.from, sel.to) + '}' + d.slice(sel.to);
}

describe('toggleWrap', () => {
  it('선택을 감싸고 다시 누르면 벗긴다', () => {
    const s1 = st('안녕 {세상} 입니다');
    expect(apply(s1, toggleWrap(s1, '**'))).toBe('안녕 **{세상}** 입니다');
    const s2 = st('안녕 **{세상}** 입니다');
    expect(apply(s2, toggleWrap(s2, '**'))).toBe('안녕 {세상} 입니다');
    const s3 = st('안녕 {**세상**} 입니다');
    expect(apply(s3, toggleWrap(s3, '**'))).toBe('안녕 {세상} 입니다');
  });
  it('선택이 없으면 기호 쌍을 넣고 커서를 가운데에', () => {
    const s = st('a|b');
    expect(apply(s, toggleWrap(s, '=='))).toBe('a==|==b');
  });
});

describe('toggleLinePrefix', () => {
  it('글머리 목록 켜기/끄기', () => {
    const s = st('{첫째\n둘째}');
    const on = s.update(toggleLinePrefix(s, 'bullet')).state;
    expect(on.doc.toString()).toBe('- 첫째\n- 둘째');
    const off = on.update({ selection: EditorSelection.range(0, on.doc.length) });
    expect(off.state.update(toggleLinePrefix(off.state, 'bullet')).state.doc.toString()).toBe('첫째\n둘째');
  });
  it('번호 목록은 1부터 매긴다, 기존 글머리는 바꾼다', () => {
    const s = st('{- 가\n- 나\n다}');
    expect(s.update(toggleLinePrefix(s, 'ordered')).state.doc.toString()).toBe('1. 가\n2. 나\n3. 다');
  });
  it('글머리를 체크박스로, 들여쓰기 유지', () => {
    const s = st('    - 할 일|');
    expect(apply(s, toggleLinePrefix(s, 'task'))).toBe('    - [ ] 할 일|');
  });
  it('인용', () => {
    const s = st('문장|');
    expect(apply(s, toggleLinePrefix(s, 'quote'))).toBe('> 문장|');
  });
});

describe('체크박스', () => {
  it('완료 전환', () => {
    const s = st('- [ ] 우유|');
    expect(s.update(toggleTaskDone(s)).state.doc.toString()).toBe('- [x] 우유');
    const s2 = st('- [x] 우유|');
    expect(s2.update(toggleTaskDone(s2)).state.doc.toString()).toBe('- [ ] 우유');
  });
  it('일반 줄은 체크박스로', () => {
    const s = st('우유|');
    expect(s.update(toggleTaskDone(s)).state.doc.toString()).toBe('- [ ] 우유');
  });
  it('줄 번호로 전환(읽기 모드 클릭)', () => {
    const s = st('제목\n- [ ] a\n- [X] b');
    expect(s.update(toggleTaskAt(s, 2)!).state.doc.toString()).toBe('제목\n- [x] a\n- [X] b');
    expect(s.update(toggleTaskAt(s, 3)!).state.doc.toString()).toBe('제목\n- [ ] a\n- [ ] b');
    expect(toggleTaskAt(s, 1)).toBeNull();
  });
});

describe('cycleHeading', () => {
  it('없음 → # → ## → ### → 없음', () => {
    let s = st('제목|');
    const seq: string[] = [];
    for (let i = 0; i < 4; i++) {
      s = s.update(cycleHeading(s)).state;
      seq.push(s.doc.toString());
    }
    expect(seq).toEqual(['# 제목', '## 제목', '### 제목', '제목']);
  });
});

describe('링크', () => {
  it('텍스트 선택 후 링크', () => {
    const s = st('{구글}');
    expect(apply(s, insertLink(s))).toBe('[구글](|)');
  });
  it('URL 선택 후 링크', () => {
    const s = st('{https://a.com}');
    expect(apply(s, insertLink(s))).toBe('[|](https://a.com)');
  });
  it('텍스트 선택 상태에서 URL 붙여넣기', () => {
    const s = st('여기 {문서} 참고');
    expect(apply(s, linkifyPaste(s, 'https://example.com/x')!)).toBe('여기 [문서](https://example.com/x)| 참고');
    expect(linkifyPaste(s, '그냥 글')).toBeNull();
    expect(linkifyPaste(st('a|'), 'https://x.com')).toBeNull();
  });
});

describe('빈 목록 항목에서 Enter', () => {
  it('들여쓴 빈 항목은 한 단계 내어쓰기', () => {
    const s = st('- a\n    - [ ] |');
    expect(apply(s, enterOnEmptyItem(s)!)).toBe('- a\n- [ ] |');
  });
  it('최상위 빈 항목은 목록 끝내기', () => {
    const s = st('- a\n- |');
    expect(apply(s, enterOnEmptyItem(s)!)).toBe('- a\n|');
  });
  it('내용이 있으면 기본 동작', () => {
    expect(enterOnEmptyItem(st('- a|'))).toBeNull();
    expect(enterOnEmptyItem(st('일반 줄|'))).toBeNull();
  });
});

describe('표 삽입', () => {
  it('문장 중간이면 다음 줄에 넣는다', () => {
    const s = st('문장|');
    const out = s.update(insertTable(s)).state.doc.toString();
    expect(out.startsWith('문장\n| 제목1 | 제목2 |')).toBe(true);
  });
});
