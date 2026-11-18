// 테스트용 가짜 구글드라이브(메모리). 리비전, 휴지통, 변경 목록(changes)을 실제와 비슷하게 흉내 낸다.
// 여러 "기기"(엔진)가 같은 FakeDrive를 함께 쓰면 기기 간 동기화를 시험할 수 있다.
import { FOLDER_MIME, type DriveLike, type MetaPatch, type RemoteChange, type RemoteFile, type RemoteRevision } from './types';

interface Stored extends RemoteFile {
  content: Blob | null;
  revisions: { id: string; modifiedTime: string; content: Blob }[];
}

export class FakeDrive implements DriveLike {
  files = new Map<string, Stored>();
  /** 변경 기록: [순번, 파일 ID] */
  private log: { seq: number; id: string }[] = [];
  private seq = 0;
  private idSeq = 0;
  private revSeq = 0;
  private clock = Date.parse('2026-11-18T00:00:00Z');
  /** 호출 수(테스트에서 요청을 줄였는지 확인용) */
  calls: Record<string, number> = {};
  /** 다음 호출에서 던질 오류(테스트용) */
  failNext: Error | null = null;

  private hit(name: string) {
    this.calls[name] = (this.calls[name] ?? 0) + 1;
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
  }

  private now() {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  private touch(id: string) {
    this.log.push({ seq: ++this.seq, id });
  }

  private pub(f: Stored): RemoteFile {
    const { content: _c, revisions: _r, ...meta } = f;
    return { ...meta, parents: f.parents ? [...f.parents] : undefined, appProperties: f.appProperties ? { ...f.appProperties } : undefined };
  }

  private addRevision(f: Stored, content: Blob) {
    const rev = { id: `r${++this.revSeq}`, modifiedTime: this.now(), content };
    f.revisions.push(rev);
    f.headRevisionId = rev.id;
    f.content = content;
    f.size = String(content.size);
    f.md5Checksum = `md5-${rev.id}`;
    f.modifiedTime = rev.modifiedTime;
  }

  async findByAppProp(kind: string) {
    this.hit('findByAppProp');
    return [...this.files.values()].filter((f) => !f.trashed && f.appProperties?.mynotes === kind).map((f) => this.pub(f));
  }

  async createFolder(name: string, parentId: string | null, appProps?: Record<string, string>) {
    this.hit('createFolder');
    const f: Stored = {
      id: `F${++this.idSeq}`,
      name,
      mimeType: FOLDER_MIME,
      parents: parentId ? [parentId] : ['root'],
      trashed: false,
      appProperties: appProps,
      createdTime: this.now(),
      modifiedTime: this.now(),
      content: null,
      revisions: [],
    };
    this.files.set(f.id, f);
    this.touch(f.id);
    return this.pub(f);
  }

  async createFile(name: string, parentId: string, mimeType: string, data: string | Blob, appProps?: Record<string, string>) {
    this.hit('createFile');
    const f: Stored = {
      id: `D${++this.idSeq}`,
      name,
      mimeType,
      parents: [parentId],
      trashed: false,
      appProperties: appProps,
      createdTime: this.now(),
      content: null,
      revisions: [],
    };
    this.addRevision(f, typeof data === 'string' ? new Blob([data]) : data);
    this.files.set(f.id, f);
    this.touch(f.id);
    return this.pub(f);
  }

  async updateContent(id: string, data: string | Blob, _mimeType?: string) {
    this.hit('updateContent');
    const f = this.files.get(id);
    if (!f) throw notFound(id);
    this.addRevision(f, typeof data === 'string' ? new Blob([data]) : data);
    this.touch(id);
    return this.pub(f);
  }

  async updateMeta(id: string, patch: MetaPatch) {
    this.hit('updateMeta');
    const f = this.files.get(id);
    if (!f) throw notFound(id);
    if (patch.name !== undefined) f.name = patch.name;
    if (patch.trashed !== undefined) f.trashed = patch.trashed;
    if (patch.removeParents) f.parents = (f.parents ?? []).filter((p) => p !== patch.removeParents);
    if (patch.addParents) f.parents = [...(f.parents ?? []), patch.addParents];
    f.modifiedTime = this.now();
    this.touch(id);
    return this.pub(f);
  }

  async getMeta(id: string) {
    this.hit('getMeta');
    const f = this.files.get(id);
    return f ? this.pub(f) : null;
  }

  async getMetas(ids: string[]) {
    this.hit('getMetas');
    return ids.map((id) => {
      const f = this.files.get(id);
      return f ? this.pub(f) : null;
    });
  }

  async download(id: string) {
    this.hit('download');
    const f = this.files.get(id);
    if (!f || !f.content) throw notFound(id);
    return f.content;
  }

  async remove(id: string) {
    this.hit('remove');
    // 폴더를 지우면 안의 파일도 함께 사라진다(드라이브와 같음)
    const kill = (fid: string) => {
      for (const c of [...this.files.values()]) if (c.parents?.includes(fid)) kill(c.id);
      if (this.files.delete(fid)) this.touch(fid);
    };
    kill(id);
  }

  async listAll() {
    this.hit('listAll');
    return [...this.files.values()].map((f) => this.pub(f));
  }

  async getStartPageToken() {
    this.hit('getStartPageToken');
    return String(this.seq + 1);
  }

  async listChanges(pageToken: string) {
    this.hit('listChanges');
    const from = Number(pageToken);
    const latest = new Map<string, number>();
    for (const e of this.log) if (e.seq >= from) latest.set(e.id, e.seq);
    const changes: RemoteChange[] = [...latest.keys()].map((id) => {
      const f = this.files.get(id);
      return f ? { fileId: id, file: this.pub(f) } : { fileId: id, removed: true };
    });
    return { changes, newStartPageToken: String(this.seq + 1) };
  }

  async listRevisions(id: string): Promise<RemoteRevision[]> {
    this.hit('listRevisions');
    const f = this.files.get(id);
    if (!f) throw notFound(id);
    return f.revisions.map((r) => ({ id: r.id, modifiedTime: r.modifiedTime, size: String(r.content.size) }));
  }

  async downloadRevision(id: string, revId: string) {
    this.hit('downloadRevision');
    const r = this.files.get(id)?.revisions.find((x) => x.id === revId);
    if (!r) throw notFound(`${id}@${revId}`);
    return r.content;
  }

  // ---------- 테스트 도우미: 다른 기기(드라이브 웹 등)에서 직접 바꾼 것처럼 ----------

  async externalWrite(id: string, text: string) {
    const f = this.files.get(id)!;
    this.addRevision(f, new Blob([text]));
    this.touch(id);
  }

  async textOf(id: string) {
    return (await this.files.get(id)?.content?.text()) ?? null;
  }

  byName(name: string) {
    return [...this.files.values()].filter((f) => f.name === name);
  }
}

function notFound(id: string) {
  const e = new Error(`없는 파일: ${id}`) as Error & { status: number };
  e.status = 404;
  return e;
}
