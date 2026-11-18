// 노트/폴더 공통 메뉴와 작업(이름 변경, 이동 등). 사이드바·목록·편집기에서 같이 쓴다.
import { validateName } from '../core/names';
import { isValidTag, tagKey } from '../core/tags';
import type { FolderMeta, NoteMeta } from '../core/types';
import { dialogs, type MenuItem } from './dialogs.svelte';
import type { AppStore } from './state.svelte';

/** 메뉴 위치: 데스크톱은 마우스 위치, 모바일은 하단 시트 */
export function menuPos(app: AppStore, e?: MouseEvent): { x: number; y: number } | undefined {
  if (!e || app.layout === 'mobile') return undefined;
  return { x: e.clientX, y: e.clientY };
}

export async function renameFolderFlow(app: AppStore, f: FolderMeta) {
  const name = await dialogs.prompt('폴더 이름 변경', f.name, { okLabel: '변경', validate: validateName });
  if (name !== null) await app.run(() => app.repo.renameFolder(f.id, name));
}

export async function newFolderFlow(app: AppStore, parentId: string | null) {
  const name = await dialogs.prompt(parentId ? '새 하위 폴더' : '새 폴더', '', {
    placeholder: '폴더 이름',
    okLabel: '만들기',
    validate: validateName,
  });
  if (name === null) return;
  const f = await app.run(() => app.repo.createFolder(parentId, name));
  if (f && parentId) app.toggleExpanded(parentId, true);
}

export async function moveFolderFlow(app: AppStore, f: FolderMeta) {
  const res = await dialogs.pickFolder(`"${f.name}" 폴더 이동`, { exclude: f.id, current: f.parentId });
  if (res) await app.moveFolder(f.id, res.id);
}

export async function moveNoteFlow(app: AppStore, n: NoteMeta) {
  const res = await dialogs.pickFolder(`"${n.name}" 노트 이동`, { current: n.folderId });
  if (res) await app.moveNote(n.id, res.id);
}

export async function renameNoteFlow(app: AppStore, n: NoteMeta) {
  const name = await dialogs.prompt('노트 이름 변경', n.name, { okLabel: '변경', validate: validateName });
  if (name !== null) await app.run(() => app.repo.renameNote(n.id, name));
}

export function folderMenu(app: AppStore, f: FolderMeta): MenuItem[] {
  return [
    { label: '새 노트', icon: 'note', run: () => void app.newNote(f.id) },
    { label: '새 하위 폴더', icon: 'folderPlus', run: () => void newFolderFlow(app, f.id) },
    { label: '이름 변경', icon: 'edit', run: () => void renameFolderFlow(app, f) },
    { label: '이동', icon: 'move', run: () => void moveFolderFlow(app, f) },
    { label: '휴지통으로', icon: 'trash', danger: true, run: () => void app.trashFolder(f.id) },
  ];
}

export function noteMenu(app: AppStore, n: NoteMeta): MenuItem[] {
  const fav = app.favSet.has(n.id);
  return [
    { label: fav ? '즐겨찾기 해제' : '즐겨찾기', icon: 'star', run: () => void app.toggleFavorite(n.id) },
    { label: '이름 변경', icon: 'edit', run: () => void renameNoteFlow(app, n) },
    {
      label: '복제',
      icon: 'copy',
      run: async () => {
        const c = await app.run(() => app.repo.duplicateNote(n.id));
        if (c) app.toast(`"${c.name}"(으)로 복제했습니다.`);
      },
    },
    { label: '이동', icon: 'move', run: () => void moveNoteFlow(app, n) },
    ...(app.sync && n.driveId ? [{ label: '이전 버전', icon: 'restore' as const, run: () => (app.versionsFor = n.id) }] : []),
    { label: '휴지통으로', icon: 'trash', danger: true, run: () => void app.trashNote(n.id) },
  ];
}

// ---------- 태그 ----------

export async function renameTagFlow(app: AppStore, tag: string) {
  const count = app.tagIndex.byKey.get(tagKey(tag))?.count ?? 0;
  const next = await dialogs.prompt(`#${tag} 태그 이름 변경`, tag, {
    okLabel: `노트 ${count}개에서 변경`,
    placeholder: '새 태그 이름 (예: 업무/회의)',
    validate: (v) => {
      const t = v.trim().replace(/^#/, '');
      return isValidTag(t) ? null : '글자, 숫자, _ - / 만 쓸 수 있고 숫자만으로는 만들 수 없습니다.';
    },
  });
  if (next === null) return;
  const newTag = next.trim().replace(/^#/, '');
  if (newTag === tag) return;
  const n = await app.run(() => app.repo.renameTag(tag, newTag));
  if (n !== undefined) {
    app.toast(`노트 ${n}개에서 #${tag} → #${newTag}(으)로 바꿨습니다.`);
    if (app.view.kind === 'tags') {
      const tags = app.view.tags.map((t) => (tagKey(t) === tagKey(tag) ? newTag : t));
      app.setTagFilter(tags, app.view.mode);
    }
  }
}

export function tagMenu(app: AppStore, tag: string): MenuItem[] {
  const v = app.view;
  const inFilter = v.kind === 'tags';
  const items: MenuItem[] = [
    { label: '이 태그 노트 보기', icon: 'tag', run: () => app.openTag(tag) },
  ];
  if (inFilter && !v.tags.some((t) => tagKey(t) === tagKey(tag))) {
    items.push({ label: '현재 필터에 추가', icon: 'plus', run: () => app.setTagFilter([...v.tags, tag], v.mode) });
  }
  items.push({ label: '이름 변경(모든 노트)', icon: 'edit', run: () => void renameTagFlow(app, tag) });
  return items;
}

// ---------- 드래그앤드롭(데스크톱) ----------

const DND_TYPE = 'application/x-mynote-item';

type DragItem = { type: 'note' | 'folder'; id: string } | { type: 'notes'; ids: string[] };

export function setDragItem(e: DragEvent, item: DragItem) {
  if (!e.dataTransfer) return;
  e.dataTransfer.setData(DND_TYPE, JSON.stringify(item));
  e.dataTransfer.effectAllowed = 'move';
}

export function hasDragItem(e: DragEvent): boolean {
  return !!e.dataTransfer?.types.includes(DND_TYPE);
}

export function getDragItem(e: DragEvent): DragItem | null {
  try {
    const raw = e.dataTransfer?.getData(DND_TYPE);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** 폴더(또는 루트=null) 위에 놓았을 때 처리 */
export async function dropOnFolder(app: AppStore, e: DragEvent, folderId: string | null) {
  const item = getDragItem(e);
  if (!item) return;
  if (item.type === 'notes') await app.moveSelected(folderId);
  else if (item.type === 'note') await app.moveNote(item.id, folderId);
  else if (item.id !== folderId) await app.moveFolder(item.id, folderId);
}
