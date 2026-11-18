// 첨부파일 규칙: 종류 판별, 임베드 크기 문법, 파일 이름 만들기
import { nameKey, sanitizeName, uniqueName } from './names';

export const ATTACHMENTS_FOLDER = '_attachments';

export type EmbedKind = 'image' | 'pdf' | 'audio' | 'video' | 'note' | 'file';

const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'];
const AUDIO = ['mp3', 'm4a', 'wav', 'ogg', 'oga', 'flac', 'aac', 'weba'];
const VIDEO = ['mp4', 'webm', 'ogv', 'mov', 'mkv'];

/** 확장자(소문자, 점 없음). 없으면 '' */
export function extOf(name: string): string {
  const base = name.split('/').pop() ?? name;
  const i = base.lastIndexOf('.');
  if (i <= 0) return '';
  const e = base.slice(i + 1);
  // "v1.2 회의" 같은 노트 이름의 점은 확장자로 보지 않는다
  return /^[a-z0-9]{1,8}$/i.test(e) ? e.toLowerCase() : '';
}

export function stemOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

export function kindOf(name: string): EmbedKind {
  const e = extOf(name);
  if (!e || e === 'md') return 'note';
  if (IMAGE.includes(e)) return 'image';
  if (e === 'pdf') return 'pdf';
  if (AUDIO.includes(e)) return 'audio';
  if (VIDEO.includes(e)) return 'video';
  return 'file';
}

/** "노트이름.md" 같은 확장자가 없거나 md면 노트 링크 */
export function isNoteTarget(name: string): boolean {
  return kindOf(name) === 'note';
}

/** 임베드 크기: "300" → 너비 300, "300x200" → 너비·높이. 숫자가 아니면 null */
export function parseEmbedSize(s: string | null | undefined): { width?: number; height?: number } | null {
  if (!s) return null;
  const m = /^\s*(\d{1,5})(?:\s*[xX×]\s*(\d{1,5}))?\s*$/.exec(s);
  if (!m) return null;
  return { width: Number(m[1]), height: m[2] ? Number(m[2]) : undefined };
}

/** "![[a.pdf#page=3]]" 의 페이지 번호 */
export function parsePdfPage(sub: string | null | undefined): number {
  const m = /page=(\d+)/i.exec(sub ?? '');
  return m ? Math.max(1, Number(m[1])) : 1;
}

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'application/pdf': 'pdf',
};

const pad = (n: number) => String(n).padStart(2, '0');
export function stamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * 업로드할 파일의 이름을 정한다.
 * - 금지 문자(# ^ [ ] | 등)는 공백으로 바꾼다(링크 문법이 깨지지 않게).
 * - 붙여넣은 이미지처럼 이름이 의미 없으면 "붙여넣은 이미지 20261117203512.png"
 * - 같은 이름이 있으면 "이름 2.png"
 */
export function attachmentName(original: string, mime: string, existing: Iterable<string>, now = new Date()): string {
  let ext = extOf(original) || MIME_EXT[mime] || '';
  const generic = !original || /^(image|blob|unknown|untitled)(\.\w+)?$/i.test(original);
  let stem = generic ? `붙여넣은 이미지 ${stamp(now)}` : stemOf(original);
  stem = sanitizeName(stem, `첨부 ${stamp(now)}`);
  ext = ext.replace(/[^a-z0-9]/gi, '').toLowerCase();
  // 확장자를 고려해 겹치지 않는 이름 찾기
  const taken = new Set<string>();
  for (const n of existing) taken.add(nameKey(n));
  const full = (s: string) => (ext ? `${s}.${ext}` : s);
  if (!taken.has(nameKey(full(stem)))) return full(stem);
  const stems = [...taken].filter((n) => !ext || n.endsWith(`.${ext}`)).map((n) => (ext ? n.slice(0, -(ext.length + 1)) : n));
  return full(uniqueName(stem, stems));
}

/** 사람이 읽기 쉬운 크기 */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
