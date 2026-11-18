// 화면 전체 상태. IndexedDB 변경을 liveQuery로 구독해 자동으로 화면에 반영한다.
import { liveQuery, type Subscription } from 'dexie';
import { buildFolderTree, byId, folderPath, isNoteVisible } from '../core/tree';
import { sortNotes } from '../core/sort';
import { nameKey } from '../core/names';
import type { AttachmentMeta, DeviceSettings, FolderMeta, NoteMeta, SharedSettings } from '../core/types';
import { kindOf } from '../core/attachments';
import { buildTagTree, matchTags, tagKey } from '../core/tags';
import { buildNameIndex, linkNameFor, resolveName, type NoteRef } from '../core/links';
import type { EditorHost } from '../editor/host';
import { SearchClient } from '../search/client';
import type { SyncService } from '../sync/service.svelte';
import { blobUrlFor } from '../media/blobUrls';
import { DEFAULT_DEVICE, DEFAULT_SHARED, Repo, UserError } from '../store/repo';

export type View =
  | { kind: 'all' }
  | { kind: 'fav' }
  | { kind: 'trash' }
  | { kind: 'graph' } // 모든 노트 관계 그래프
  | { kind: 'folder'; id: string | null } // null = 노트 루트(폴더 밖)
  | { kind: 'tags'; tags: string[]; mode: 'and' | 'or' } // 태그로 거르기
  | { kind: 'search'; q: string }; // 전체 검색

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
  action?: { label: string; run: () => void };
}

// ---------- 해시 라우팅 (안드로이드 뒤로가기 지원) ----------
// 형식: #/all | #/fav | #/trash | #/graph | #/folder/<id> | #/root  (+ /n/<노트id>)

function parseHash(hash: string): { view: View; noteId: string | null } {
  const parts = hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  let view: View = { kind: 'all' };
  let i = 0;
  if (parts[0] === 'fav') { view = { kind: 'fav' }; i = 1; }
  else if (parts[0] === 'trash') { view = { kind: 'trash' }; i = 1; }
  else if (parts[0] === 'graph') { view = { kind: 'graph' }; i = 1; }
  else if (parts[0] === 'root') { view = { kind: 'folder', id: null }; i = 1; }
  else if (parts[0] === 'folder' && parts[1]) { view = { kind: 'folder', id: parts[1] }; i = 2; }
  else if (parts[0] === 'search') {
    view = { kind: 'search', q: parts[1] ?? '' };
    i = 2;
  } else if (parts[0] === 'tag' && parts[1]) {
    view = { kind: 'tags', tags: parts[1].split(',').filter(Boolean), mode: parts[2] === 'or' ? 'or' : 'and' };
    i = 3;
  }
  else if (parts[0] === 'all') i = 1;
  const noteId = parts[i] === 'n' && parts[i + 1] ? parts[i + 1] : null;
  return { view, noteId };
}

function makeHash(view: View, noteId: string | null): string {
  let h = '#/';
  if (view.kind === 'folder') h += view.id ? `folder/${encodeURIComponent(view.id)}` : 'root';
  else if (view.kind === 'tags') h += `tag/${encodeURIComponent(view.tags.join(','))}/${view.mode}`;
  else if (view.kind === 'search') h += `search/${encodeURIComponent(view.q)}`;
  else h += view.kind;
  if (noteId) h += `/n/${encodeURIComponent(noteId)}`;
  return h;
}

export class AppStore {
  folders = $state.raw<FolderMeta[]>([]);
  notes = $state.raw<NoteMeta[]>([]);
  device = $state<DeviceSettings>({ ...DEFAULT_DEVICE });
  shared = $state<SharedSettings>({ ...DEFAULT_SHARED });
  loaded = $state(false);

  view = $state<View>({ kind: 'all' });
  openNoteId = $state<string | null>(null);
  drawerOpen = $state(false);
  toasts = $state<Toast[]>([]);
  /** 화면 폭 구분: mobile(<720) / tablet(<1024) / desktop */
  layout = $state<'mobile' | 'tablet' | 'desktop'>('desktop');
  /** 사이드바를 드로어(햄버거 메뉴)로 보여 주는지: 좁은 화면이거나 PC에서 접었을 때 */
  sideAsDrawer = $derived(this.layout !== 'desktop' || this.device.sidebarCollapsed);

  folderMap = $derived(byId(this.folders));
  tree = $derived(buildFolderTree(this.folders));
  favSet = $derived(new Set(this.shared.favorites));
  liveNotes = $derived(this.notes.filter((n) => isNoteVisible(n, this.folderMap)));

  /** 폴더별 노트 수(바로 아래 노트만) */
  folderCounts = $derived.by(() => {
    const m = new Map<string | null, number>();
    for (const n of this.liveNotes) m.set(n.folderId, (m.get(n.folderId) ?? 0) + 1);
    return m;
  });

  /** 현재 보기의 노트 목록(정렬 포함) */
  listNotes = $derived.by(() => {
    const v = this.view;
    let list: NoteMeta[];
    if (v.kind === 'all') list = this.liveNotes;
    else if (v.kind === 'fav') list = this.liveNotes.filter((n) => this.favSet.has(n.id));
    else if (v.kind === 'folder') list = this.liveNotes.filter((n) => n.folderId === v.id);
    else if (v.kind === 'tags') list = this.liveNotes.filter((n) => matchTags(n.tags ?? [], v.tags, v.mode));
    else list = [];
    return sortNotes(list, this.device.sortKey, this.device.sortDir, this.favSet);
  });

  /** 태그 트리와 키→노드 맵(노트 수 포함) */
  tagIndex = $derived(buildTagTree(this.liveNotes.map((n) => n.tags)));

  /** 자동완성용 태그 목록(많이 쓴 순) */
  tagList = $derived(
    [...this.tagIndex.byKey.values()]
      .map((n) => ({ name: n.full, count: n.count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko')),
  );

  /** 태그 클릭: 그 태그로 거른 목록 */
  openTag(tag: string) {
    const full = this.tagIndex.byKey.get(tagKey(tag))?.full ?? tag;
    this.setView({ kind: 'tags', tags: [full], mode: 'and' });
  }

  /** 태그 보기에서 태그를 더하거나 빼기 */
  setTagFilter(tags: string[], mode: 'and' | 'or') {
    if (!tags.length) this.setView({ kind: 'all' });
    else this.setView({ kind: 'tags', tags, mode });
  }

  /** 노트 이름(소문자) → 노트들. 위키링크 해석용 */
  notesByName = $derived.by(() => {
    const m = new Map<string, NoteMeta[]>();
    for (const n of this.liveNotes) {
      const k = nameKey(n.name);
      const list = m.get(k);
      if (list) list.push(n);
      else m.set(k, [n]);
    }
    return m;
  });

  /** 첨부파일 메타데이터(내용은 필요할 때만 읽는다) */
  attachments = $state.raw<AttachmentMeta[]>([]);
  attByName = $derived(new Map(this.attachments.filter((a) => !a.trashed).map((a) => [a.nameKey, a])));

  findAttachment(name: string): AttachmentMeta | null {
    const base = name.split('/').pop()!.trim();
    return this.attByName.get(nameKey(base)) ?? null;
  }

  async attachmentUrl(name: string): Promise<string | null> {
    const att = this.findAttachment(name);
    if (!att) return null;
    const blob = await this.attachmentBlob(att);
    return blob ? blobUrlFor(att.id, blob, att.updatedAt) : null;
  }

  /** 첨부 내용: 로컬 캐시 → 없으면 드라이브에서 받아 캐시 */
  private fetching = new Map<string, Promise<Blob | null>>();
  async attachmentBlob(att: AttachmentMeta): Promise<Blob | null> {
    const local = await this.repo.getAttachmentBlob(att.id);
    if (local) return local;
    if (!this.sync || !att.driveId) return null;
    let p = this.fetching.get(att.id);
    if (!p) {
      p = this.sync.engine.fetchAttachment(att).catch((e) => {
        console.warn('첨부 받기 실패', att.name, e);
        return null;
      });
      this.fetching.set(att.id, p);
      void p.finally(() => this.fetching.delete(att.id));
    }
    return p;
  }

  async attachmentData(name: string): Promise<ArrayBuffer | null> {
    const att = this.findAttachment(name);
    const blob = att && (await this.attachmentBlob(att));
    return blob ? blob.arrayBuffer() : null;
  }

  /** 첨부 열기: 이미지·PDF는 새 탭, 그 밖은 내려받기 */
  async openAttachment(name: string) {
    const att = this.findAttachment(name);
    const url = await this.attachmentUrl(name);
    if (!att || !url) {
      this.toast(`첨부파일을 찾을 수 없습니다: ${name}`, 'error');
      return;
    }
    const kind = kindOf(att.name);
    if (kind === 'image' || kind === 'pdf') {
      // blob URL은 같은 출처라 noopener 없이 연다(noopener를 주면 성공해도 null이 돌아옴)
      if (window.open(url, '_blank')) return;
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = att.name;
    document.body.append(a);
    a.click();
    a.remove();
  }

  /** 읽기 모드(이번 실행 동안만 유지) */
  readMode = $state(false);

  openNote = $derived(this.openNoteId ? this.notes.find((n) => n.id === this.openNoteId) ?? null : null);

  viewTitle = $derived.by(() => {
    const v = this.view;
    if (v.kind === 'all') return '모든 노트';
    if (v.kind === 'fav') return '즐겨찾기';
    if (v.kind === 'trash') return '휴지통';
    if (v.kind === 'graph') return '그래프';
    if (v.kind === 'tags') return v.tags.map((t) => `#${t}`).join(v.mode === 'and' ? ' + ' : ' 또는 ');
    if (v.kind === 'search') return '검색';
    if (v.id === null) return '폴더 밖 노트';
    return this.folderMap.get(v.id)?.name ?? '폴더';
  });

  /** 설정 화면의 "데모 데이터 초기화" 처리(App에서 연결) */
  onResetDemo?: () => Promise<void>;
  /** 모드 바꾸기(데모 ↔ 드라이브 연결 화면) */
  onSwitchMode?: (to: 'demo' | 'connect') => Promise<void>;
  /** 로그아웃(wipe: 이 기기의 사본도 지움) */
  onSignOut?: (wipe: boolean) => Promise<void>;

  private subs: Subscription[] = [];
  private toastSeq = 0;

  constructor(readonly repo: Repo) {}

  /** 구글드라이브 동기화(드라이브 모드에서만) */
  sync: SyncService | null = null;
  /** 충돌 비교 화면(원본 a, 사본 b) */
  compare = $state<{ a: string; b: string } | null>(null);
  /** 이전 버전 보기 대상 노트 */
  versionsFor = $state<string | null>(null);

  get mode(): 'demo' | 'drive' {
    return this.sync ? 'drive' : 'demo';
  }

  /** 전체 검색(워커). start()에서 만든다 */
  search: SearchClient | null = null;
  /** 빠른 열기(Ctrl+P) 창 */
  quickOpen = $state(false);
  /** 검색창에 포커스 요청 */
  searchFocusSeq = $state(0);
  private effectsCleanup: (() => void) | null = null;

  /** 검색어를 바꿀 때: 기록을 쌓지 않고 주소만 바꾼다 */
  setSearchQuery(q: string) {
    this.view = { kind: 'search', q };
    history.replaceState(null, '', makeHash(this.view, this.layout === 'mobile' ? null : this.openNoteId));
  }

  openSearch(q = '') {
    if (this.view.kind === 'search') {
      this.searchFocusSeq++;
      return;
    }
    this.setView({ kind: 'search', q });
    this.searchFocusSeq++;
  }

  async start(): Promise<void> {
    this.device = await this.repo.getDevice();
    this.shared = await this.repo.getShared();
    // 검색 색인: 노트 목록이 바뀌면 바뀐 노트만 워커가 다시 읽는다
    this.search = new SearchClient(this.repo.db);
    this.effectsCleanup = $effect.root(() => {
      $effect(() => {
        const metas = this.liveNotes.map((n) => ({
          id: n.id,
          title: n.name,
          path: folderPath(n.folderId, this.folderMap).join('/'),
          tags: [...(n.tags ?? [])],
          updatedAt: n.updatedAt,
        }));
        this.search?.setMeta(metas);
      });
    });
    this.subs.push(
      liveQuery(() => this.repo.db.folders.toArray()).subscribe({
        next: (v) => {
          this.folders = v;
          this.sync?.onLocalChange();
        },
        error: (e) => this.fail(e),
      }),
      liveQuery(() => this.repo.db.attachments.toArray()).subscribe({
        next: (v) => {
          this.attachments = v;
          this.sync?.onLocalChange();
        },
        error: (e) => this.fail(e),
      }),
      liveQuery(() => this.repo.db.notes.toArray()).subscribe({
        next: (v) => {
          this.notes = v;
          this.loaded = true;
          this.sync?.onLocalChange();
        },
        error: (e) => this.fail(e),
      }),
    );
    // 주소(해시)에서 상태 복원, 없으면 이 기기에서 마지막으로 연 노트
    const fromHash = parseHash(location.hash);
    this.view = fromHash.view;
    this.openNoteId = fromHash.noteId;
    window.addEventListener('hashchange', this.onHash);
    this.watchLayout();
    if (!this.openNoteId && this.layout !== 'mobile' && this.device.lastNoteId) {
      this.openNoteId = this.device.lastNoteId;
      history.replaceState(null, '', makeHash(this.view, this.openNoteId));
    }
  }

  stop(): void {
    this.sync?.stop();
    this.subs.forEach((s) => s.unsubscribe());
    this.effectsCleanup?.();
    this.search?.destroy();
    window.removeEventListener('hashchange', this.onHash);
  }

  private onHash = () => {
    const { view, noteId } = parseHash(location.hash);
    this.view = view;
    this.openNoteId = noteId;
  };

  private watchLayout() {
    const mqMobile = matchMedia('(max-width: 719px)');
    const mqTablet = matchMedia('(max-width: 1023px)');
    const update = () => {
      this.layout = mqMobile.matches ? 'mobile' : mqTablet.matches ? 'tablet' : 'desktop';
      if (this.layout === 'desktop' && !this.device.sidebarCollapsed) this.drawerOpen = false;
    };
    update();
    mqMobile.addEventListener('change', update);
    mqTablet.addEventListener('change', update);
  }

  // ---------- 탐색 ----------

  setView(view: View) {
    this.drawerOpen = false;
    this.clearSelection();
    // 모바일에서는 보기를 바꾸면 목록으로 돌아간다
    const keepNote = this.layout === 'mobile' ? null : this.openNoteId;
    location.hash = makeHash(view, keepNote);
  }

  /** 노트를 열고 #제목 / #^블록 위치로 이동 */
  openAt(noteId: string, sub: string | null) {
    this.pendingAnchor = sub ? { noteId, sub } : null;
    if (noteId === this.openNoteId) {
      // 같은 노트: 편집기가 pendingAnchor를 보고 이동
      this.anchorSeq++;
      return;
    }
    this.open(noteId);
  }

  /** 노트를 열고 특정 줄(0부터)로 이동(백링크 클릭) */
  openAtLine(noteId: string, line: number) {
    this.pendingAnchor = { noteId, sub: '', line };
    if (noteId === this.openNoteId) {
      this.anchorSeq++;
      return;
    }
    this.open(noteId);
  }

  /** 이동할 위치(편집기가 처리 후 비움). line이 있으면 그 줄로 */
  pendingAnchor = $state<{ noteId: string; sub: string; line?: number } | null>(null);
  anchorSeq = $state(0);

  /** 링크 미리보기 팝업 */
  preview = $state<{ raw: string; fromFolder: string | null; rect: { left: number; top: number; bottom: number; width: number } } | null>(null);
  private previewTimer: ReturnType<typeof setTimeout> | null = null;

  showPreview(raw: string, anchor: HTMLElement, fromFolder: string | null) {
    this.keepPreview();
    const r = anchor.getBoundingClientRect();
    this.preview = { raw, fromFolder, rect: { left: r.left, top: r.top, bottom: r.bottom, width: r.width } };
  }
  hidePreviewSoon(ms = 250) {
    this.keepPreview();
    this.previewTimer = setTimeout(() => (this.preview = null), ms);
  }
  keepPreview() {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = null;
  }

  /** 모바일·태블릿에서 목차·백링크 시트 열림 */
  panelSheet = $state(false);

  // ---------- 여러 노트 선택 ----------

  /** 선택한 노트 id(선택 모드는 하나 이상일 때) */
  selected = $state<string[]>([]);
  selecting = $derived(this.selected.length > 0);
  selectedSet = $derived(new Set(this.selected));
  /** Shift+클릭 범위 선택의 기준 */
  private selectAnchor: string | null = null;

  toggleSelect(id: string) {
    this.selected = this.selectedSet.has(id) ? this.selected.filter((x) => x !== id) : [...this.selected, id];
    this.selectAnchor = id;
  }

  /** 기준 노트부터 id까지 현재 목록 순서대로 선택 */
  selectRange(id: string) {
    const list = this.listNotes.map((n) => n.id);
    const a = this.selectAnchor ? list.indexOf(this.selectAnchor) : -1;
    const b = list.indexOf(id);
    if (a < 0 || b < 0) return this.toggleSelect(id);
    const [s, e] = a < b ? [a, b] : [b, a];
    this.selected = [...new Set([...this.selected, ...list.slice(s, e + 1)])];
  }

  selectAll() {
    this.selected = this.listNotes.map((n) => n.id);
  }

  clearSelection() {
    this.selected = [];
    this.selectAnchor = null;
  }

  /** 선택한 노트들을 휴지통으로(실행 취소 가능) */
  async trashSelected() {
    const ids = [...this.selected];
    await this.run(async () => {
      for (const id of ids) await this.repo.trashNote(id);
      if (this.openNoteId && ids.includes(this.openNoteId)) this.open(null);
      this.clearSelection();
      this.toast(`노트 ${ids.length}개를 휴지통으로 옮겼습니다.`, 'info', {
        label: '실행 취소',
        run: () =>
          void this.run(async () => {
            for (const id of ids) await this.repo.restoreNote(id);
          }),
      });
    });
  }

  async moveSelected(folderId: string | null) {
    const ids = [...this.selected];
    let relinked = 0;
    await this.run(async () => {
      for (const id of ids) {
        await this.repo.moveNote(id, folderId);
        relinked += this.repo.lastRelinked;
      }
    });
    this.clearSelection();
    this.toast(`노트 ${ids.length}개를 ${this.placeName(folderId)}(으)로 옮겼습니다.${relinked ? ` (링크 ${relinked}곳 갱신)` : ''}`);
  }

  /** 선택한 노트가 모두 즐겨찾기면 해제, 아니면 모두 즐겨찾기 */
  async favoriteSelected() {
    const ids = this.selected;
    const allFav = ids.every((id) => this.favSet.has(id));
    const fav = new Set(this.shared.favorites);
    for (const id of ids) {
      if (allFav) fav.delete(id);
      else fav.add(id);
    }
    await this.setShared({ favorites: [...fav] });
    this.toast(allFav ? `즐겨찾기 ${ids.length}개를 해제했습니다.` : `노트 ${ids.length}개를 즐겨찾기했습니다.`);
    this.clearSelection();
  }

  /** 마지막 입력이 터치였는지(길게 누르기 = 선택, 마우스 오른쪽 클릭 = 메뉴 구분용) */
  lastPointer: 'mouse' | 'touch' | 'pen' = 'mouse';

  open(noteId: string | null) {
    const target = makeHash(this.view, noteId);
    if (noteId === null && this.layout === 'mobile' && history.length > 1 && this.openNoteId) {
      // 모바일 편집 화면의 뒤로 버튼은 실제 뒤로가기로 처리해 기록이 쌓이지 않게 한다
      history.back();
      return;
    }
    // 데스크톱에서 노트를 바꿀 때는 기록을 덮어써 뒤로가기가 노트마다 쌓이지 않게 한다
    if (this.layout !== 'mobile' && this.openNoteId && noteId) history.replaceState(null, '', target);
    else location.hash = target;
    this.openNoteId = noteId;
    if (noteId) void this.setDevice({ lastNoteId: noteId });
  }

  folderPathText(folderId: string | null): string {
    return folderPath(folderId, this.folderMap).join(' / ');
  }

  // ---------- 설정 ----------

  async setDevice(patch: Partial<DeviceSettings>) {
    this.device = await this.repo.setDevice(patch);
  }

  async setShared(patch: Partial<SharedSettings>) {
    this.shared = await this.repo.setShared(patch);
  }

  toggleExpanded(folderId: string, force?: boolean) {
    const set = new Set(this.device.expanded);
    const open = force ?? !set.has(folderId);
    if (open) set.add(folderId);
    else set.delete(folderId);
    void this.setDevice({ expanded: [...set] });
  }

  async toggleFavorite(noteId: string) {
    const fav = new Set(this.shared.favorites);
    if (fav.has(noteId)) fav.delete(noteId);
    else fav.add(noteId);
    await this.setShared({ favorites: [...fav] });
  }

  // ---------- 알림 ----------

  toast(text: string, kind: Toast['kind'] = 'info', action?: Toast['action'], ms = 4000) {
    const id = ++this.toastSeq;
    this.toasts = [...this.toasts, { id, text, kind, action }];
    setTimeout(() => this.dismiss(id), kind === 'error' ? Math.max(ms, 7000) : ms);
  }

  dismiss(id: number) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }

  fail(e: unknown) {
    if (e instanceof UserError) this.toast(e.message, 'error');
    else {
      console.error(e);
      this.toast(`오류가 발생했습니다: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }

  /** 편집기의 저장 대기 내용을 즉시 저장(NoteEditor가 등록) */
  editorFlush: (() => Promise<void>) | null = null;
  /** 편집기 기능 묶음(미리보기 팝업의 임베드 표시·링크 이동에 사용, NoteEditor가 등록) */
  editorHost: EditorHost | null = null;

  /**
   * 작업 실행 + 오류는 알림으로.
   * 여러 노트 내용을 바꿀 수 있는 작업(링크·태그 갱신) 전에 편집 중인 내용을 먼저 저장해
   * 편집기와 저장소 내용이 엇갈리지 않게 한다.
   */
  async run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      await this.editorFlush?.();
      return await fn();
    } catch (e) {
      this.fail(e);
      return undefined;
    }
  }

  // ---------- 노트/폴더 작업 (화면에서 호출) ----------

  /** 새 노트를 만들 폴더: 폴더 보기면 그 폴더, 아니면 루트 */
  currentFolderId(): string | null {
    return this.view.kind === 'folder' ? this.view.id : null;
  }

  async newNote(folderId = this.currentFolderId()) {
    const note = await this.run(() => this.repo.createNote(folderId));
    if (note) {
      if (this.view.kind === 'trash') this.view = { kind: 'all' };
      this.pendingTitleFocus = note.id;
      this.open(note.id);
    }
  }

  /** 새로 만든 노트는 제목 입력란에 바로 포커스 */
  pendingTitleFocus: string | null = null;

  async trashNote(id: string) {
    await this.run(async () => {
      await this.repo.trashNote(id);
      if (this.openNoteId === id) this.open(null);
      this.toast('노트를 휴지통으로 옮겼습니다.', 'info', {
        label: '실행 취소',
        run: () => void this.run(() => this.repo.restoreNote(id)),
      });
    });
  }

  async trashFolder(id: string) {
    await this.run(async () => {
      await this.repo.trashFolder(id);
      if (this.view.kind === 'folder' && this.view.id === id) this.setView({ kind: 'all' });
      this.toast('폴더를 휴지통으로 옮겼습니다.', 'info', {
        label: '실행 취소',
        run: () => void this.run(() => this.repo.restoreFolder(id)),
      });
    });
  }

  async moveNote(id: string, folderId: string | null) {
    const name = await this.run(() => this.repo.moveNote(id, folderId));
    if (name !== undefined) this.toast(`"${name}" 노트를 ${this.placeName(folderId)}(으)로 옮겼습니다.`);
  }

  async moveFolder(id: string, parentId: string | null) {
    const name = await this.run(() => this.repo.moveFolder(id, parentId));
    if (name !== undefined) {
      if (parentId) this.toggleExpanded(parentId, true);
      this.toast(`"${name}" 폴더를 ${this.placeName(parentId)}(으)로 옮겼습니다.`);
    }
  }

  /**
   * 위키링크 대상 노트 찾기. 이름이 같은 노트가 여러 개면 기준 폴더에 가까운 것을 고른다.
   * "폴더/노트" 형태의 경로도 받는다.
   */
  findNote(name: string, fromFolder: string | null = null): NoteMeta | null {
    const ref = resolveName(name, fromFolder, this.nameIndex);
    return ref ? (this.noteById.get(ref.id) ?? null) : null;
  }

  /** 링크 해석용 노트 정보(폴더 경로 포함) */
  noteRefs = $derived<NoteRef[]>(
    this.liveNotes.map((n) => ({ id: n.id, name: n.name, folderId: n.folderId, path: folderPath(n.folderId, this.folderMap).join('/') })),
  );
  nameIndex = $derived(buildNameIndex(this.noteRefs));
  noteById = $derived(new Map(this.notes.map((n) => [n.id, n])));
  refById = $derived(new Map(this.noteRefs.map((r) => [r.id, r])));

  /** from 폴더에서 노트를 가리키는 가장 짧은 링크 이름 */
  linkNameFor(noteId: string, fromFolder: string | null): string {
    const ref = this.refById.get(noteId);
    return ref ? linkNameFor(ref, fromFolder, this.nameIndex) : '';
  }

  placeName(folderId: string | null): string {
    return folderId ? `"${this.folderPathText(folderId)}"` : '최상위';
  }
}
