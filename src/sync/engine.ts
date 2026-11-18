// 구글드라이브 동기화 엔진.
// 원칙: 어떤 경우에도 내용을 버리지 않는다.
//  - 받기(pull): changes.list로 바뀐 것만 받는다. 로컬에서 고치는 중인 노트는 덮어쓰지 않는다.
//  - 올리기(push): 올리기 전에 드라이브의 리비전을 확인해, 다른 기기가 먼저 바꿨으면 덮어쓰지 않고
//    내 버전을 "노트이름 (충돌 날짜)" 노트로 따로 저장한다.
//  - 올리는 사이 다른 기기가 끼어들었는지 리비전 기록으로 한 번 더 확인한다.
import { analyzeNote } from '../core/analyze';
import { nameKey, sanitizeName, uniqueName } from '../core/names';
import { byId } from '../core/tree';
import type { AttachmentMeta, FolderMeta, NoteMeta, SharedSettings } from '../core/types';
import type { Repo } from '../store/repo';
import { AuthError, FOLDER_MIME, NOTE_MIME, OfflineError, type DriveLike, type MetaPatch, type RemoteFile } from '../drive/types';

export const KV = {
  root: 'drive.rootId',
  att: 'drive.attId',
  app: 'drive.appId',
  token: 'drive.pageToken',
  pendingToken: 'drive.pendingToken',
  initialDone: 'drive.initialDone',
  pendingDeletes: 'drive.pendingDeletes',
  settingsId: 'drive.settingsId',
  sharedDirty: 'drive.sharedDirty',
  lastSync: 'drive.lastSync',
} as const;

export interface SyncProgress {
  phase: 'prepare' | 'list' | 'download' | 'upload';
  done: number;
  total: number;
}

export interface ConflictInfo {
  noteId: string;
  copyId: string;
  name: string;
  copyName: string;
  /** mine: 내 버전이 사본으로 / theirs: 동시에 끼어든 다른 기기 버전이 사본으로 */
  kind: 'mine' | 'theirs';
}

export interface SyncHooks {
  onProgress?(p: SyncProgress | null): void;
  onConflict?(c: ConflictInfo): void;
  /** 받기 전에 편집기의 저장 대기 내용을 먼저 저장 */
  beforePull?(): Promise<void>;
  /** 다른 기기의 공통 설정(즐겨찾기 등)을 받았을 때 */
  onSharedChanged?(s: SharedSettings): void;
  now?(): Date;
}

export interface SyncResult {
  downloaded: number;
  uploaded: number;
  conflicts: number;
  failed: number;
}

const CONCURRENCY = 4;
const isNoteFile = (f: RemoteFile) => f.mimeType !== FOLDER_MIME && /\.md$/i.test(f.name);
const noteName = (fileName: string) => fileName.replace(/\.md$/i, '');
const isFatal = (e: unknown) => e instanceof AuthError || e instanceof OfflineError;
const statusOf = (e: unknown) => (e as { status?: number })?.status;

function conflictLabel(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}시 ${p(d.getMinutes())}분`;
}

/** 동시에 여러 개 처리(최대 n개) */
async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  let firstError: unknown = null;
  const worker = async () => {
    while (i < items.length && !firstError) {
      const item = items[i++];
      try {
        await fn(item);
      } catch (e) {
        if (isFatal(e)) firstError = e;
        else throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  if (firstError) throw firstError;
}

export class SyncEngine {
  private running: Promise<SyncResult> | null = null;
  private again = false;
  private result: SyncResult = { downloaded: 0, uploaded: 0, conflicts: 0, failed: 0 };

  constructor(
    private repo: Repo,
    private drive: DriveLike,
    private hooks: SyncHooks = {},
  ) {}

  private get db() {
    return this.repo.db;
  }

  private async kv<T>(key: string): Promise<T | undefined> {
    return (await this.db.kv.get(key))?.value as T | undefined;
  }

  private async setKv(key: string, value: unknown) {
    await this.db.kv.put({ key, value });
  }

  private now() {
    return this.hooks.now?.() ?? new Date();
  }

  /** 동기화 한 번(이미 도는 중이면 끝난 뒤 한 번 더) */
  sync(): Promise<SyncResult> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        let r: SyncResult;
        do {
          this.again = false;
          r = await this.syncOnce();
        } while (this.again);
        return r;
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  get busy() {
    return this.running !== null;
  }

  private async syncOnce(): Promise<SyncResult> {
    this.result = { downloaded: 0, uploaded: 0, conflicts: 0, failed: 0 };
    try {
      await this.ensureRoot();
      if (!(await this.kv<boolean>(KV.initialDone))) await this.initialSync();
      else await this.pull();
      await this.push();
      // 내가 올린 변경이 변경 목록에 다시 나오는 것을 소화하고, 그 사이 다른 기기 변경도 받는다
      await this.pull();
      await this.setKv(KV.lastSync, Date.now());
      return this.result;
    } finally {
      this.hooks.onProgress?.(null);
    }
  }

  // ---------- 준비: MyNotes 루트, _attachments, .mynotes 폴더 ----------

  private async ensureRoot() {
    if ((await this.kv(KV.root)) && (await this.kv(KV.att)) && (await this.kv(KV.app))) return;
    this.hooks.onProgress?.({ phase: 'prepare', done: 0, total: 1 });
    const oldest = (fs: RemoteFile[]) =>
      [...fs].sort((a, b) => (a.createdTime ?? '').localeCompare(b.createdTime ?? '') || a.id.localeCompare(b.id))[0];
    const root = oldest(await this.drive.findByAppProp('root')) ?? (await this.drive.createFolder('MyNotes', null, { mynotes: 'root' }));
    const special = async (kind: string, name: string) =>
      oldest((await this.drive.findByAppProp(kind)).filter((f) => f.parents?.includes(root.id))) ??
      (await this.drive.createFolder(name, root.id, { mynotes: kind }));
    const att = await special('attachments', '_attachments');
    const app = await special('app', '.mynotes');
    await this.setKv(KV.root, root.id);
    await this.setKv(KV.att, att.id);
    await this.setKv(KV.app, app.id);
  }

  // ---------- 첫 동기화(전체 목록 + 본문 내려받기, 중간에 끊겨도 이어서) ----------

  private async initialSync() {
    let token = await this.kv<string>(KV.pendingToken);
    if (!token) {
      // 목록을 받기 전의 시점을 기억해, 목록을 받는 동안 생긴 변경도 다음 받기에서 잡는다
      token = await this.drive.getStartPageToken();
      await this.setKv(KV.pendingToken, token);
    }
    this.hooks.onProgress?.({ phase: 'list', done: 0, total: 0 });
    const all = await this.drive.listAll((n) => this.hooks.onProgress?.({ phase: 'list', done: n, total: 0 }));
    await this.applyRemote(all, new Set(), true);
    await this.downloadMissing();
    await this.setKv(KV.token, token);
    await this.setKv(KV.initialDone, true);
    await this.db.kv.delete(KV.pendingToken);
  }

  // ---------- 받기 ----------

  async pull() {
    await this.hooks.beforePull?.();
    let token = await this.kv<string>(KV.token);
    if (!token) return;
    const latest = new Map<string, { removed: boolean; file?: RemoteFile }>();
    for (;;) {
      const page = await this.drive.listChanges(token);
      for (const c of page.changes) latest.set(c.fileId, { removed: !!c.removed || !c.file, file: c.file });
      if (page.nextPageToken) token = page.nextPageToken;
      else {
        token = page.newStartPageToken ?? token;
        break;
      }
    }
    if (latest.size) {
      const files: RemoteFile[] = [];
      const removed = new Set<string>();
      for (const [id, c] of latest) {
        if (c.removed || !c.file) removed.add(id);
        else files.push(c.file);
      }
      await this.applyRemote(files, removed, false);
      await this.downloadMissing();
    }
    await this.setKv(KV.token, token);
  }

  /**
   * 드라이브 파일 목록을 로컬에 반영(메타데이터만, 본문은 contentMissing 표시 후 downloadMissing에서).
   * full=true(첫 동기화)면 files가 전체 목록이므로, 목록에 없는 로컬 항목은 지워진 것으로 본다.
   */
  private async applyRemote(files: RemoteFile[], removed: Set<string>, full: boolean) {
    const rootId = (await this.kv<string>(KV.root))!;
    const attId = (await this.kv<string>(KV.att))!;
    const appId = (await this.kv<string>(KV.app))!;
    const special = new Set([rootId, attId, appId]);

    const localFolders = await this.db.folders.toArray();
    const folderByDrive = new Map(localFolders.filter((f) => f.driveId).map((f) => [f.driveId!, f]));

    // 1) 폴더: 부모가 트리 안(루트 또는 이미 아는 폴더)이면 반영, 반복해서 중첩 폴더까지
    const incoming = files.filter((f) => f.mimeType === FOLDER_MIME && !special.has(f.id));
    const known = new Set<string>([rootId]);
    for (const f of localFolders) if (f.driveId && !incoming.some((x) => x.id === f.driveId)) known.add(f.driveId);
    const pending = [...incoming];
    let progress = true;
    while (progress) {
      progress = false;
      for (let i = pending.length - 1; i >= 0; i--) {
        const f = pending[i];
        const parent = f.parents?.[0];
        if (parent && known.has(parent)) {
          known.add(f.id);
          pending.splice(i, 1);
          progress = true;
          await this.applyFolder(f, parent === rootId ? null : (folderByDrive.get(parent)?.id ?? null), folderByDrive);
        }
      }
    }
    // 트리 밖으로 나간 폴더는 지워진 것으로
    for (const f of pending) removed.add(f.id);

    // 2) 노트·첨부·설정
    const treeFolderDrive = (pid: string | undefined) => (pid === rootId ? null : pid ? folderByDrive.get(pid) : undefined);
    for (const f of files) {
      if (f.mimeType === FOLDER_MIME) continue;
      const parent = f.parents?.[0];
      if (parent === attId) await this.applyAttachment(f);
      else if (parent === appId) {
        if (f.name === 'settings.json') await this.applySettings(f);
      } else if (isNoteFile(f)) {
        const folder = treeFolderDrive(parent);
        if (folder === undefined) removed.add(f.id); // 트리 밖
        else await this.applyNote(f, folder ? folder.id : null);
      }
    }

    // 3) 지워진 것
    if (full) {
      const present = new Set(files.map((f) => f.id));
      for (const f of await this.db.folders.toArray()) if (f.driveId && !present.has(f.driveId)) removed.add(f.driveId);
      for (const n of await this.db.notes.toArray()) if (n.driveId && !present.has(n.driveId)) removed.add(n.driveId);
      for (const a of await this.db.attachments.toArray()) if (a.driveId && !present.has(a.driveId)) removed.add(a.driveId);
    }
    for (const id of removed) await this.applyRemoved(id);
  }

  private async applyFolder(f: RemoteFile, parentId: string | null, folderByDrive: Map<string, FolderMeta>) {
    await this.db.transaction('rw', this.db.folders, async () => {
      const local = (await this.db.folders.where('driveId').equals(f.id).first()) ?? null;
      const trashed = f.trashed ? 1 : 0;
      if (!local) {
        // 같은 위치 같은 이름이 이미 있으면(다른 기기가 오프라인에서 같은 이름을 만든 경우) 이름 뒤에 숫자
        const names = (await this.db.folders.toArray()).filter((x) => x.parentId === parentId && !x.trashed).map((x) => x.name);
        const name = trashed ? f.name : uniqueName(f.name, names);
        const t = Date.parse(f.modifiedTime ?? '') || Date.now();
        const row: FolderMeta = {
          id: f.id,
          driveId: f.id,
          parentId,
          name,
          createdAt: Date.parse(f.createdTime ?? '') || t,
          updatedAt: t,
          trashed: trashed as 0 | 1,
          trashedAt: trashed ? t : undefined,
          dirty: name !== f.name ? 1 : 0,
        };
        await this.db.folders.put(row);
        folderByDrive.set(f.id, row);
      } else {
        folderByDrive.set(f.id, local);
        if (local.dirty) return; // 로컬에서 바꾼 이름·위치가 우선(올리기에서 드라이브에 반영)
        if (local.name !== f.name || local.parentId !== parentId || local.trashed !== trashed) {
          await this.db.folders.update(local.id, {
            name: f.name,
            parentId,
            trashed: trashed as 0 | 1,
            trashedAt: trashed ? (local.trashedAt ?? Date.now()) : undefined,
          });
        }
      }
    });
  }

  private async applyNote(f: RemoteFile, folderId: string | null) {
    await this.db.transaction('rw', this.db.notes, this.db.contents, async () => {
      const local = await this.db.notes.where('driveId').equals(f.id).first();
      const trashed = (f.trashed ? 1 : 0) as 0 | 1;
      const name = sanitizeName(noteName(f.name));
      const t = Date.parse(f.modifiedTime ?? '') || Date.now();
      if (!local) {
        const siblings = (await this.db.notes.toArray()).filter((n) => n.folderId === folderId && !n.trashed).map((n) => n.name);
        const finalName = trashed ? name : uniqueName(name, siblings);
        const row: NoteMeta = {
          id: f.id,
          driveId: f.id,
          folderId,
          name: finalName,
          createdAt: Date.parse(f.createdTime ?? '') || t,
          updatedAt: t,
          trashed,
          trashedAt: trashed ? t : undefined,
          preview: '',
          dirty: 0,
          metaDirty: finalName !== noteName(f.name) ? 1 : 0,
          contentMissing: 1,
          tags: [],
          links: [],
        };
        await this.db.notes.put(row);
        return;
      }
      const patch: Partial<NoteMeta> = {};
      if (trashed && !local.trashed && local.dirty) {
        // 다른 기기가 휴지통에 넣었지만 이 기기에서 고친 내용이 있음 → 버리지 않고 휴지통에서 꺼내 올린다
        patch.metaDirty = 1;
      } else if (!local.metaDirty) {
        if (local.name !== name) patch.name = name;
        if (local.folderId !== folderId) patch.folderId = folderId;
        if (local.trashed !== trashed) {
          patch.trashed = trashed;
          patch.trashedAt = trashed ? Date.now() : undefined;
        }
      }
      // 본문이 바뀌었고 로컬에서 고치는 중이 아니면 새로 받기(고치는 중이면 올리기에서 충돌 처리)
      if (f.headRevisionId && f.headRevisionId !== local.baseRevision && !local.dirty) patch.contentMissing = 1;
      if (Object.keys(patch).length) await this.db.notes.update(local.id, patch);
    });
  }

  private async applyAttachment(f: RemoteFile) {
    await this.db.transaction('rw', this.db.attachments, this.db.blobs, async () => {
      const local = await this.db.attachments.where('driveId').equals(f.id).first();
      const trashed = (f.trashed ? 1 : 0) as 0 | 1;
      if (!local) {
        // 이름이 겹치면(다른 기기에서 같은 이름) 그대로 두되 driveId로 구분된다
        const row: AttachmentMeta = {
          id: f.id,
          driveId: f.id,
          name: f.name,
          nameKey: nameKey(f.name),
          mime: f.mimeType,
          size: Number(f.size ?? 0),
          createdAt: Date.parse(f.createdTime ?? '') || Date.now(),
          updatedAt: Date.parse(f.modifiedTime ?? '') || Date.now(),
          trashed,
          dirty: 0,
          md5: f.md5Checksum,
        };
        await this.db.attachments.put(row);
        return;
      }
      if (local.dirty) return;
      const patch: Partial<AttachmentMeta> = {};
      if (local.name !== f.name) Object.assign(patch, { name: f.name, nameKey: nameKey(f.name) });
      if (local.trashed !== trashed) patch.trashed = trashed;
      if (f.md5Checksum && local.md5 && f.md5Checksum !== local.md5) {
        // 내용이 바뀐 첨부: 캐시를 지워 다음에 새로 받게
        await this.db.blobs.delete(local.id);
        Object.assign(patch, { md5: f.md5Checksum, size: Number(f.size ?? 0), updatedAt: Date.now() });
      }
      if (Object.keys(patch).length) await this.db.attachments.update(local.id, patch);
    });
  }

  private async applySettings(f: RemoteFile) {
    await this.setKv(KV.settingsId, f.id);
    if (await this.kv<boolean>(KV.sharedDirty)) return; // 내 변경이 올라가기 전이면 내 것이 우선
    if (f.headRevisionId && f.headRevisionId === (await this.kv<string>('drive.settingsRev'))) return;
    try {
      const remote = JSON.parse(await (await this.drive.download(f.id)).text()) as Partial<SharedSettings>;
      const cur = (await this.repo.getShared()) as SharedSettings;
      const next = { ...cur, ...remote };
      await this.db.kv.put({ key: 'shared', value: next });
      await this.setKv('drive.settingsRev', f.headRevisionId);
      this.hooks.onSharedChanged?.(next);
    } catch (e) {
      if (isFatal(e)) throw e;
    }
  }

  private async applyRemoved(driveId: string) {
    await this.db.transaction('rw', [this.db.notes, this.db.contents, this.db.folders, this.db.attachments, this.db.blobs], async () => {
      const note = await this.db.notes.where('driveId').equals(driveId).first();
      if (note) {
        if (note.dirty && !note.trashed) {
          // 드라이브에선 지워졌지만 이 기기에서 고친 내용이 있음 → 새 파일로 다시 올리도록
          await this.db.notes.update(note.id, { driveId: undefined, baseRevision: undefined, metaDirty: 1 });
        } else {
          await this.db.notes.delete(note.id);
          await this.db.contents.delete(note.id);
        }
        return;
      }
      const folder = await this.db.folders.where('driveId').equals(driveId).first();
      if (folder) {
        // 폴더 안에 이 기기에서만 고친 노트가 있으면 루트로 옮겨 살린다
        const all = await this.db.folders.toArray();
        const inside = new Set<string>([folder.id]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const x of all) if (x.parentId && inside.has(x.parentId) && !inside.has(x.id)) (inside.add(x.id), (grew = true));
        }
        const notes = await this.db.notes.where('folderId').anyOf([...inside]).toArray();
        for (const n of notes) {
          if (n.dirty && !n.trashed) await this.db.notes.update(n.id, { folderId: null, driveId: undefined, baseRevision: undefined, metaDirty: 1 });
          else {
            await this.db.notes.delete(n.id);
            await this.db.contents.delete(n.id);
          }
        }
        await this.db.folders.bulkDelete([...inside]);
        return;
      }
      const att = await this.db.attachments.where('driveId').equals(driveId).first();
      if (att && !att.dirty) {
        await this.db.attachments.delete(att.id);
        await this.db.blobs.delete(att.id);
      }
    });
  }

  /** 본문을 아직 못 받은 노트 내려받기(동시에 4개) */
  private async downloadMissing() {
    const missing = await this.db.notes.filter((n) => n.contentMissing === 1 && !!n.driveId).toArray();
    if (!missing.length) return;
    let done = 0;
    this.hooks.onProgress?.({ phase: 'download', done, total: missing.length });
    await pool(missing, CONCURRENCY, async (n) => {
      try {
        const meta = await this.drive.getMeta(n.driveId!);
        if (!meta) return void (await this.applyRemoved(n.driveId!));
        const text = await (await this.drive.download(n.driveId!)).text();
        await this.db.transaction('rw', this.db.notes, this.db.contents, async () => {
          const cur = await this.db.notes.get(n.id);
          if (!cur) return;
          if (cur.dirty) {
            // 내려받는 사이 이 기기에서 고침 → 덮어쓰지 않음(올리기에서 충돌로 처리)
            await this.db.notes.update(n.id, { contentMissing: 0 });
            return;
          }
          await this.db.contents.put({ id: n.id, text });
          await this.db.notes.update(n.id, {
            ...analyzeNote(text),
            baseRevision: meta.headRevisionId,
            contentMissing: 0,
            updatedAt: Date.parse(meta.modifiedTime ?? '') || Date.now(),
          });
        });
        this.result.downloaded++;
      } catch (e) {
        if (isFatal(e)) throw e;
        this.result.failed++;
        console.warn('노트 내려받기 실패', n.name, e);
      } finally {
        this.hooks.onProgress?.({ phase: 'download', done: ++done, total: missing.length });
      }
    });
  }

  // ---------- 올리기 ----------

  async push() {
    const rootId = (await this.kv<string>(KV.root))!;
    const attId = (await this.kv<string>(KV.att))!;

    // 0) 영구 삭제
    const dels = (await this.kv<string[]>(KV.pendingDeletes)) ?? [];
    for (const id of dels) {
      try {
        await this.drive.remove(id);
      } catch (e) {
        if (isFatal(e)) throw e;
        if (statusOf(e) !== 404) {
          this.result.failed++;
          continue;
        }
      }
      const cur = ((await this.kv<string[]>(KV.pendingDeletes)) ?? []).filter((x) => x !== id);
      await this.setKv(KV.pendingDeletes, cur);
    }

    // 1) 폴더(부모부터)
    const folders = await this.db.folders.toArray();
    const fmap = byId(folders);
    const depth = (f: FolderMeta) => {
      let d = 0;
      for (let p = f.parentId; p && d < 100; p = fmap.get(p)?.parentId ?? null) d++;
      return d;
    };
    const fPush = folders.filter((f) => f.dirty || !f.driveId).sort((a, b) => depth(a) - depth(b));
    const fRemote = await this.metasFor(fPush.map((f) => f.driveId));
    for (const f of fPush) {
      try {
        await this.pushFolder(f, rootId, fRemote.get(f.driveId ?? ''));
      } catch (e) {
        if (isFatal(e)) throw e;
        this.result.failed++;
        console.warn('폴더 올리기 실패', f.name, e);
      }
    }

    // 2) 첨부
    for (const a of await this.db.attachments.where('dirty').equals(1).toArray()) {
      try {
        await this.pushAttachment(a, attId);
      } catch (e) {
        if (isFatal(e)) throw e;
        this.result.failed++;
        console.warn('첨부 올리기 실패', a.name, e);
      }
    }

    // 3) 노트(충돌 사본처럼 올리는 도중 새로 생긴 노트도 바로 올리도록 한 번 더)
    for (let round = 0; round < 2; round++) {
      const before = this.result.conflicts;
      await this.pushNotes(rootId);
      if (this.result.conflicts === before) break;
    }

    // 4) 공통 설정
    if (await this.kv<boolean>(KV.sharedDirty)) await this.pushSettings();
  }

  private async pushNotes(rootId: string) {
    const notes = (await this.db.notes.toArray()).filter((n) => !n.contentMissing && (n.dirty || n.metaDirty || !n.driveId));
    if (notes.length) {
      const remote = await this.metasFor(notes.map((n) => n.driveId));
      let done = 0;
      this.hooks.onProgress?.({ phase: 'upload', done, total: notes.length });
      for (const n of notes) {
        try {
          await this.pushNote(n, rootId, remote.get(n.driveId ?? ''));
        } catch (e) {
          if (isFatal(e)) throw e;
          this.result.failed++;
          console.warn('노트 올리기 실패', n.name, e);
        }
        this.hooks.onProgress?.({ phase: 'upload', done: ++done, total: notes.length });
      }
    }
  }

  /** 여러 파일 메타데이터를 한 번에(드라이브 배치 요청) */
  private async metasFor(ids: (string | undefined)[]): Promise<Map<string, RemoteFile | null>> {
    const list = [...new Set(ids.filter((x): x is string => !!x))];
    const out = new Map<string, RemoteFile | null>();
    for (let i = 0; i < list.length; i += 100) {
      const chunk = list.slice(i, i + 100);
      const metas = await this.drive.getMetas(chunk);
      chunk.forEach((id, j) => out.set(id, metas[j]));
    }
    return out;
  }

  private async parentDriveId(folderId: string | null, rootId: string): Promise<string | null> {
    if (!folderId) return rootId;
    return (await this.db.folders.get(folderId))?.driveId ?? null;
  }

  private async pushFolder(f: FolderMeta, rootId: string, remote: RemoteFile | null | undefined) {
    const parent = await this.parentDriveId(f.parentId, rootId);
    if (!parent) return; // 상위 폴더가 아직 안 올라감(다음 번에)
    let driveId = f.driveId;
    if (!driveId || remote === null) {
      if (f.trashed) {
        // 한 번도 올리지 않은(또는 드라이브에서 사라진) 휴지통 폴더는 올릴 필요 없음
        await this.db.folders.update(f.id, { dirty: 0, driveId: undefined });
        return;
      }
      const r = await this.drive.createFolder(f.name, parent);
      driveId = r.id;
    } else if (remote) {
      const patch: MetaPatch = {};
      if (remote.name !== f.name) patch.name = f.name;
      if (!!remote.trashed !== !!f.trashed) patch.trashed = !!f.trashed;
      const rp = remote.parents?.[0];
      if (rp !== parent) Object.assign(patch, { addParents: parent, removeParents: rp });
      if (Object.keys(patch).length) await this.drive.updateMeta(driveId, patch);
    }
    await this.db.transaction('rw', this.db.folders, async () => {
      const cur = await this.db.folders.get(f.id);
      if (!cur) return;
      const same = cur.name === f.name && cur.parentId === f.parentId && cur.trashed === f.trashed;
      await this.db.folders.update(f.id, { driveId, dirty: same ? 0 : 1 });
    });
  }

  private async pushAttachment(a: AttachmentMeta, attId: string) {
    if (!a.driveId) {
      if (a.trashed) return void (await this.db.attachments.update(a.id, { dirty: 0 }));
      const blob = (await this.db.blobs.get(a.id))?.blob;
      if (!blob) return; // 내용이 없으면 올릴 수 없음
      const r = await this.drive.createFile(a.name, attId, a.mime || 'application/octet-stream', blob);
      await this.db.attachments.update(a.id, { driveId: r.id, md5: r.md5Checksum, dirty: 0 });
      this.result.uploaded++;
      return;
    }
    const remote = await this.drive.getMeta(a.driveId);
    if (!remote) return void (await this.db.attachments.update(a.id, { driveId: undefined }));
    const patch: MetaPatch = {};
    if (remote.name !== a.name) patch.name = a.name;
    if (!!remote.trashed !== !!a.trashed) patch.trashed = !!a.trashed;
    if (Object.keys(patch).length) await this.drive.updateMeta(a.driveId, patch);
    await this.db.attachments.update(a.id, { dirty: 0 });
  }

  private async pushNote(n: NoteMeta, rootId: string, remote: RemoteFile | null | undefined) {
    const parent = await this.parentDriveId(n.folderId, rootId);
    if (!parent) return; // 폴더가 아직 안 올라감
    const text = await this.repo.getContent(n.id);
    const fileName = `${n.name}.md`;

    // 새 노트(또는 드라이브에서 사라진 노트) → 새 파일로
    if (!n.driveId || remote === null) {
      if (n.trashed) {
        await this.db.notes.update(n.id, { dirty: 0, metaDirty: 0, driveId: undefined, baseRevision: undefined });
        return;
      }
      const r = await this.drive.createFile(fileName, parent, NOTE_MIME, text);
      await this.settle(n, text, { driveId: r.id, baseRevision: r.headRevisionId });
      this.result.uploaded++;
      return;
    }
    if (!remote) return; // 메타데이터를 못 받음(다음 번에)

    const patch: Partial<NoteMeta> = {};
    if (n.dirty) {
      if (remote.headRevisionId !== n.baseRevision) {
        // 다른 기기가 먼저 바꿨음
        const remoteText = await (await this.drive.download(n.driveId)).text();
        if (remoteText === text) patch.baseRevision = remote.headRevisionId;
        else {
          await this.conflict(n, text, remoteText, remote);
          return;
        }
      } else {
        const r = await this.drive.updateContent(n.driveId, text, NOTE_MIME);
        patch.baseRevision = r.headRevisionId;
        this.result.uploaded++;
        await this.checkRace(n, text, r.headRevisionId);
      }
    }
    // 이름·위치·휴지통
    if (n.metaDirty) {
      const mp: MetaPatch = {};
      if (remote.name !== fileName) mp.name = fileName;
      if (!!remote.trashed !== !!n.trashed) mp.trashed = !!n.trashed;
      const rp = remote.parents?.[0];
      if (rp !== parent) Object.assign(mp, { addParents: parent, removeParents: rp });
      if (Object.keys(mp).length) await this.drive.updateMeta(n.driveId, mp);
    }
    await this.settle(n, text, patch);
  }

  /** 올린 뒤: 그 사이 로컬에서 또 바뀌지 않았으면 변경 표시를 지운다 */
  private async settle(n: NoteMeta, text: string, patch: Partial<NoteMeta>) {
    await this.db.transaction('rw', this.db.notes, this.db.contents, async () => {
      const cur = await this.db.notes.get(n.id);
      if (!cur) return;
      const curText = (await this.db.contents.get(n.id))?.text ?? '';
      const sameMeta = cur.name === n.name && cur.folderId === n.folderId && cur.trashed === n.trashed;
      await this.db.notes.update(n.id, {
        ...patch,
        dirty: curText === text ? 0 : 1,
        metaDirty: sameMeta ? 0 : 1,
      });
    });
  }

  /**
   * 올린 직후 확인: 내 리비전 바로 앞이 내가 알던 리비전이 아니면,
   * 확인~올리기 사이에 다른 기기가 끼어든 것 → 그 내용을 충돌 사본으로 살린다.
   */
  private async checkRace(n: NoteMeta, myText: string, myRev: string | undefined) {
    if (!n.baseRevision || !myRev) return;
    try {
      const revs = await this.drive.listRevisions(n.driveId!);
      const i = revs.findIndex((r) => r.id === myRev);
      const prev = i > 0 ? revs[i - 1] : null;
      if (!prev || prev.id === n.baseRevision) return;
      const theirs = await (await this.drive.downloadRevision(n.driveId!, prev.id)).text();
      if (theirs === myText) return;
      const copy = await this.makeCopy(n, theirs, '다른 기기');
      this.result.conflicts++;
      this.hooks.onConflict?.({ noteId: n.id, copyId: copy.id, name: n.name, copyName: copy.name, kind: 'theirs' });
    } catch (e) {
      if (isFatal(e)) throw e;
      console.warn('리비전 확인 실패', e);
    }
  }

  private async makeCopy(n: NoteMeta, text: string, who?: string) {
    const label = `${n.name} (충돌 ${conflictLabel(this.now())}${who ? ' ' + who : ''})`;
    return this.repo.createNote(n.folderId, label, text);
  }

  /** 충돌: 원본 노트는 드라이브(다른 기기) 내용으로, 내 내용은 새 노트로 */
  private async conflict(n: NoteMeta, mine: string, theirs: string, remote: RemoteFile) {
    const copy = await this.makeCopy(n, mine);
    await this.db.transaction('rw', this.db.notes, this.db.contents, async () => {
      await this.db.contents.put({ id: n.id, text: theirs });
      await this.db.notes.update(n.id, {
        ...analyzeNote(theirs),
        baseRevision: remote.headRevisionId,
        dirty: 0,
        updatedAt: Date.parse(remote.modifiedTime ?? '') || Date.now(),
      });
    });
    this.result.conflicts++;
    this.hooks.onConflict?.({ noteId: n.id, copyId: copy.id, name: n.name, copyName: copy.name, kind: 'mine' });
  }

  private async pushSettings() {
    const appId = (await this.kv<string>(KV.app))!;
    const shared = await this.repo.getShared();
    const json = JSON.stringify(shared, null, 2);
    let id = await this.kv<string>(KV.settingsId);
    let rev: string | undefined;
    if (id && (await this.drive.getMeta(id))) rev = (await this.drive.updateContent(id, json, 'application/json')).headRevisionId;
    else {
      const r = await this.drive.createFile('settings.json', appId, 'application/json', json);
      id = r.id;
      rev = r.headRevisionId;
    }
    await this.setKv(KV.settingsId, id);
    await this.setKv('drive.settingsRev', rev);
    // 올리는 사이 또 바뀌었으면 표시를 남긴다
    if (JSON.stringify(await this.repo.getShared(), null, 2) === json) await this.setKv(KV.sharedDirty, false);
  }

  // ---------- 그 밖 ----------

  /** 첨부 내용 받기(캐시에 없을 때) */
  async fetchAttachment(a: AttachmentMeta): Promise<Blob | null> {
    if (!a.driveId) return null;
    const blob = await this.drive.download(a.driveId);
    await this.db.blobs.put({ id: a.id, blob });
    return blob;
  }

  /** 아직 드라이브에 올라가지 않은 변경 수 */
  async pendingCount(): Promise<number> {
    const n = await this.db.notes.filter((x) => !!(x.dirty || x.metaDirty || (!x.driveId && !x.trashed))).count();
    const f = await this.db.folders.filter((x) => !!(x.dirty || (!x.driveId && !x.trashed))).count();
    const a = await this.db.attachments.where('dirty').equals(1).count();
    const d = ((await this.kv<string[]>(KV.pendingDeletes)) ?? []).length;
    const s = (await this.kv<boolean>(KV.sharedDirty)) ? 1 : 0;
    return n + f + a + d + s;
  }
}
