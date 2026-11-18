// IndexedDB 스키마(Dexie). 모드(데모/드라이브 계정)마다 별도 DB를 써서 서로 섞이지 않게 한다.
import Dexie, { type Table } from 'dexie';
import type { AttachmentMeta, FolderMeta, NoteContent, NoteMeta } from '../core/types';

export interface KvRow {
  key: string;
  value: unknown;
}

export interface BlobRow {
  id: string;
  blob: Blob;
}

export class NotesDb extends Dexie {
  folders!: Table<FolderMeta, string>;
  notes!: Table<NoteMeta, string>;
  contents!: Table<NoteContent, string>;
  /** 첨부파일 메타데이터(목록·이름 검색용) */
  attachments!: Table<AttachmentMeta, string>;
  /** 첨부파일 내용. 드라이브 모드에서는 내려받은 사본(캐시) */
  blobs!: Table<BlobRow, string>;
  /** 기기별 설정과 공통 설정 사본 */
  kv!: Table<KvRow, string>;

  constructor(name: string) {
    super(name);
    // 목록용 메타데이터(notes)와 본문(contents)을 나눠 목록 로딩을 가볍게 한다.
    this.version(1).stores({
      folders: 'id, parentId, trashed, dirty',
      notes: 'id, folderId, trashed, updatedAt, createdAt, dirty',
      contents: 'id',
      kv: 'key',
    });
    this.version(2).stores({
      attachments: 'id, nameKey, trashed, dirty',
      blobs: 'id',
    });
    // 3: 드라이브 동기화(드라이브 ID 색인, 본문/메타 변경 구분)
    this.version(3)
      .stores({
        folders: 'id, parentId, trashed, dirty, driveId',
        notes: 'id, folderId, trashed, updatedAt, createdAt, dirty, metaDirty, driveId',
        attachments: 'id, nameKey, trashed, dirty, driveId',
      })
      .upgrade((tx) =>
        tx
          .table('notes')
          .toCollection()
          .modify((n: { dirty?: number; metaDirty?: number }) => {
            n.metaDirty = n.dirty ?? 0;
          }),
      );
  }
}

export function dbNameFor(mode: 'demo' | { account: string }): string {
  return mode === 'demo' ? 'mynotes-demo' : `mynotes-drive-${mode.account}`;
}
