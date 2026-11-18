// 노트 관계 그래프: 노트(점)와 [[링크]](선)로 그래프를 만들고, 힘 기반 배치로 위치를 계산한다.
// 화면과 무관한 순수 로직이라 테스트로 검증한다.
import { resolveName, type NameIndex } from './links';
import { tagKey } from './tags';

export type GraphNodeKind = 'note' | 'tag' | 'missing';

export interface GraphNode {
  /** 노트: 노트 id, 태그: "tag:<키>", 없는 노트: "missing:<이름 키>" */
  id: string;
  kind: GraphNodeKind;
  label: string;
  /** 연결된 선 수 */
  degree: number;
}

export interface GraphEdge {
  /** nodes 배열의 위치 */
  source: number;
  target: number;
  kind: 'link' | 'tag';
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphNoteInput {
  id: string;
  name: string;
  folderId: string | null;
  tags?: string[];
  /** 가리키는 노트 링크 이름(소문자) */
  links?: string[];
}

export interface GraphOptions {
  /** 태그도 점으로 표시 */
  tags?: boolean;
  /** 아직 없는 노트(링크만 있는 이름)도 점으로 표시 */
  missing?: boolean;
}

/** 노트 목록으로 그래프를 만든다. 같은 두 노트 사이 선은 방향과 관계없이 하나만 둔다. */
export function buildGraph(notes: GraphNoteInput[], index: NameIndex, opts: GraphOptions = {}): Graph {
  const nodes: GraphNode[] = [];
  const pos = new Map<string, number>();
  const add = (id: string, kind: GraphNodeKind, label: string): number => {
    let i = pos.get(id);
    if (i === undefined) {
      i = nodes.length;
      nodes.push({ id, kind, label, degree: 0 });
      pos.set(id, i);
    }
    return i;
  };
  for (const n of notes) add(n.id, 'note', n.name);

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const connect = (a: number, b: number, kind: GraphEdge['kind']) => {
    if (a === b) return;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ source: a, target: b, kind });
    nodes[a].degree++;
    nodes[b].degree++;
  };

  for (const n of notes) {
    const from = pos.get(n.id)!;
    for (const link of n.links ?? []) {
      const ref = resolveName(link, n.folderId, index);
      const to = ref ? pos.get(ref.id) : undefined;
      if (to !== undefined) connect(from, to, 'link');
      else if (!ref && opts.missing) {
        const base = link.split('/').pop()!.trim();
        if (base) connect(from, add(`missing:${link}`, 'missing', base), 'link');
      }
    }
    if (opts.tags) {
      for (const t of n.tags ?? []) connect(from, add(`tag:${tagKey(t)}`, 'tag', `#${t}`), 'tag');
    }
  }
  return { nodes, edges };
}

/** 한 노트에서 depth 단계 안에 연결된 부분 그래프(가운데 노트가 0번) */
export function neighborhood(g: Graph, centerId: string, depth: number): Graph {
  const start = g.nodes.findIndex((n) => n.id === centerId);
  if (start < 0) return { nodes: [], edges: [] };
  const adj: number[][] = g.nodes.map(() => []);
  for (const e of g.edges) {
    adj[e.source].push(e.target);
    adj[e.target].push(e.source);
  }
  const dist = new Map<number, number>([[start, 0]]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    const d = dist.get(cur)!;
    if (d >= depth) continue;
    for (const nb of adj[cur]) {
      if (dist.has(nb)) continue;
      dist.set(nb, d + 1);
      // 태그 점은 거쳐 가지 않는다(같은 태그를 단 노트 전체가 딸려 오지 않게)
      if (g.nodes[nb].kind === 'note') queue.push(nb);
    }
  }
  const keep = [...dist.keys()];
  const remap = new Map(keep.map((old, i) => [old, i]));
  const nodes = keep.map((i) => ({ ...g.nodes[i], degree: 0 }));
  const edges: GraphEdge[] = [];
  for (const e of g.edges) {
    const a = remap.get(e.source);
    const b = remap.get(e.target);
    if (a === undefined || b === undefined) continue;
    edges.push({ source: a, target: b, kind: e.kind });
    nodes[a].degree++;
    nodes[b].degree++;
  }
  return { nodes, edges };
}

// ---------- 힘 기반 배치 ----------

export interface Layout {
  x: Float64Array;
  y: Float64Array;
  vx: Float64Array;
  vy: Float64Array;
  /** 손으로 붙잡은 점(움직이지 않음) */
  pinned: Uint8Array;
  /** 움직임 세기(1 → 0으로 줄어들며 멈춘다) */
  alpha: number;
}

const LINK_LENGTH = 90;
const REPULSE = 2400;
const CUTOFF = 360;
const GRAVITY = 0.02;
const DAMPING = 0.6;
const ALPHA_DECAY = 0.985;
export const ALPHA_MIN = 0.004;

/**
 * 시작 위치. 예전 위치가 있으면 이어 쓰고, 없으면 해바라기 씨 배열(겹치지 않고 고르게)에 둔다.
 * 같은 입력이면 늘 같은 결과(테스트 가능).
 */
export function createLayout(g: Graph, prev?: Map<string, { x: number; y: number }>): Layout {
  const n = g.nodes.length;
  const L: Layout = {
    x: new Float64Array(n),
    y: new Float64Array(n),
    vx: new Float64Array(n),
    vy: new Float64Array(n),
    pinned: new Uint8Array(n),
    alpha: 1,
  };
  const golden = Math.PI * (3 - Math.sqrt(5));
  let reused = 0;
  for (let i = 0; i < n; i++) {
    const p = prev?.get(g.nodes[i].id);
    if (p) {
      L.x[i] = p.x;
      L.y[i] = p.y;
      reused++;
    } else {
      const r = 18 * Math.sqrt(i + 0.5);
      L.x[i] = r * Math.cos(i * golden);
      L.y[i] = r * Math.sin(i * golden);
    }
  }
  // 대부분 그대로면 살짝만 움직인다
  if (n && reused / n > 0.8) L.alpha = 0.3;
  return L;
}

/** 한 걸음 계산. 반발력은 가까운 칸만 살펴 많은 점에서도 빠르다. */
export function stepLayout(L: Layout, g: Graph): void {
  const n = g.nodes.length;
  if (!n) return;
  const a = L.alpha;
  const { x, y, vx, vy } = L;

  // 1) 반발력: 격자 칸에 나눠 담고 주변 9칸만 비교
  const cell = CUTOFF;
  const grid = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const k = `${Math.floor(x[i] / cell)},${Math.floor(y[i] / cell)}`;
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  }
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(x[i] / cell);
    const cy = Math.floor(y[i] / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = grid.get(`${cx + dx},${cy + dy}`);
        if (!list) continue;
        for (const j of list) {
          if (j <= i) continue;
          let ddx = x[i] - x[j];
          let ddy = y[i] - y[j];
          let d2 = ddx * ddx + ddy * ddy;
          if (d2 > CUTOFF * CUTOFF) continue;
          if (d2 < 1) {
            // 같은 자리: 정해진 방향으로 살짝 떼어 놓는다
            ddx = ((i * 7 + j * 13) % 11) - 5 || 1;
            ddy = ((i * 11 + j * 7) % 13) - 6 || 1;
            d2 = ddx * ddx + ddy * ddy;
          }
          const f = (REPULSE * a) / d2;
          const fx = ddx * f;
          const fy = ddy * f;
          vx[i] += fx;
          vy[i] += fy;
          vx[j] -= fx;
          vy[j] -= fy;
        }
      }
    }
  }

  // 2) 선은 용수철: 정해진 길이로 당기거나 민다(연결이 많은 점은 덜 끌려간다)
  for (const e of g.edges) {
    const s = e.source;
    const t = e.target;
    const ddx = x[t] - x[s];
    const ddy = y[t] - y[s];
    const d = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
    const k = ((d - LINK_LENGTH) / d) * a * 0.5;
    const ds = g.nodes[s].degree || 1;
    const dt = g.nodes[t].degree || 1;
    const ws = dt / (ds + dt);
    vx[s] += ddx * k * ws;
    vy[s] += ddy * k * ws;
    vx[t] -= ddx * k * (1 - ws);
    vy[t] -= ddy * k * (1 - ws);
  }

  // 3) 가운데로 약하게 끌어당김(떨어진 무리가 멀리 가지 않게)
  for (let i = 0; i < n; i++) {
    vx[i] -= x[i] * GRAVITY * a;
    vy[i] -= y[i] * GRAVITY * a;
  }

  // 4) 이동
  for (let i = 0; i < n; i++) {
    if (L.pinned[i]) {
      vx[i] = vy[i] = 0;
      continue;
    }
    vx[i] *= DAMPING;
    vy[i] *= DAMPING;
    // 한 번에 너무 멀리 튀지 않게
    const sp = Math.hypot(vx[i], vy[i]);
    if (sp > 40) {
      vx[i] *= 40 / sp;
      vy[i] *= 40 / sp;
    }
    x[i] += vx[i];
    y[i] += vy[i];
  }
  L.alpha *= ALPHA_DECAY;
}

/** 배치가 멈출 때까지(또는 최대 steps) 돌린다 */
export function settleLayout(L: Layout, g: Graph, steps = 400): void {
  for (let i = 0; i < steps && L.alpha > ALPHA_MIN; i++) stepLayout(L, g);
}

/** 모든 점을 담는 사각형 */
export function layoutBounds(L: Layout): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < L.x.length; i++) {
    minX = Math.min(minX, L.x[i]);
    maxX = Math.max(maxX, L.x[i]);
    minY = Math.min(minY, L.y[i]);
    maxY = Math.max(maxY, L.y[i]);
  }
  if (!L.x.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/** 화면 좌표에서 가장 가까운 점(반경 안) */
export function nodeAt(L: Layout, px: number, py: number, radius: number): number {
  let best = -1;
  let bestD = radius * radius;
  for (let i = 0; i < L.x.length; i++) {
    const d = (L.x[i] - px) ** 2 + (L.y[i] - py) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** 점 크기: 연결이 많을수록 조금씩 커진다 */
export function nodeRadius(node: GraphNode): number {
  const base = node.kind === 'note' ? 5 : 4;
  return base + Math.min(10, Math.sqrt(node.degree) * 1.8);
}
