// 폴더 트리 계산. 순수 함수만 두어 테스트하기 쉽게 한다.
import type { FolderMeta, NoteMeta } from './types';
import { nameKey } from './names';

export interface FolderNode {
  folder: FolderMeta;
  children: FolderNode[];
  depth: number;
}

/** 휴지통에 없는 폴더들로 트리를 만든다(이름순) */
export function buildFolderTree(folders: FolderMeta[]): FolderNode[] {
  const map = byId(folders);
  const live = folders.filter((f) => !isFolderHidden(f.id, map));
  const childrenOf = new Map<string | null, FolderMeta[]>();
  for (const f of live) {
    const list = childrenOf.get(f.parentId) ?? [];
    list.push(f);
    childrenOf.set(f.parentId, list);
  }
  const make = (parentId: string | null, depth: number): FolderNode[] =>
    (childrenOf.get(parentId) ?? [])
      .sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }))
      .map((folder) => ({ folder, depth, children: make(folder.id, depth + 1) }));
  return make(null, 0);
}

export function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((i) => [i.id, i]));
}

/** 폴더 자신 또는 조상 폴더 중 하나라도 휴지통에 있으면 숨김 */
export function isFolderHidden(folderId: string | null, folders: Map<string, FolderMeta>): boolean {
  let cur = folderId;
  const seen = new Set<string>();
  while (cur) {
    if (seen.has(cur)) return true; // 순환 구조(비정상 데이터) 방어
    seen.add(cur);
    const f = folders.get(cur);
    if (!f) return false;
    if (f.trashed) return true;
    cur = f.parentId;
  }
  return false;
}

/** 노트가 목록에 보여야 하는지(본인 또는 상위 폴더가 휴지통이면 숨김) */
export function isNoteVisible(note: NoteMeta, folders: Map<string, FolderMeta>): boolean {
  return !note.trashed && !isFolderHidden(note.folderId, folders);
}

/** target이 folderId 자신이거나 그 하위 폴더인지 (폴더를 자기 하위로 옮기는 것 방지) */
export function isSelfOrDescendant(
  folderId: string,
  target: string | null,
  folders: Map<string, FolderMeta>,
): boolean {
  let cur = target;
  const seen = new Set<string>();
  while (cur) {
    if (cur === folderId) return true;
    if (seen.has(cur)) return true;
    seen.add(cur);
    cur = folders.get(cur)?.parentId ?? null;
  }
  return false;
}

/** 폴더의 전체 경로 이름 배열 (루트 → 자신) */
export function folderPath(folderId: string | null, folders: Map<string, FolderMeta>): string[] {
  const parts: string[] = [];
  let cur = folderId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const f = folders.get(cur);
    if (!f) break;
    parts.unshift(f.name);
    cur = f.parentId;
  }
  return parts;
}

/** 폴더와 모든 하위 폴더의 id 집합 */
export function descendantFolderIds(folderId: string, folders: FolderMeta[]): Set<string> {
  const result = new Set<string>([folderId]);
  let added = true;
  while (added) {
    added = false;
    for (const f of folders) {
      if (f.parentId && result.has(f.parentId) && !result.has(f.id)) {
        result.add(f.id);
        added = true;
      }
    }
  }
  return result;
}

/** 같은 부모 아래 이름 목록 (폴더와 노트는 별도 네임스페이스: 노트는 .md가 붙으므로) */
export function siblingNames<T extends { id: string; name: string; trashed: number }>(
  items: T[],
  parentOf: (item: T) => string | null,
  parentId: string | null,
  excludeId?: string,
): string[] {
  return items
    .filter((i) => !i.trashed && parentOf(i) === parentId && i.id !== excludeId)
    .map((i) => i.name);
}

export function sameName(a: string, b: string): boolean {
  return nameKey(a) === nameKey(b);
}
