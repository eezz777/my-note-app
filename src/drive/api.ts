// 구글드라이브 REST API(v3) 클라이언트. 브라우저 fetch만 쓴다(서버·라이브러리 없음).
// - 일시적 오류(429, 5xx, 속도 제한 403, 네트워크)는 간격을 늘려 다시 시도
// - 401은 토큰 만료 → AuthError
// - 여러 파일 메타데이터 조회는 배치 요청(최대 100개)으로 묶는다
import { AuthError, FOLDER_MIME, OfflineError, type DriveLike, type MetaPatch, type RemoteChange, type RemoteFile, type RemoteRevision } from './types';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const BATCH = 'https://www.googleapis.com/batch/drive/v3';
export const FILE_FIELDS = 'id,name,mimeType,parents,trashed,md5Checksum,headRevisionId,modifiedTime,createdTime,size,appProperties';
const RESUMABLE_OVER = 5 * 1024 * 1024;

export class DriveError extends Error {
  constructor(
    readonly status: number,
    msg: string,
  ) {
    super(msg);
    this.name = 'DriveError';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class DriveApi implements DriveLike {
  constructor(
    /** 유효한 액세스 토큰(없으면 AuthError를 던짐) */
    private getToken: () => Promise<string>,
    /** 401을 받았을 때(토큰 무효화) */
    private onUnauthorized: () => void = () => {},
  ) {}

  /** 요청 + 재시도 */
  private async req(url: string, init: RequestInit = {}, expectJson = true): Promise<Response> {
    let delay = 1000;
    for (let attempt = 0; ; attempt++) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new OfflineError();
      const token = await this.getToken();
      let res: Response;
      try {
        res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } });
      } catch {
        // 네트워크 끊김: 몇 번만 다시 시도
        if (attempt >= 2) throw new OfflineError();
        await sleep(delay);
        delay *= 2;
        continue;
      }
      if (res.status === 401) {
        this.onUnauthorized();
        throw new AuthError('구글 로그인이 만료되었습니다.');
      }
      if (res.ok) return res;
      let reason = '';
      let message = `드라이브 오류 ${res.status}`;
      try {
        const j = await res.clone().json();
        reason = j?.error?.errors?.[0]?.reason ?? '';
        message = j?.error?.message ?? message;
      } catch {
        /* 본문이 JSON이 아님 */
      }
      const retryable = res.status === 429 || res.status >= 500 || (res.status === 403 && /rateLimit|userRateLimit|backendError/i.test(reason));
      if (retryable && attempt < 5) {
        const ra = Number(res.headers.get('Retry-After'));
        await sleep(ra > 0 ? ra * 1000 : delay + Math.random() * 500);
        delay = Math.min(delay * 2, 32000);
        continue;
      }
      void expectJson;
      throw new DriveError(res.status, message);
    }
  }

  private async json<T>(url: string, init?: RequestInit): Promise<T> {
    return (await this.req(url, init)).json() as Promise<T>;
  }

  private q(params: Record<string, string | number | boolean | undefined>) {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) u.set(k, String(v));
    return u.toString();
  }

  // ---------- 계정 ----------

  async about(): Promise<{ displayName: string; emailAddress: string; permissionId: string }> {
    const r = await this.json<{ user: { displayName: string; emailAddress: string; permissionId: string } }>(
      `${API}/about?${this.q({ fields: 'user(displayName,emailAddress,permissionId)' })}`,
    );
    return r.user;
  }

  // ---------- DriveLike ----------

  async findByAppProp(kind: string): Promise<RemoteFile[]> {
    const q = `appProperties has { key='mynotes' and value='${kind}' } and trashed = false`;
    const r = await this.json<{ files: RemoteFile[] }>(`${API}/files?${this.q({ q, fields: `files(${FILE_FIELDS})`, pageSize: 100, spaces: 'drive' })}`);
    return r.files ?? [];
  }

  async createFolder(name: string, parentId: string | null, appProps?: Record<string, string>): Promise<RemoteFile> {
    return this.json<RemoteFile>(`${API}/files?${this.q({ fields: FILE_FIELDS })}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: parentId ? [parentId] : undefined, appProperties: appProps }),
    });
  }

  /** 메타데이터 + 내용 한 번에(작은 파일), 큰 파일은 이어 올리기(resumable) */
  async createFile(name: string, parentId: string, mimeType: string, data: string | Blob, appProps?: Record<string, string>): Promise<RemoteFile> {
    const meta = { name, mimeType, parents: [parentId], appProperties: appProps };
    const blob = typeof data === 'string' ? new Blob([data], { type: mimeType }) : data;
    if (blob.size > RESUMABLE_OVER) return this.resumable('POST', `${UPLOAD}/files`, meta, blob, mimeType);
    const boundary = `mynotes${Math.random().toString(36).slice(2)}`;
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
      blob,
      `\r\n--${boundary}--`,
    ]);
    return this.json<RemoteFile>(`${UPLOAD}/files?${this.q({ uploadType: 'multipart', fields: FILE_FIELDS })}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
  }

  async updateContent(id: string, data: string | Blob, mimeType: string): Promise<RemoteFile> {
    const blob = typeof data === 'string' ? new Blob([data], { type: mimeType }) : data;
    if (blob.size > RESUMABLE_OVER) return this.resumable('PATCH', `${UPLOAD}/files/${id}`, {}, blob, mimeType);
    return this.json<RemoteFile>(`${UPLOAD}/files/${id}?${this.q({ uploadType: 'media', fields: FILE_FIELDS })}`, {
      method: 'PATCH',
      headers: { 'Content-Type': mimeType },
      body: blob,
    });
  }

  private async resumable(method: 'POST' | 'PATCH', url: string, meta: object, blob: Blob, mimeType: string): Promise<RemoteFile> {
    const start = await this.req(`${url}?${this.q({ uploadType: 'resumable', fields: FILE_FIELDS })}`, {
      method,
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mimeType, 'X-Upload-Content-Length': String(blob.size) },
      body: JSON.stringify(meta),
    });
    const location = start.headers.get('Location');
    if (!location) throw new DriveError(0, '업로드 주소를 받지 못했습니다.');
    const res = await this.req(location, { method: 'PUT', headers: { 'Content-Type': mimeType }, body: blob });
    return res.json();
  }

  async updateMeta(id: string, patch: MetaPatch): Promise<RemoteFile> {
    const body: Record<string, unknown> = {};
    if (patch.name !== undefined) body.name = patch.name;
    if (patch.trashed !== undefined) body.trashed = patch.trashed;
    return this.json<RemoteFile>(
      `${API}/files/${id}?${this.q({ fields: FILE_FIELDS, addParents: patch.addParents, removeParents: patch.removeParents })}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    );
  }

  async getMeta(id: string): Promise<RemoteFile | null> {
    try {
      return await this.json<RemoteFile>(`${API}/files/${id}?${this.q({ fields: FILE_FIELDS })}`);
    } catch (e) {
      if (e instanceof DriveError && e.status === 404) return null;
      throw e;
    }
  }

  /** 배치 요청으로 여러 파일 메타데이터 조회(최대 100개씩) */
  async getMetas(ids: string[]): Promise<(RemoteFile | null)[]> {
    const out: (RemoteFile | null)[] = [];
    for (let i = 0; i < ids.length; i += 100) out.push(...(await this.batchGet(ids.slice(i, i + 100))));
    return out;
  }

  private async batchGet(ids: string[]): Promise<(RemoteFile | null)[]> {
    if (ids.length === 1) return [await this.getMeta(ids[0])];
    const boundary = `batch${Math.random().toString(36).slice(2)}`;
    const parts = ids.map(
      (id, i) =>
        `--${boundary}\r\nContent-Type: application/http\r\nContent-ID: <item${i}>\r\n\r\nGET /drive/v3/files/${id}?fields=${encodeURIComponent(FILE_FIELDS)}\r\n\r\n`,
    );
    const res = await this.req(BATCH, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/mixed; boundary=${boundary}` },
      body: parts.join('') + `--${boundary}--`,
    });
    const parsed = parseBatch(await res.text(), res.headers.get('Content-Type') ?? '');
    const result: (RemoteFile | null)[] = new Array(ids.length).fill(undefined);
    const retry: number[] = [];
    for (const p of parsed) {
      const i = Number(/item(\d+)/.exec(p.contentId)?.[1]);
      if (Number.isNaN(i)) continue;
      if (p.status === 200) result[i] = p.body as RemoteFile;
      else if (p.status === 404) result[i] = null;
      else if (p.status === 401) {
        this.onUnauthorized();
        throw new AuthError();
      } else retry.push(i); // 속도 제한 등 → 하나씩 다시
    }
    for (let i = 0; i < ids.length; i++) if (result[i] === undefined && !retry.includes(i)) retry.push(i);
    for (const i of retry) result[i] = await this.getMeta(ids[i]);
    return result;
  }

  async download(id: string): Promise<Blob> {
    return (await this.req(`${API}/files/${id}?alt=media`)).blob();
  }

  async remove(id: string): Promise<void> {
    try {
      await this.req(`${API}/files/${id}`, { method: 'DELETE' });
    } catch (e) {
      if (e instanceof DriveError && e.status === 404) return;
      throw e;
    }
  }

  async listAll(onPage?: (count: number) => void): Promise<RemoteFile[]> {
    const out: RemoteFile[] = [];
    let pageToken: string | undefined;
    do {
      const r = await this.json<{ files: RemoteFile[]; nextPageToken?: string }>(
        `${API}/files?${this.q({ fields: `nextPageToken,files(${FILE_FIELDS})`, pageSize: 1000, spaces: 'drive', pageToken })}`,
      );
      out.push(...(r.files ?? []));
      onPage?.(out.length);
      pageToken = r.nextPageToken;
    } while (pageToken);
    return out;
  }

  async getStartPageToken(): Promise<string> {
    return (await this.json<{ startPageToken: string }>(`${API}/changes/startPageToken`)).startPageToken;
  }

  async listChanges(pageToken: string): Promise<{ changes: RemoteChange[]; nextPageToken?: string; newStartPageToken?: string }> {
    return this.json(
      `${API}/changes?${this.q({
        pageToken,
        pageSize: 1000,
        spaces: 'drive',
        includeRemoved: true,
        fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FILE_FIELDS}))`,
      })}`,
    );
  }

  async listRevisions(id: string): Promise<RemoteRevision[]> {
    const out: RemoteRevision[] = [];
    let pageToken: string | undefined;
    do {
      const r = await this.json<{ revisions: RemoteRevision[]; nextPageToken?: string }>(
        `${API}/files/${id}/revisions?${this.q({ fields: 'nextPageToken,revisions(id,modifiedTime,size)', pageSize: 200, pageToken })}`,
      );
      out.push(...(r.revisions ?? []));
      pageToken = r.nextPageToken;
    } while (pageToken);
    return out;
  }

  async downloadRevision(id: string, revId: string): Promise<Blob> {
    return (await this.req(`${API}/files/${id}/revisions/${revId}?alt=media`)).blob();
  }
}

/** 배치 응답(multipart/mixed) 해석 */
export function parseBatch(text: string, contentType: string): { contentId: string; status: number; body: unknown }[] {
  const boundary = /boundary=("?)([^";]+)\1/i.exec(contentType)?.[2];
  if (!boundary) return [];
  return text
    .split(`--${boundary}`)
    .map((part) => part.trim())
    .filter((part) => part && part !== '--')
    .map((part) => {
      const contentId = /Content-ID:\s*<?([^>\r\n]+)>?/i.exec(part)?.[1] ?? '';
      const status = Number(/HTTP\/[\d.]+\s+(\d{3})/.exec(part)?.[1] ?? 0);
      const jsonStart = part.indexOf('{');
      let body: unknown = null;
      if (jsonStart >= 0) {
        try {
          body = JSON.parse(part.slice(jsonStart, part.lastIndexOf('}') + 1));
        } catch {
          body = null;
        }
      }
      return { contentId, status, body };
    });
}
