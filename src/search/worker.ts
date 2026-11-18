// 검색 워커: 화면이 멈추지 않도록 검색을 별도 스레드에서 처리한다.
// 노트 본문은 같은 IndexedDB(로컬 캐시)에서 직접 읽는다.
import { NotesDb } from '../store/db';
import { SearchEngine, type DocMeta } from './engine';

type Msg =
  | { type: 'init'; dbName: string }
  | { type: 'meta'; metas: DocMeta[] }
  | { type: 'query'; id: number; q: string; limit?: number };

let db: NotesDb | null = null;
const engine = new SearchEngine(async (ids) => {
  if (!db) return ids.map(() => undefined);
  return (await db.contents.bulkGet(ids)).map((c) => c?.text);
});

self.onmessage = async (e: MessageEvent<Msg>) => {
  const m = e.data;
  if (m.type === 'init') {
    db = new NotesDb(m.dbName);
  } else if (m.type === 'meta') {
    void engine.sync(m.metas);
  } else if (m.type === 'query') {
    const r = await engine.search(m.q, m.limit);
    (self as unknown as Worker).postMessage({ type: 'result', id: m.id, ...r });
  }
};
