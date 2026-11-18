// 편집기 하나를 여러 노트에 재사용한다. 노트별 실행 취소 기록은 세션 동안 기억한다.
import { EditorState } from '@codemirror/state';
import { EditorView, type Command } from '@codemirror/view';
import { createExtensions, previewCompartment, previewExtension } from './setup';
import type { EditorHost } from './host';
import { refreshPreview } from './livepreview';

const MAX_CACHED = 20;

export class EditorController {
  readonly view: EditorView;
  private id: string | null = null;
  private cache = new Map<string, EditorState>();
  private live: boolean;
  /** 프로그램이 문서를 바꾸는 중에는 변경 알림을 보내지 않는다 */
  private silent = false;

  constructor(
    parent: HTMLElement,
    private opts: {
      host: EditorHost;
      livePreview: boolean;
      onChange: (id: string, text: string) => void;
      extraKeys?: { key: string; run: Command }[];
    },
  ) {
    this.live = opts.livePreview;
    this.view = new EditorView({ parent, state: this.makeState('') });
  }

  private makeState(doc: string): EditorState {
    return EditorState.create({
      doc,
      extensions: createExtensions({
        host: this.opts.host,
        livePreview: this.live,
        extraKeys: this.opts.extraKeys,
        onChange: (text) => {
          if (!this.silent && this.id) this.opts.onChange(this.id, text);
        },
      }),
    });
  }

  get currentId() {
    return this.id;
  }

  /** 노트를 연다. 같은 노트의 이전 편집 상태(실행 취소 기록)가 있으면 이어서 쓴다. */
  load(id: string, text: string) {
    if (this.id) this.remember(this.id, this.view.state);
    this.id = id;
    const cached = this.cache.get(id);
    this.silent = true;
    try {
      if (cached) {
        this.view.setState(cached);
        this.view.dispatch({ effects: previewCompartment.reconfigure(previewExtension(this.live)) });
        if (cached.doc.toString() !== text) {
          // 다른 곳(읽기 모드 체크 등)에서 바뀐 내용 반영
          this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: text } });
        }
      } else {
        this.view.setState(this.makeState(text));
      }
    } finally {
      this.silent = false;
    }
    this.view.scrollDOM.scrollTop = 0;
  }

  /** 외부에서 바뀐 본문을 편집기에 반영(현재 노트). 바뀐 부분만 교체해 커서 위치를 지킨다. */
  replaceText(text: string) {
    const cur = this.view.state.doc.toString();
    if (cur === text) return;
    let start = 0;
    const max = Math.min(cur.length, text.length);
    while (start < max && cur.charCodeAt(start) === text.charCodeAt(start)) start++;
    let endA = cur.length;
    let endB = text.length;
    while (endA > start && endB > start && cur.charCodeAt(endA - 1) === text.charCodeAt(endB - 1)) {
      endA--;
      endB--;
    }
    this.silent = true;
    try {
      this.view.dispatch({ changes: { from: start, to: endA, insert: text.slice(start, endB) }, userEvent: 'external' });
    } finally {
      this.silent = false;
    }
  }

  getText(): string {
    return this.view.state.doc.toString();
  }

  setLivePreview(on: boolean) {
    if (on === this.live) return;
    this.live = on;
    this.view.dispatch({ effects: previewCompartment.reconfigure(previewExtension(on)) });
  }

  focus(atEnd = false) {
    this.view.focus();
    if (atEnd) this.view.dispatch({ selection: { anchor: this.view.state.doc.length } });
  }

  /** IME(한글) 조합 중이면 조합을 끝낸 뒤 실행(툴바 버튼용) */
  run(command: Command) {
    const exec = () => {
      command(this.view);
      this.view.focus();
    };
    if (this.view.composing) {
      // 포커스를 잠깐 빼면 브라우저가 조합 중인 글자를 확정한다
      this.view.contentDOM.blur();
      this.view.focus();
      requestAnimationFrame(exec);
    } else exec();
  }

  /** 노트·첨부 목록이 바뀌면 링크 색, 임베드 표시를 다시 계산 */
  refresh() {
    this.view.dispatch({ effects: refreshPreview.of(null) });
  }

  forget(id: string) {
    this.cache.delete(id);
  }

  private remember(id: string, state: EditorState) {
    this.cache.delete(id);
    this.cache.set(id, state);
    while (this.cache.size > MAX_CACHED) this.cache.delete(this.cache.keys().next().value!);
  }

  destroy() {
    this.view.destroy();
  }
}
