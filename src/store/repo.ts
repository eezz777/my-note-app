// 노트/폴더 CRUD. 화면은 이 모듈만 통해 데이터를 바꾼다.
// 모든 변경은 dirty=1로 표시되어, 드라이브 연동 단계에서 동기화 큐가 이를 업로드한다.
import { newId } from '../core/id';
import { INDEX_VERSION, analyzeNote } from '../core/analyze';
import { hasTag, isValidTag, renameTagInText } from '../core/tags';
import { sanitizeName, uniqueName, validateName, nameKey } from '../core/names';
import { byId, descendantFolderIds, folderPath, isFolderHidden, isSelfOrDescendant } from '../core/tree';
import { buildNameIndex, ensureBlockId, isNoteLink, linkNameFor, resolveName, rewriteLinks, type NoteRef } from '../core/links';
import type { AttachmentMeta, DeviceSettings, FolderMeta, NoteMeta, SharedSettings } from '../core/types';
import { attachmentName } from '../core/attachments';
import type { NotesDb } from './db';

/** 사용자에게 그대로 보여 줄 수 있는 오류 */
export class UserError extends Error {}

export const DEFAULT_DEVICE: DeviceSettings = {
  expanded: [],
  expandedTags: [],
  lastNoteId: null,
  sortKey: 'updated',
  sortDir: 'desc',
  viewMode: 'card',
  theme: 'system',
  fontSize: 16,
  livePreview: true,
  imageResize: 'ask',
  rightPanel: false,
  sidebarCollapsed: false,
  panelTab: 'outline',
  graphTags: false,
  graphMissing: false,
  graphDepth: 1,
};

export const DEFAULT_SHARED: SharedSettings = {
  favorites: [],
  accent: '#2e9e6b',
};

export class Repo {
  constructor(readonly db: NotesDb, private now: () => number = Date.now) {}

  // ---------- 공통 도우미 ----------

  private async folderSiblings(parentId: string | null, excludeId?: string): Promise<string[]> {
    const all = await this.db.folders.where('trashed').equals(0).toArray();
    return all.filter((f) => f.parentId === parentId && f.id !== excludeId).map((f) => f.name);
  }

  private async noteSiblings(folderId: string | null, excludeId?: string): Promise<string[]> {
    const all = await this.db.notes.where('trashed').equals(0).toArray();
    return all.filter((n) => n.folderId === folderId && n.id !== excludeId).map((n) => n.name);
  }

  private checkName(name: string): string {
    const err = validateName(name);
    if (err) throw new UserError(err);
    return name.trim();
  }

  private async assertFolderExists(folderId: string | null): Promise<void> {
    if (folderId === null) return;
    const f = await this.db.folders.get(folderId);
    if (!f) throw new UserError('대상 폴더를 찾을 수 없습니다.');
    const map = byId(await this.db.folders.toArray());
    if (isFolderHidden(folderId, map)) throw new UserError('휴지통에 있는 폴더로는 옮길 수 없습니다.');
  }

  // ---------- 폴더 ----------

  async createFolder(parentId: string | null, desired = '새 폴더'): Promise<FolderMeta> {
    return this.db.transaction('rw', this.db.folders, async () => {
      await this.assertFolderExists(parentId);
      const name = uniqueName(this.checkName(desired), await this.folderSiblings(parentId));
      const t = this.now();
      const folder: FolderMeta = {
        id: newId(),
        parentId,
        name,
        createdAt: t,
        updatedAt: t,
        trashed: 0,
        dirty: 1,
      };
      await this.db.folders.add(folder);
      return folder;
    });
  }

  // ---------- 링크 자동 갱신 ----------

  /** 마지막 이름 변경/이동에서 링크를 고친 노트 수(화면 알림용) */
  lastRelinked = 0;

  /** 휴지통에 없는 노트들의 이름 해석용 정보 */
  private async noteRefs(): Promise<NoteRef[]> {
    const folders = await this.db.folders.toArray();
    const map = byId(folders);
    const notes = await this.db.notes.where('trashed').equals(0).toArray();
    return notes
      .filter((n) => !isFolderHidden(n.folderId, map))
      .map((n) => ({ id: n.id, name: n.name, folderId: n.folderId, path: folderPath(n.folderId, map).join('/') }));
  }

  private async noteIdsUnder(folderId: string): Promise<Set<string>> {
    const ids = descendantFolderIds(folderId, await this.db.folders.toArray());
    return new Set(await this.db.notes.where('folderId').anyOf([...ids]).primaryKeys());
  }

  /**
   * 이름 변경·이동(mutate) 전후로, targets 노트를 가리키던 [[링크]]가 계속 같은 노트를 가리키도록 고친다.
   * 예전 이름으로 더 이상 해석되지 않으면 새 이름(필요하면 폴더 경로 포함)으로 바꾼다.
   */
  private async withRelink<T>(targets: Set<string>, mutate: () => Promise<T>): Promise<T> {
    this.lastRelinked = 0;
    if (!targets.size) return mutate();
    const before = await this.noteRefs();
    const beforeIdx = buildNameIndex(before);
    const beforeById = new Map(before.map((n) => [n.id, n]));
    // 대상 노트 이름(소문자)으로 링크 후보 노트 고르기
    const names = new Set([...targets].map((id) => beforeById.get(id)).filter(Boolean).map((n) => nameKey(n!.name)));
    const metas = await this.db.notes.where('trashed').equals(0).toArray();
    const candidates = metas.filter((m) =>
      (m.links ?? []).some((k) => names.has(k.split('/').pop()!.trim())),
    );

    const result = await mutate();
    if (!candidates.length) return result;

    const after = await this.noteRefs();
    const afterIdx = buildNameIndex(after);
    const afterById = new Map(after.map((n) => [n.id, n]));
    let count = 0;
    for (const c of candidates) {
      const fromBefore = beforeById.get(c.id)?.folderId ?? c.folderId;
      const fromAfter = afterById.get(c.id)?.folderId ?? c.folderId;
      const text = await this.getContent(c.id);
      const next = rewriteLinks(text, (l) => {
        if (!isNoteLink(l)) return null;
        const was = resolveName(l.name, fromBefore, beforeIdx);
        if (!was || !targets.has(was.id)) return null;
        const target = afterById.get(was.id);
        if (!target) return null;
        if (resolveName(l.name, fromAfter, afterIdx)?.id === target.id) return null; // 여전히 맞게 가리킴
        return linkNameFor(target, fromAfter, afterIdx);
      });
      if (next !== text && (await this.saveContent(c.id, next))) count++;
    }
    this.lastRelinked = count;
    return result;
  }

  async renameFolder(id: string, newName: string): Promise<void> {
    await this.withRelink(await this.noteIdsUnder(id), () => this.renameFolderOnly(id, newName));
  }

  private async renameFolderOnly(id: string, newName: string): Promise<void> {
    await this.db.transaction('rw', this.db.folders, async () => {
      const f = await this.mustFolder(id);
      const name = this.checkName(newName);
      if (name === f.name) return;
      const siblings = await this.folderSiblings(f.parentId, id);
      if (siblings.some((s) => nameKey(s) === nameKey(name))) {
        throw new UserError(`같은 위치에 "${name}" 폴더가 이미 있습니다.`);
      }
      await this.db.folders.update(id, { name, updatedAt: this.now(), dirty: 1 });
    });
  }

  /** 폴더 이동. 같은 이름이 있으면 뒤에 숫자를 붙여 옮기고 최종 이름을 돌려준다. */
  async moveFolder(id: string, targetParentId: string | null): Promise<string> {
    return this.withRelink(await this.noteIdsUnder(id), () => this.moveFolderOnly(id, targetParentId));
  }

  private async moveFolderOnly(id: string, targetParentId: string | null): Promise<string> {
    return this.db.transaction('rw', this.db.folders, async () => {
      const f = await this.mustFolder(id);
      if (f.parentId === targetParentId) return f.name;
      const map = byId(await this.db.folders.toArray());
      if (isSelfOrDescendant(id, targetParentId, map)) {
        throw new UserError('폴더를 자기 자신이나 하위 폴더로 옮길 수 없습니다.');
      }
      await this.assertFolderExists(targetParentId);
      const name = uniqueName(f.name, await this.folderSiblings(targetParentId, id));
      await this.db.folders.update(id, { parentId: targetParentId, name, updatedAt: this.now(), dirty: 1 });
      return name;
    });
  }

  /** 휴지통으로 보낸다. 하위 폴더/노트는 상위가 휴지통에 있으므로 자동으로 숨겨진다(드라이브와 같은 방식). */
  async trashFolder(id: string): Promise<void> {
    const t = this.now();
    await this.db.folders.update(id, { trashed: 1, trashedAt: t, updatedAt: t, dirty: 1 });
  }

  async restoreFolder(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.folders, async () => {
      const f = await this.mustFolder(id);
      const map = byId(await this.db.folders.toArray());
      // 원래 부모가 없어졌거나 휴지통에 있으면 루트로 복원
      let parentId = f.parentId;
      if (parentId && (!map.has(parentId) || isFolderHidden(parentId, map))) parentId = null;
      const name = uniqueName(f.name, await this.folderSiblings(parentId, id));
      await this.db.folders.update(id, {
        trashed: 0,
        trashedAt: undefined,
        parentId,
        name,
        updatedAt: this.now(),
        dirty: 1,
      });
    });
  }

  /** 영구 삭제: 폴더와 그 안의 모든 하위 폴더·노트를 지운다 */
  async deleteFolderForever(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.folders, this.db.notes, this.db.contents, this.db.kv, async () => {
      const all = await this.db.folders.toArray();
      const ids = descendantFolderIds(id, all);
      const noteRows = await this.db.notes.where('folderId').anyOf([...ids]).toArray();
      const notes = noteRows.map((n) => n.id);
      // 드라이브에서는 폴더를 지우면 안의 파일도 함께 지워지지만, 안전하게 모두 기록
      const driveIds = [
        ...all.filter((f) => ids.has(f.id) && f.driveId).map((f) => f.driveId!),
        ...noteRows.filter((n) => n.driveId).map((n) => n.driveId!),
      ];
      await this.addPendingDeletes(driveIds);
      await this.db.notes.bulkDelete(notes);
      await this.db.contents.bulkDelete(notes);
      await this.db.folders.bulkDelete([...ids]);
    });
  }

  // ---------- 노트 ----------

  async createNote(folderId: string | null, desired = '제목 없음', text = ''): Promise<NoteMeta> {
    return this.db.transaction('rw', this.db.folders, this.db.notes, this.db.contents, async () => {
      await this.assertFolderExists(folderId);
      const name = uniqueName(sanitizeName(desired), await this.noteSiblings(folderId));
      const t = this.now();
      const note: NoteMeta = {
        id: newId(),
        folderId,
        name,
        createdAt: t,
        updatedAt: t,
        trashed: 0,
        ...analyzeNote(text),
        dirty: 1,
        metaDirty: 1,
      };
      await this.db.notes.add(note);
      await this.db.contents.put({ id: note.id, text });
      return note;
    });
  }

  async getContent(id: string): Promise<string> {
    return (await this.db.contents.get(id))?.text ?? '';
  }

  /** 본문 저장(자동 저장에서 호출). 내용이 같으면 아무것도 하지 않는다. */
  async saveContent(id: string, text: string): Promise<boolean> {
    return this.db.transaction('rw', this.db.notes, this.db.contents, async () => {
      const old = await this.db.contents.get(id);
      if (old && old.text === text) return false;
      const note = await this.db.notes.get(id);
      if (!note) throw new UserError('노트를 찾을 수 없습니다. 삭제되었을 수 있습니다.');
      await this.db.contents.put({ id, text });
      await this.db.notes.update(id, {
        ...analyzeNote(text),
        updatedAt: this.now(),
        dirty: 1,
      });
      return true;
    });
  }

  /**
   * 모든 노트의 미리보기·태그 등 색인을 다시 만든다(내용·수정일·동기화 상태는 그대로).
   * 분석 방식이 바뀌었을 때(INDEX_VERSION) 시작하면서 한 번 실행한다.
   */
  async reindexAll(onProgress?: (done: number, total: number) => void): Promise<void> {
    const ids = await this.db.notes.toCollection().primaryKeys();
    const BATCH = 200;
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH);
      const contents = await this.db.contents.bulkGet(chunk);
      await this.db.transaction('rw', this.db.notes, async () => {
        for (let j = 0; j < chunk.length; j++) {
          const a = analyzeNote(contents[j]?.text ?? '');
          await this.db.notes.update(chunk[j], { preview: a.preview, thumb: a.thumb, tags: a.tags, links: a.links });
        }
      });
      onProgress?.(Math.min(i + BATCH, ids.length), ids.length);
    }
    await this.db.kv.put({ key: 'indexVersion', value: INDEX_VERSION });
  }

  async ensureIndex(): Promise<boolean> {
    const v = (await this.db.kv.get('indexVersion'))?.value;
    if (v === INDEX_VERSION) return false;
    await this.reindexAll();
    return true;
  }

  /**
   * 태그 일괄 이름 바꾸기(하위 태그 포함). 바뀐 노트 수를 돌려준다.
   * 새 이름이 이미 있으면 자연스럽게 합쳐진다.
   */
  async renameTag(oldTag: string, newTag: string): Promise<number> {
    if (!isValidTag(newTag)) throw new UserError('태그에는 글자, 숫자, _ - / 만 쓸 수 있고 숫자만으로는 만들 수 없습니다.');
    const notes = (await this.db.notes.toArray()).filter((n) => n.tags && hasTag(n.tags, oldTag));
    let changed = 0;
    for (const n of notes) {
      const text = await this.getContent(n.id);
      const next = renameTagInText(text, oldTag, newTag);
      if (next !== text && (await this.saveContent(n.id, next))) changed++;
    }
    return changed;
  }

  /** 노트 이름 변경. 이 노트를 가리키는 [[링크]]도 모두 새 이름으로 바꾼다. */
  /** 노트의 블록(line, 0부터)에 ^id를 붙인다(이미 ID가 있으면 그대로) */
  async addBlockId(id: string, line: number, blockId: string): Promise<string | null> {
    const text = await this.getContent(id);
    const r = ensureBlockId(text, line, blockId);
    if (!r) return null;
    if (r.text !== text) await this.saveContent(id, r.text);
    return r.id;
  }

  async renameNote(id: string, newName: string): Promise<void> {
    await this.withRelink(new Set([id]), () => this.renameNoteOnly(id, newName));
  }

  private async renameNoteOnly(id: string, newName: string): Promise<void> {
    await this.db.transaction('rw', this.db.notes, async () => {
      const n = await this.mustNote(id);
      const name = this.checkName(newName);
      if (name === n.name) return;
      const siblings = await this.noteSiblings(n.folderId, id);
      if (siblings.some((s) => nameKey(s) === nameKey(name))) {
        throw new UserError(`같은 폴더에 "${name}" 노트가 이미 있습니다.`);
      }
      await this.db.notes.update(id, { name, updatedAt: this.now(), metaDirty: 1 });
    });
  }

  /** 노트 이동. 경로로 가리키던 링크나, 이동 후 다른 노트로 해석될 링크를 고친다. */
  async moveNote(id: string, folderId: string | null): Promise<string> {
    return this.withRelink(new Set([id]), () => this.moveNoteOnly(id, folderId));
  }

  private async moveNoteOnly(id: string, folderId: string | null): Promise<string> {
    return this.db.transaction('rw', this.db.folders, this.db.notes, async () => {
      const n = await this.mustNote(id);
      if (n.folderId === folderId) return n.name;
      await this.assertFolderExists(folderId);
      const name = uniqueName(n.name, await this.noteSiblings(folderId, id));
      await this.db.notes.update(id, { folderId, name, updatedAt: this.now(), metaDirty: 1 });
      return name;
    });
  }

  async duplicateNote(id: string): Promise<NoteMeta> {
    const n = await this.mustNote(id);
    const text = await this.getContent(id);
    return this.createNote(n.folderId, `${n.name} 사본`, text);
  }

  async trashNote(id: string): Promise<void> {
    const t = this.now();
    await this.db.notes.update(id, { trashed: 1, trashedAt: t, metaDirty: 1 });
  }

  async restoreNote(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.folders, this.db.notes, async () => {
      const n = await this.mustNote(id);
      const map = byId(await this.db.folders.toArray());
      let folderId = n.folderId;
      if (folderId && (!map.has(folderId) || isFolderHidden(folderId, map))) folderId = null;
      const name = uniqueName(n.name, await this.noteSiblings(folderId, id));
      await this.db.notes.update(id, {
        trashed: 0,
        trashedAt: undefined,
        folderId,
        name,
        metaDirty: 1,
      });
    });
  }

  async deleteNoteForever(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.notes, this.db.contents, this.db.kv, async () => {
      const n = await this.db.notes.get(id);
      if (n?.driveId) await this.addPendingDeletes([n.driveId]);
      await this.db.notes.delete(id);
      await this.db.contents.delete(id);
    });
  }

  /** 드라이브에서도 영구 삭제해야 할 파일 ID(다음 동기화 때 처리) */
  async addPendingDeletes(driveIds: string[]): Promise<void> {
    if (!driveIds.length) return;
    const cur = ((await this.db.kv.get('drive.pendingDeletes'))?.value as string[] | undefined) ?? [];
    await this.db.kv.put({ key: 'drive.pendingDeletes', value: [...new Set([...cur, ...driveIds])] });
  }

  /** 휴지통 비우기: 휴지통 목록의 최상위 항목들을 영구 삭제 */
  async emptyTrash(): Promise<void> {
    const { folders, notes } = await this.trashItems();
    for (const f of folders) await this.deleteFolderForever(f.id);
    for (const n of notes) await this.deleteNoteForever(n.id);
  }

  /** 휴지통에 보일 최상위 항목(휴지통 폴더 안의 항목은 폴더에 포함되어 보임) */
  async trashItems(): Promise<{ folders: FolderMeta[]; notes: NoteMeta[] }> {
    const all = await this.db.folders.toArray();
    const map = byId(all);
    const folders = all.filter((f) => f.trashed && !isFolderHidden(f.parentId, map));
    const notes = (await this.db.notes.where('trashed').equals(1).toArray()).filter(
      (n) => !isFolderHidden(n.folderId, map),
    );
    return { folders, notes };
  }

  // ---------- 첨부파일 ----------

  /** 첨부파일 저장. 이름은 겹치지 않게 정해지며 최종 메타데이터를 돌려준다. */
  async addAttachment(
    blob: Blob,
    original: string,
    opts: { mime?: string; width?: number; height?: number; now?: Date } = {},
  ): Promise<AttachmentMeta> {
    return this.db.transaction('rw', this.db.attachments, this.db.blobs, async () => {
      const existing = (await this.db.attachments.where('trashed').equals(0).toArray()).map((a) => a.name);
      const mime = opts.mime || blob.type || 'application/octet-stream';
      const name = attachmentName(original, mime, existing, opts.now);
      const t = this.now();
      const meta: AttachmentMeta = {
        id: newId('a'),
        name,
        nameKey: nameKey(name),
        mime,
        size: blob.size,
        createdAt: t,
        updatedAt: t,
        trashed: 0,
        dirty: 1,
        width: opts.width,
        height: opts.height,
      };
      await this.db.attachments.add(meta);
      await this.db.blobs.put({ id: meta.id, blob });
      return meta;
    });
  }

  /** 이름으로 첨부파일 찾기(대소문자 무시, 경로가 붙어 있으면 파일 이름만 사용) */
  async findAttachment(name: string): Promise<AttachmentMeta | undefined> {
    const base = name.split('/').pop()!.trim();
    const list = await this.db.attachments.where('nameKey').equals(nameKey(base)).toArray();
    return list.find((a) => !a.trashed);
  }

  async getAttachmentBlob(id: string): Promise<Blob | undefined> {
    return (await this.db.blobs.get(id))?.blob;
  }

  // ---------- 설정 ----------

  async getDevice(): Promise<DeviceSettings> {
    const row = await this.db.kv.get('device');
    return { ...DEFAULT_DEVICE, ...((row?.value as Partial<DeviceSettings>) ?? {}) };
  }

  async setDevice(patch: Partial<DeviceSettings>): Promise<DeviceSettings> {
    const next = { ...(await this.getDevice()), ...patch };
    await this.db.kv.put({ key: 'device', value: next });
    return next;
  }

  async getShared(): Promise<SharedSettings> {
    const row = await this.db.kv.get('shared');
    return { ...DEFAULT_SHARED, ...((row?.value as Partial<SharedSettings>) ?? {}) };
  }

  async setShared(patch: Partial<SharedSettings>): Promise<SharedSettings> {
    const next = { ...(await this.getShared()), ...patch };
    await this.db.kv.put({ key: 'shared', value: next });
    // 드라이브 모드: 다음 동기화 때 .mynotes/settings.json 에 올림
    await this.db.kv.put({ key: 'drive.sharedDirty', value: true });
    return next;
  }

  // ---------- 내부 ----------

  private async mustFolder(id: string): Promise<FolderMeta> {
    const f = await this.db.folders.get(id);
    if (!f) throw new UserError('폴더를 찾을 수 없습니다.');
    return f;
  }

  private async mustNote(id: string): Promise<NoteMeta> {
    const n = await this.db.notes.get(id);
    if (!n) throw new UserError('노트를 찾을 수 없습니다.');
    return n;
  }
}
