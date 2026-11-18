// 동기화 엔진이 쓰는 드라이브 기능. 실제 구현(api.ts)과 테스트용 가짜(fake.ts)가 같은 모양을 따른다.

export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const NOTE_MIME = 'text/markdown';

export interface RemoteFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  trashed?: boolean;
  md5Checksum?: string;
  /** 본문이 바뀔 때만 바뀌는 리비전 ID(이름 변경 등에는 그대로) */
  headRevisionId?: string;
  modifiedTime?: string;
  createdTime?: string;
  size?: string;
  appProperties?: Record<string, string>;
}

export interface RemoteChange {
  fileId: string;
  removed?: boolean;
  file?: RemoteFile;
}

export interface RemoteRevision {
  id: string;
  modifiedTime: string;
  size?: string;
}

export interface MetaPatch {
  name?: string;
  trashed?: boolean;
  addParents?: string;
  removeParents?: string;
}

export interface DriveLike {
  /** 앱 전용 표시(appProperties.mynotes = kind)가 붙은 폴더 찾기 */
  findByAppProp(kind: string): Promise<RemoteFile[]>;
  createFolder(name: string, parentId: string | null, appProps?: Record<string, string>): Promise<RemoteFile>;
  createFile(name: string, parentId: string, mimeType: string, data: string | Blob, appProps?: Record<string, string>): Promise<RemoteFile>;
  updateContent(id: string, data: string | Blob, mimeType: string): Promise<RemoteFile>;
  updateMeta(id: string, patch: MetaPatch): Promise<RemoteFile>;
  /** 없으면 null */
  getMeta(id: string): Promise<RemoteFile | null>;
  /** 여러 파일 메타데이터 한 번에(실제 구현은 배치 요청). 없는 파일은 null */
  getMetas(ids: string[]): Promise<(RemoteFile | null)[]>;
  download(id: string): Promise<Blob>;
  /** 영구 삭제(없으면 조용히 넘어감) */
  remove(id: string): Promise<void>;
  /** 앱이 볼 수 있는 모든 파일(휴지통 포함) */
  listAll(onPage?: (count: number) => void): Promise<RemoteFile[]>;
  getStartPageToken(): Promise<string>;
  listChanges(pageToken: string): Promise<{ changes: RemoteChange[]; nextPageToken?: string; newStartPageToken?: string }>;
  listRevisions(id: string): Promise<RemoteRevision[]>;
  downloadRevision(id: string, revId: string): Promise<Blob>;
}

/** 로그인이 필요함(토큰 만료 등) */
export class AuthError extends Error {
  constructor(msg = '구글 로그인이 필요합니다.') {
    super(msg);
    this.name = 'AuthError';
  }
}

/** 인터넷 연결 없음 */
export class OfflineError extends Error {
  constructor(msg = '인터넷에 연결되어 있지 않습니다.') {
    super(msg);
    this.name = 'OfflineError';
  }
}
