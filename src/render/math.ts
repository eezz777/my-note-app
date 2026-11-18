// KaTeX 수식 렌더링. 처음 쓸 때만 불러온다(지연 로딩).
type Katex = typeof import('katex').default;
let katexPromise: Promise<Katex> | null = null;

function loadKatex(): Promise<Katex> {
  katexPromise ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => m.default);
  return katexPromise;
}

const cache = new Map<string, string>();

export async function renderMath(tex: string, display: boolean): Promise<string> {
  const key = (display ? 'D' : 'I') + tex;
  const hit = cache.get(key);
  if (hit) return hit;
  const katex = await loadKatex();
  let html: string;
  try {
    html = katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'htmlAndMathml' });
  } catch (e) {
    html = `<span class="math-error" title="${String(e).replace(/"/g, '&quot;')}">${tex.replace(/</g, '&lt;')}</span>`;
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, html);
  return html;
}
