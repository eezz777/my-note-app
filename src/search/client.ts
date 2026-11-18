// 화면 쪽 검색 창구. 워커를 쓰고, 워커를 만들 수 없으면 메인 스레드에서 같은 엔진을 돌린다.
import type { SearchResult } from '../core/search';
import type { NotesDb } from '../store/db';
import { SearchEngine, type DocMeta } from './engine';

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  ms: number;
}

export class SearchClient {
  private worker: Worker | null = null;
  private local: SearchEngine | null = null;
  private seq = 0;
  private waiting = new Map<number, (r: SearchResponse) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: DocMeta[] | null = null;

  constructor(db: NotesDb) {
    try {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'search' });
      this.worker.onmessage = (e) => {
        const { id, ...r } = e.data;
        this.waiting.get(id)?.(r as SearchResponse);
        this.waiting.delete(id);
      };
      this.worker.postMessage({ type: 'init', dbName: db.name });
    } catch {
      this.local = new SearchEngine(async (ids) => (await db.contents.bulkGet(ids)).map((c) => c?.text));
    }
  }

  /** 노트 목록이 바뀔 때마다 호출(잠깐 모았다가 한 번에 보냄) */
  setMeta(metas: DocMeta[]) {
    this.pending = metas;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 250);
  }

  /** 모아 둔 목록 갱신을 바로 보냄 */
  private flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const metas = this.pending;
    this.pending = null;
    if (!metas) return;
    if (this.worker) this.worker.postMessage({ type: 'meta', metas });
    else void this.local!.sync(metas);
  }

  search(q: string, limit = 200): Promise<SearchResponse> {
    this.flush(); // 검색 직전에는 최신 목록을 먼저 반영
    if (!this.worker) return this.local!.search(q, limit);
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.worker!.postMessage({ type: 'query', id, q, limit });
    });
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer);
    this.worker?.terminate();
  }
}
