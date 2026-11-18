import { describe, expect, it } from 'vitest';
import { buildNameIndex } from '../src/core/links';
import { buildGraph, createLayout, layoutBounds, neighborhood, nodeAt, settleLayout, type GraphNoteInput } from '../src/core/graph';

function make(notes: (Omit<GraphNoteInput, 'folderId'> & { folderId?: string | null; path?: string })[]) {
  const list = notes.map((n) => ({ ...n, folderId: n.folderId ?? null }));
  const index = buildNameIndex(list.map((n) => ({ id: n.id, name: n.name, folderId: n.folderId, path: n.path ?? '' })));
  return { list, index };
}

describe('그래프 만들기', () => {
  const { list, index } = make([
    { id: 'a', name: '가', links: ['나', '다', '없는노트'], tags: ['업무'] },
    { id: 'b', name: '나', links: ['가'], tags: ['업무', '개인'] },
    { id: 'c', name: '다', links: ['다'] },
    { id: 'd', name: '외톨이' },
  ]);

  it('링크는 노트 사이 선이 되고, 양방향 링크도 선 하나다', () => {
    const g = buildGraph(list, index);
    expect(g.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(g.edges).toHaveLength(2); // 가-나, 가-다 (다→다 자기 링크는 제외)
    expect(g.nodes[0].degree).toBe(2);
    expect(g.nodes[3].degree).toBe(0); // 연결 없는 노트도 점으로 표시
  });

  it('없는 노트와 태그는 켰을 때만 점이 된다', () => {
    const g = buildGraph(list, index, { missing: true, tags: true });
    const missing = g.nodes.filter((n) => n.kind === 'missing');
    const tags = g.nodes.filter((n) => n.kind === 'tag');
    expect(missing.map((n) => n.label)).toEqual(['없는노트']);
    expect(tags.map((n) => n.label).sort()).toEqual(['#개인', '#업무']);
    expect(tags.find((n) => n.label === '#업무')!.degree).toBe(2);
  });

  it('같은 이름은 링크한 노트와 같은 폴더의 노트로 잇는다', () => {
    const { list: l2, index: i2 } = make([
      { id: 'x1', name: '회의', folderId: 'f1', path: '업무' },
      { id: 'x2', name: '회의', folderId: 'f2', path: '개인' },
      { id: 'y', name: '메모', folderId: 'f2', path: '개인', links: ['회의'] },
      { id: 'z', name: '정리', links: ['업무/회의'] },
    ]);
    const g = buildGraph(l2, i2);
    const ids = g.edges.map((e) => [g.nodes[e.source].id, g.nodes[e.target].id].sort().join('-'));
    expect(ids.sort()).toEqual(['x1-z', 'x2-y']);
  });
});

describe('현재 노트 주변', () => {
  const { list, index } = make([
    { id: 'a', name: 'A', links: ['B'], tags: ['공통'] },
    { id: 'b', name: 'B', links: ['C'] },
    { id: 'c', name: 'C', links: ['D'] },
    { id: 'd', name: 'D' },
    { id: 'e', name: 'E', tags: ['공통'] },
  ]);

  it('단계 수만큼만 가져오고 가운데 노트가 첫 번째다', () => {
    const g = buildGraph(list, index);
    expect(neighborhood(g, 'b', 1).nodes.map((n) => n.id)).toEqual(['b', 'a', 'c']);
    expect(neighborhood(g, 'a', 2).nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    expect(neighborhood(g, 'a', 2).edges).toHaveLength(2);
    expect(neighborhood(g, '없음', 1).nodes).toEqual([]);
  });

  it('태그 점은 보여 주되 태그를 거쳐 다른 노트로 퍼지지 않는다', () => {
    const g = buildGraph(list, index, { tags: true });
    const ids = neighborhood(g, 'a', 2).nodes.map((n) => n.id);
    expect(ids).toContain('tag:공통');
    expect(ids).not.toContain('e');
  });
});

describe('배치', () => {
  it('연결된 점은 가깝고, 점끼리 겹치지 않으며, 값이 깨지지 않는다', () => {
    const notes: GraphNoteInput[] = [];
    // 두 무리(각 8개, 무리 안에서 고리로 연결) + 외톨이 4개
    for (const grp of ['p', 'q']) {
      for (let i = 0; i < 8; i++) notes.push({ id: `${grp}${i}`, name: `${grp}${i}`, folderId: null, links: [`${grp}${(i + 1) % 8}`] });
    }
    for (let i = 0; i < 4; i++) notes.push({ id: `s${i}`, name: `s${i}`, folderId: null });
    const index = buildNameIndex(notes.map((n) => ({ id: n.id, name: n.name, folderId: null, path: '' })));
    const g = buildGraph(notes, index);
    const L = createLayout(g);
    settleLayout(L, g, 600);

    for (let i = 0; i < g.nodes.length; i++) {
      expect(Number.isFinite(L.x[i]) && Number.isFinite(L.y[i])).toBe(true);
    }
    const dist = (i: number, j: number) => Math.hypot(L.x[i] - L.x[j], L.y[i] - L.y[j]);
    const linked = g.edges.map((e) => dist(e.source, e.target));
    const avgLinked = linked.reduce((s, d) => s + d, 0) / linked.length;
    let sum = 0;
    let cnt = 0;
    let minD = Infinity;
    for (let i = 0; i < g.nodes.length; i++) {
      for (let j = i + 1; j < g.nodes.length; j++) {
        sum += dist(i, j);
        cnt++;
        minD = Math.min(minD, dist(i, j));
      }
    }
    expect(avgLinked).toBeLessThan(sum / cnt);
    expect(minD).toBeGreaterThan(8);
    const b = layoutBounds(L);
    expect(b.maxX - b.minX).toBeLessThan(3000);
  });

  it('같은 입력이면 같은 배치, 예전 위치는 이어 쓴다', () => {
    const notes = [
      { id: 'a', name: 'a', folderId: null, links: ['b'] },
      { id: 'b', name: 'b', folderId: null },
    ];
    const index = buildNameIndex(notes.map((n) => ({ ...n, path: '' })));
    const g = buildGraph(notes, index);
    const L1 = createLayout(g);
    const L2 = createLayout(g);
    settleLayout(L1, g, 50);
    settleLayout(L2, g, 50);
    expect([...L1.x]).toEqual([...L2.x]);
    const prev = new Map([['a', { x: 500, y: -200 }]]);
    const L3 = createLayout(g, prev);
    expect(L3.x[0]).toBe(500);
    expect(nodeAt(L3, 503, -198, 10)).toBe(0);
    expect(nodeAt(L3, 0, 0, 2)).toBe(-1);
  });

  it('붙잡은 점은 움직이지 않는다', () => {
    const notes = [
      { id: 'a', name: 'a', folderId: null, links: ['b'] },
      { id: 'b', name: 'b', folderId: null },
    ];
    const index = buildNameIndex(notes.map((n) => ({ ...n, path: '' })));
    const g = buildGraph(notes, index);
    const L = createLayout(g);
    L.x[0] = 300;
    L.y[0] = 300;
    L.pinned[0] = 1;
    settleLayout(L, g, 100);
    expect(L.x[0]).toBe(300);
    expect(Math.hypot(L.x[1] - 300, L.y[1] - 300)).toBeLessThan(200);
  });
});
