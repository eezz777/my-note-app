// 앱 전체에서 쓰는 기본 데이터 타입.
// id는 드라이브 연동 후 드라이브 파일 ID와 같아진다(데모 모드에서는 무작위 ID).

export type Flag = 0 | 1; // IndexedDB 인덱스로 쓰기 위해 boolean 대신 0/1 사용

export interface FolderMeta {
  id: string;
  parentId: string | null; // null = 노트 루트
  name: string;
  createdAt: number;
  updatedAt: number;
  trashed: Flag;
  trashedAt?: number;
  /** 동기화용: 이름·위치·휴지통 상태가 드라이브에 아직 반영되지 않음 */
  dirty: Flag;
  /** 드라이브 폴더 ID(아직 올리지 않았으면 없음) */
  driveId?: string;
}

export interface NoteMeta {
  id: string;
  folderId: string | null; // null = 노트 루트
  name: string; // 확장자(.md) 제외한 파일 이름 = 노트 제목
  createdAt: number;
  updatedAt: number;
  trashed: Flag;
  trashedAt?: number;
  /** 목록 카드용 본문 미리보기(마크다운 기호 제거) */
  preview: string;
  /** 첫 번째 이미지 임베드 파일 이름(썸네일용) */
  thumb?: string;
  /** 태그(본문 #태그 + frontmatter), # 없이 */
  tags?: string[];
  /** 가리키는 노트 링크 이름(소문자) */
  links?: string[];
  /** 동기화용: 본문이 드라이브에 아직 반영되지 않음 */
  dirty: Flag;
  /** 동기화용: 이름·폴더·휴지통 상태가 드라이브에 아직 반영되지 않음 */
  metaDirty?: Flag;
  /** 드라이브 파일 ID(아직 올리지 않았으면 없음) */
  driveId?: string;
  /** 동기화용: 마지막으로 드라이브와 일치했던 리비전(다른 기기 변경 감지 기준) */
  baseRevision?: string;
  baseMd5?: string;
  /** 첫 동기화 중 아직 본문을 받지 못함 */
  contentMissing?: Flag;
}

/** 첨부파일(_attachments 폴더의 파일). 이름은 앱 전체에서 겹치지 않는다. */
export interface AttachmentMeta {
  id: string;
  name: string;
  /** 대소문자 무시 검색 키 */
  nameKey: string;
  mime: string;
  size: number;
  createdAt: number;
  updatedAt: number;
  trashed: Flag;
  /** 동기화용: 드라이브에 아직 올리지 않았거나 상태 변경이 남음 */
  dirty: Flag;
  driveId?: string;
  /** 드라이브의 내용 체크섬(다른 기기에서 내용이 바뀌었는지 판단) */
  md5?: string;
  width?: number;
  height?: number;
}

export interface NoteContent {
  id: string;
  text: string;
}

export type SortKey = 'name' | 'updated' | 'created';
export type SortDir = 'asc' | 'desc';
export type ViewMode = 'card' | 'list' | 'compact';

/** 기기 공통 설정(드라이브 설정 파일에 저장 예정) */
export interface SharedSettings {
  favorites: string[]; // 노트 id
  accent: string;
}

/** 기기별 설정(이 기기의 IndexedDB에만 저장) */
export interface DeviceSettings {
  expanded: string[]; // 펼친 폴더 id
  expandedTags: string[]; // 펼친 중첩 태그 키
  lastNoteId: string | null;
  sortKey: SortKey;
  sortDir: SortDir;
  viewMode: ViewMode;
  theme: 'system' | 'light' | 'dark';
  fontSize: number;
  /** true: 라이브 프리뷰, false: 소스 모드(기호 그대로) */
  livePreview: boolean;
  /** PC에서 왼쪽 사이드바 접기 */
  sidebarCollapsed: boolean;
  /** 데스크톱 오른쪽 목차·백링크 패널 열림 */
  rightPanel: boolean;
  panelTab: 'outline' | 'backlinks' | 'graph';
  /** 그래프: 태그 점 표시 / 아직 없는 노트 점 표시 / 현재 노트 주변 단계 */
  graphTags: boolean;
  graphMissing: boolean;
  graphDepth: 1 | 2;
  /** 큰 이미지를 넣을 때: 묻기 / 자동으로 줄이기 / 원본 유지 */
  imageResize: 'ask' | 'auto' | 'original';
}
