// 노트 정렬. 즐겨찾기(핀)는 항상 위에 둔다.
import type { NoteMeta, SortDir, SortKey } from './types';

export function sortNotes(
  notes: NoteMeta[],
  key: SortKey,
  dir: SortDir,
  pinned: Set<string> = new Set(),
): NoteMeta[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...notes].sort((a, b) => {
    const pa = pinned.has(a.id) ? 0 : 1;
    const pb = pinned.has(b.id) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    let c = 0;
    if (key === 'name') c = a.name.localeCompare(b.name, 'ko', { numeric: true });
    else if (key === 'updated') c = a.updatedAt - b.updatedAt;
    else c = a.createdAt - b.createdAt;
    if (c === 0) c = a.name.localeCompare(b.name, 'ko', { numeric: true });
    return c * sign;
  });
}
