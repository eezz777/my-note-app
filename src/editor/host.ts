// 편집기가 앱에 요청하는 기능(링크 열기, 첨부파일 등). 편집기 모듈이 화면 코드에 직접 의존하지 않게 한다.
import { Facet } from '@codemirror/state';
import type { AttachmentMeta } from '../core/types';

export interface EditorHost {
  /** [[노트]] 클릭 */
  openWikiLink(target: string, newTab?: boolean): void;
  /** 외부 URL 클릭 */
  openUrl(url: string): void;
  /** 노트 이름이 존재하는지(없는 링크는 다른 색) */
  noteExists(name: string): boolean;
  /** 첨부파일 찾기(동기, 메타데이터만) */
  findAttachment(name: string): AttachmentMeta | null;
  /** 첨부파일 표시용 URL(blob URL) */
  getAttachmentUrl(name: string): Promise<string | null>;
  /** 첨부파일 내용(PDF 뷰어용) */
  getAttachmentData(name: string): Promise<ArrayBuffer | null>;
  /** 첨부파일 열기/내려받기 */
  openAttachment(name: string): void;
  /** 붙여넣기/끌어놓기한 파일을 첨부로 저장하고 위치(pos)에 넣는다 */
  attachFiles(files: File[], pos?: number): void;
  /** #태그 클릭: 태그로 노트 걸러 보기 */
  openTag(tag: string): void;
  /** 자동완성용 기존 태그 목록(많이 쓴 순) */
  listTags(): { name: string; count: number }[];
  /** [[ 자동완성용: 노트(지금 노트 기준 가장 짧은 링크 이름 포함)와 첨부파일 */
  listLinkTargets(): { label: string; insert: string; detail: string; kind: 'note' | 'file'; updated: number }[];
  /** 링크 대상 노트 본문(제목·문단 자동완성, 임베드, 미리보기용). name이 ''이면 지금 노트 */
  getNoteText(name: string): Promise<{ id: string; name: string; text: string } | null>;
  /** 다른 노트의 블록(line, 0부터)에 ^id를 붙인다 */
  addBlockId(noteId: string, line: number, id: string): Promise<void>;
  /** 지금 편집 중인 노트 id */
  currentNoteId(): string | null;
  /** 링크 미리보기(마우스 올림/길게 누름) */
  previewLink(raw: string, anchor: HTMLElement): void;
  /** 노트 임베드 갱신 판단용 버전("id:수정시각", 없으면 '') */
  noteVersion(name: string): string;
}

/** 길게 눌러 미리보기를 띄운 직후에는 링크 클릭(이동)을 막는다 */
export const linkGuard = { until: 0 };

export const editorHost = Facet.define<EditorHost, EditorHost | null>({
  combine: (v) => v[0] ?? null,
});
