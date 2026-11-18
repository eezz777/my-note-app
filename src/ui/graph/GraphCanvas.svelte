<script lang="ts">
  // 그래프 그리기(캔버스). 끌어서 이동, 휠·두 손가락으로 확대, 점 끌기, 점 누르기 = 노트 열기.
  import { onMount } from 'svelte';
  import Icon from '../Icon.svelte';
  import { ALPHA_MIN, createLayout, layoutBounds, nodeAt, nodeRadius, stepLayout, type Graph, type Layout } from '../../core/graph';

  let {
    graph,
    current = null,
    labelsAlways = false,
    onopen,
    ontag,
  }: {
    graph: Graph;
    /** 강조할 노트(지금 열린 노트) */
    current?: string | null;
    /** 확대와 관계없이 이름을 항상 표시(작은 그래프용) */
    labelsAlways?: boolean;
    onopen: (noteId: string) => void;
    ontag?: (tag: string) => void;
  } = $props();

  let wrap: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;

  // 현재 그래프와 배치
  let G: Graph = { nodes: [], edges: [] };
  let L: Layout | null = null;
  let adj: Set<number>[] = [];
  let signature = '';
  const prevPos = new Map<string, { x: number; y: number }>();

  // 화면 변환: 화면 = 세계 × scale + (ox, oy)
  let scale = 1;
  let ox = 0;
  let oy = 0;
  let w = 0;
  let h = 0;
  let dpr = 1;
  /** 사용자가 직접 옮기거나 확대하기 전까지는 자동으로 화면에 맞춘다 */
  let autoFit = $state(true);

  let hover = -1;
  let raf = 0;
  let colors = { text: '#333', text2: '#666', text3: '#999', border: '#ddd', accent: '#2e9e6b', surface: '#fff' };

  /** 구조(점·선)가 같으면 배치를 다시 하지 않고 이름만 바꾼다(타자 칠 때마다 흔들리지 않게) */
  function setGraph(g: Graph) {
    const sig = g.nodes.map((n) => n.id).join('\n') + '|' + g.edges.map((e) => `${e.source}-${e.target}`).join(',');
    if (L && sig === signature) {
      G = g;
      requestDraw();
      return;
    }
    signature = sig;
    if (L) G.nodes.forEach((n, i) => prevPos.set(n.id, { x: L!.x[i], y: L!.y[i] }));
    G = g;
    L = createLayout(g, prevPos);
    adj = g.nodes.map(() => new Set<number>());
    for (const e of g.edges) {
      adj[e.source].add(e.target);
      adj[e.target].add(e.source);
    }
    hover = -1;
    // 처음 몇 걸음은 그리기 전에 미리 계산(점이 크게 날아다니는 모습을 줄인다)
    const t0 = performance.now();
    while (L.alpha > 0.25 && performance.now() - t0 < 60) stepLayout(L, g);
    if (autoFit) fit();
    run();
  }

  $effect(() => {
    const g = graph;
    if (ctx) setGraph(g);
  });
  $effect(() => {
    void current;
    void labelsAlways;
    requestDraw();
  });

  function readColors() {
    const s = getComputedStyle(wrap);
    const v = (name: string, fb: string) => s.getPropertyValue(name).trim() || fb;
    colors = {
      text: v('--text', colors.text),
      text2: v('--text-2', colors.text2),
      text3: v('--text-3', colors.text3),
      border: v('--border', colors.border),
      accent: v('--accent', colors.accent),
      surface: v('--surface', colors.surface),
    };
  }

  function fit() {
    if (!L || !w || !h) return;
    const b = layoutBounds(L);
    const pad = 48;
    const bw = Math.max(b.maxX - b.minX, 1);
    const bh = Math.max(b.maxY - b.minY, 1);
    scale = Math.max(0.05, Math.min((w - pad * 2) / bw, (h - pad * 2) / bh, 1.6));
    ox = w / 2 - ((b.minX + b.maxX) / 2) * scale;
    oy = h / 2 - ((b.minY + b.maxY) / 2) * scale;
  }

  function requestDraw() {
    if (!raf && ctx) raf = requestAnimationFrame(frame);
  }
  /** 배치가 멈출 때까지 움직인다 */
  function run() {
    requestDraw();
  }

  function frame() {
    raf = 0;
    let moving = false;
    if (L && L.alpha > ALPHA_MIN) {
      stepLayout(L, G);
      moving = true;
      if (autoFit && !drag) fit();
    }
    draw();
    if (moving || drag) raf = requestAnimationFrame(frame);
  }

  const sx = (i: number) => L!.x[i] * scale + ox;
  const sy = (i: number) => L!.y[i] * scale + oy;
  const short = (s: string) => (s.length > 22 ? s.slice(0, 21) + '…' : s);

  function draw() {
    if (!ctx || !L) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const n = G.nodes.length;
    const curIdx = current ? G.nodes.findIndex((nd) => nd.id === current) : -1;
    // 마우스를 올린 점(없으면 현재 노트)과 이웃을 강조
    const focus = hover >= 0 ? hover : -1;
    const near = focus >= 0 ? adj[focus] : null;
    const dim = (i: number) => focus >= 0 && i !== focus && !near!.has(i);
    const rScale = Math.max(0.6, Math.min(1.6, Math.sqrt(scale)));

    // 선
    ctx.lineWidth = Math.max(0.6, Math.min(1.6, scale));
    for (const e of G.edges) {
      const hot = focus >= 0 && (e.source === focus || e.target === focus);
      const cur = focus < 0 && curIdx >= 0 && (e.source === curIdx || e.target === curIdx);
      ctx.globalAlpha = focus >= 0 && !hot ? 0.15 : hot || cur ? 0.9 : 0.55;
      ctx.strokeStyle = hot || cur ? colors.accent : colors.text3;
      if (e.kind === 'tag') ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(sx(e.source), sy(e.source));
      ctx.lineTo(sx(e.target), sy(e.target));
      ctx.stroke();
      if (e.kind === 'tag') ctx.setLineDash([]);
    }

    // 점
    for (let i = 0; i < n; i++) {
      const nd = G.nodes[i];
      const r = nodeRadius(nd) * rScale;
      const x = sx(i);
      const y = sy(i);
      if (x < -r - 200 || x > w + r + 200 || y < -r - 40 || y > h + r + 40) continue;
      ctx.globalAlpha = dim(i) ? 0.2 : 1;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      if (nd.kind === 'missing') {
        ctx.fillStyle = colors.surface;
        ctx.fill();
        ctx.setLineDash([2, 2]);
        ctx.strokeStyle = colors.text3;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = i === curIdx || i === focus ? colors.accent : nd.kind === 'tag' ? colors.text2 : colors.text3;
        ctx.fill();
        if (nd.kind === 'tag') {
          ctx.strokeStyle = colors.surface;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
      if (i === curIdx) {
        ctx.beginPath();
        ctx.arc(x, y, r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.45;
        ctx.stroke();
      }
    }

    // 이름: 확대했거나, 강조된 점, 연결이 많은 점
    ctx.font = `12px ${getComputedStyle(document.body).fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i < n; i++) {
      const nd = G.nodes[i];
      const show =
        labelsAlways || n <= 50 || scale > 1.1 || i === focus || i === curIdx || (near?.has(i) ?? false) || (scale > 0.55 && nd.degree >= 4);
      if (!show) continue;
      const x = sx(i);
      const y = sy(i) + nodeRadius(nd) * rScale + 4;
      if (x < -150 || x > w + 150 || y < -20 || y > h + 20) continue;
      const label = short(nd.label);
      ctx.globalAlpha = dim(i) ? 0.25 : 1;
      // 글자 뒤에 바탕색 테두리를 둘러 선 위에서도 읽히게
      ctx.lineWidth = 3;
      ctx.strokeStyle = colors.surface;
      ctx.strokeText(label, x, y);
      ctx.fillStyle = i === focus || i === curIdx ? colors.text : colors.text2;
      ctx.fillText(label, x, y);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- 조작 ----------
  const pointers = new Map<number, { x: number; y: number }>();
  let drag: { node: number; startX: number; startY: number; moved: boolean; t: number } | null = null;
  let pan: { startX: number; startY: number; moved: boolean; t: number } | null = null;
  let pinch: { dist: number; mx: number; my: number } | null = null;

  function local(e: PointerEvent | WheelEvent) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function hit(px: number, py: number, touch: boolean): number {
    if (!L) return -1;
    const slop = touch ? 16 : 6;
    return nodeAt(L, (px - ox) / scale, (py - oy) / scale, (14 + slop) / scale);
  }

  function zoomAt(px: number, py: number, factor: number) {
    const ns = Math.max(0.05, Math.min(6, scale * factor));
    const f = ns / scale;
    ox = px - (px - ox) * f;
    oy = py - (py - oy) * f;
    scale = ns;
    autoFit = false;
  }

  function onDown(e: PointerEvent) {
    canvas.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 2) {
      // 두 손가락: 끌기를 멈추고 확대 모드
      if (drag && L) L.pinned[drag.node] = 0;
      drag = null;
      pan = null;
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }
    const i = hit(p.x, p.y, e.pointerType !== 'mouse');
    if (i >= 0 && L) {
      drag = { node: i, startX: p.x, startY: p.y, moved: false, t: performance.now() };
      hover = i;
    } else {
      pan = { startX: p.x, startY: p.y, moved: false, t: performance.now() };
    }
  }

  function onMove(e: PointerEvent) {
    const p = local(e);
    const prev = pointers.get(e.pointerId);
    if (prev) pointers.set(e.pointerId, p);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      ox += mx - pinch.mx;
      oy += my - pinch.my;
      zoomAt(mx, my, dist / (pinch.dist || 1));
      pinch = { dist, mx, my };
      requestDraw();
      return;
    }
    if (drag && L && prev) {
      if (!drag.moved && Math.hypot(p.x - drag.startX, p.y - drag.startY) < 5) return;
      drag.moved = true;
      L.pinned[drag.node] = 1;
      L.x[drag.node] = (p.x - ox) / scale;
      L.y[drag.node] = (p.y - oy) / scale;
      L.alpha = Math.max(L.alpha, 0.25);
      requestDraw();
      return;
    }
    if (pan && prev) {
      if (!pan.moved && Math.hypot(p.x - pan.startX, p.y - pan.startY) < 4) return;
      pan.moved = true;
      ox += p.x - prev.x;
      oy += p.y - prev.y;
      autoFit = false;
      requestDraw();
      return;
    }
    // 마우스만: 올린 점 강조
    if (e.pointerType === 'mouse') {
      const i = hit(p.x, p.y, false);
      if (i !== hover) {
        hover = i;
        canvas.style.cursor = i >= 0 ? 'pointer' : 'grab';
        requestDraw();
      }
    }
  }

  function onUp(e: PointerEvent) {
    pointers.delete(e.pointerId);
    if (pinch) {
      if (pointers.size < 2) pinch = null;
      return;
    }
    if (drag && L) {
      const nd = G.nodes[drag.node];
      L.pinned[drag.node] = 0;
      if (!drag.moved && e.type === 'pointerup') {
        // 누르기 = 열기
        if (nd.kind === 'note') onopen(nd.id);
        else if (nd.kind === 'tag') ontag?.(nd.label.slice(1));
      }
      if (e.pointerType !== 'mouse') hover = -1;
      drag = null;
      requestDraw();
    }
    pan = null;
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const p = local(e);
    zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    requestDraw();
  }

  function onLeave() {
    if (hover >= 0 && !drag) {
      hover = -1;
      requestDraw();
    }
  }

  function zoomBy(f: number) {
    zoomAt(w / 2, h / 2, f);
    requestDraw();
  }
  function refit() {
    autoFit = true;
    fit();
    requestDraw();
  }

  onMount(() => {
    ctx = canvas.getContext('2d');
    readColors();
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      w = r.width;
      h = r.height;
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      if (autoFit) fit();
      requestDraw();
    });
    ro.observe(wrap);
    // 테마·포인트 색이 바뀌면 다시 그린다
    const mo = new MutationObserver(() => {
      readColors();
      requestDraw();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
    canvas.addEventListener('wheel', onWheel, { passive: false });
    setGraph(graph);
    return () => {
      ro.disconnect();
      mo.disconnect();
      canvas.removeEventListener('wheel', onWheel);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      ctx = null;
    };
  });
</script>

<div class="graph" bind:this={wrap}>
  <canvas
    bind:this={canvas}
    aria-label="노트 관계 그래프"
    onpointerdown={onDown}
    onpointermove={onMove}
    onpointerup={onUp}
    onpointercancel={onUp}
    onpointerleave={onLeave}
  ></canvas>
  <div class="zoom">
    <button class="icon-btn" aria-label="확대" title="확대" onclick={() => zoomBy(1.3)}><Icon name="plus" size={18} /></button>
    <button class="icon-btn" aria-label="축소" title="축소" onclick={() => zoomBy(1 / 1.3)}><Icon name="minus" size={18} /></button>
    <button class="icon-btn" class:on={autoFit} aria-label="화면에 맞추기" title="화면에 맞추기" onclick={refit}><Icon name="fit" size={18} /></button>
  </div>
</div>

<style>
  .graph {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  canvas {
    display: block;
    touch-action: none;
    cursor: grab;
  }
  .zoom {
    position: absolute;
    right: 10px;
    bottom: calc(10px + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: var(--surface);
    border-radius: 12px;
    box-shadow: var(--shadow-1);
    padding: 2px;
  }
  .zoom .on {
    color: var(--accent-strong);
  }
</style>
