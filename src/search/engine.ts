// 검색 엔진: 노트 본문을 메모리에 들고 있다가 바뀐 노트만 다시 읽는다(증분 갱신).
// 워커 안에서 돌지만, 워커를 쓸 수 없는 환경에서는 메인 스레드에서도 그대로 쓸 수 있다.
import { prepare, searchDocs, type PreparedDoc, type SearchResult } from '../core/search';

export interface DocMeta {
  id: string;
  title: string;
  path: string;
  tags: string[];
  updatedAt: number;
}

export class SearchEngine {
  private docs = new Map<string, PreparedDoc>();
  private syncing: Promise<void> = Promise.resolve();

  constructor(private loadBodies: (ids: string[]) => Promise<(string | undefined)[]>) {}

  get size() {
    return this.docs.size;
  }

  /** 현재 노트 목록을 받아 새로 생기거나 바뀐 노트만 본문을 다시 읽고, 없어진 노트는 뺀다 */
  sync(metas: DocMeta[]): Promise<void> {
    this.syncing = this.syncing.then(() => this.doSync(metas)).catch((e) => console.error('검색 색인 오류', e));
    return this.syncing;
  }

  private async doSync(metas: DocMeta[]) {
    const keep = new Set<string>();
    const load: DocMeta[] = [];
    for (const m of metas) {
      keep.add(m.id);
      const cur = this.docs.get(m.id);
      if (!cur || cur.updatedAt !== m.updatedAt) load.push(m);
      else if (cur.title !== m.title || cur.path !== m.path || cur.tags.join('\n') !== m.tags.join('\n')) {
        // 이름·폴더만 바뀐 경우 본문은 다시 읽지 않음
        this.docs.set(m.id, prepare({ ...m, body: cur.body }));
      }
    }
    for (const id of [...this.docs.keys()]) if (!keep.has(id)) this.docs.delete(id);
    const BATCH = 300;
    for (let i = 0; i < load.length; i += BATCH) {
      const chunk = load.slice(i, i + BATCH);
      const bodies = await this.loadBodies(chunk.map((m) => m.id));
      chunk.forEach((m, j) => this.docs.set(m.id, prepare({ ...m, body: bodies[j] ?? '' })));
    }
  }

  async search(q: string, limit = 200): Promise<{ results: SearchResult[]; total: number; ms: number }> {
    await this.syncing;
    const t = performance.now();
    const r = searchDocs(this.docs.values(), q, limit);
    return { ...r, ms: Math.round(performance.now() - t) };
  }
}
