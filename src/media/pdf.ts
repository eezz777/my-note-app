// PDF 뷰어(pdf.js). 노트 안에 임베드되어 페이지 이동, 확대/축소를 지원한다.
// pdf.js와 워커는 번들에 포함하고 처음 쓸 때만 불러온다.
import type { PDFDocumentProxy } from 'pdfjs-dist';

type PdfJs = typeof import('pdfjs-dist');
let pdfjsPromise: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(
    ([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    },
  );
  return pdfjsPromise;
}

const ASSETS = `${import.meta.env.BASE_URL}pdfjs/`;

export interface PdfSource {
  /** 캐시 키(첨부 id + 수정 시각) */
  key: string;
  load: () => Promise<ArrayBuffer>;
}

// 같은 PDF를 여러 번 열 때 다시 파싱하지 않도록 문서 캐시
const docs = new Map<string, Promise<PDFDocumentProxy>>();

async function openDoc(src: PdfSource): Promise<PDFDocumentProxy> {
  let p = docs.get(src.key);
  if (!p) {
    p = (async () => {
      const lib = await loadPdfJs();
      const data = new Uint8Array(await src.load());
      return lib.getDocument({
        data,
        cMapUrl: `${ASSETS}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${ASSETS}standard_fonts/`,
        wasmUrl: `${ASSETS}wasm/`,
        iccUrl: `${ASSETS}iccs/`,
      }).promise;
    })();
    docs.set(src.key, p);
    p.catch(() => docs.delete(src.key));
    if (docs.size > 8) {
      // 오래된 문서는 캐시에서 빼고 메모리 정리를 요청
      const [oldKey, old] = docs.entries().next().value!;
      docs.delete(oldKey);
      void old.then((d) => d.cleanup()).catch(() => {});
    }
  }
  return p;
}

const icon = (d: string) =>
  `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;

/** container 안에 PDF 뷰어를 만든다. 반환값은 정리 함수. */
export function mountPdfViewer(
  container: HTMLElement,
  src: PdfSource,
  opts: { name: string; page?: number; onOpen?: () => void },
): () => void {
  container.classList.add('pdf-viewer');
  container.innerHTML = [
    '<div class="pdf-bar">',
    '<span class="pdf-name"></span>',
    `<span class="pdf-group"><button class="pdf-btn" data-a="prev" aria-label="이전 페이지">${icon('M15 6l-6 6 6 6')}</button>`,
    '<span class="pdf-page"><input class="pdf-pageinput" inputmode="numeric" aria-label="페이지"> / <span class="pdf-total">-</span></span>',
    `<button class="pdf-btn" data-a="next" aria-label="다음 페이지">${icon('M9 6l6 6-6 6')}</button></span>`,
    `<span class="pdf-group"><button class="pdf-btn" data-a="out" aria-label="축소">${icon('M5 12h14')}</button>`,
    '<span class="pdf-zoom">100%</span>',
    `<button class="pdf-btn" data-a="in" aria-label="확대">${icon('M12 5v14M5 12h14')}</button>`,
    `<button class="pdf-btn" data-a="open" aria-label="열기/내려받기">${icon('M14 4h6v6M20 4l-9 9M18 14v5H5V6h5')}</button></span>`,
    '</div>',
    '<div class="pdf-stage"><canvas></canvas><div class="pdf-msg">불러오는 중…</div></div>',
  ].join('');
  const $ = <T extends HTMLElement>(sel: string) => container.querySelector(sel) as T;
  $('.pdf-name').textContent = opts.name;
  $('.pdf-name').title = opts.name;
  const canvas = $<HTMLCanvasElement>('canvas');
  const stage = $('.pdf-stage');
  const msg = $('.pdf-msg');
  const pageInput = $<HTMLInputElement>('.pdf-pageinput');
  const totalEl = $('.pdf-total');
  const zoomEl = $('.pdf-zoom');

  let doc: PDFDocumentProxy | null = null;
  let page = opts.page ?? 1;
  let zoom = 1; // 1 = 너비 맞춤
  let disposed = false;
  let renderTask: { cancel(): void; promise: Promise<unknown> } | null = null;

  async function render() {
    if (!doc || disposed) return;
    page = Math.min(Math.max(1, page), doc.numPages);
    pageInput.value = String(page);
    zoomEl.textContent = `${Math.round(zoom * 100)}%`;
    const p = await doc.getPage(page);
    const base = p.getViewport({ scale: 1 });
    // 기준 폭은 뷰어 바깥 폭(확대된 캔버스에 영향받지 않게), 비정상 값 방지
    const width = Math.min(1600, Math.max(200, container.clientWidth || 600));
    const scale = (width / base.width) * zoom;
    const viewport = p.getViewport({ scale });
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    renderTask?.cancel();
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    // 화면보다 좁을 때만 가운데 정렬(넓으면 왼쪽부터 보여야 스크롤로 전부 볼 수 있음)
    canvas.style.margin = viewport.width <= stage.clientWidth ? '0 auto' : '0';
    const task = p.render({ canvas, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
    renderTask = task;
    try {
      await task.promise;
    } catch {
      /* 다른 페이지로 넘어가며 취소됨 */
    }
  }

  container.addEventListener('mousedown', (e) => {
    // 편집기가 클릭을 가져가 원문으로 바뀌지 않도록
    if ((e.target as HTMLElement).closest('.pdf-bar, .pdf-stage')) e.stopPropagation();
  });
  container.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const a = btn.dataset.a;
    if (a === 'prev') page--;
    else if (a === 'next') page++;
    else if (a === 'in') zoom = Math.min(4, +(zoom + 0.25).toFixed(2));
    else if (a === 'out') zoom = Math.max(0.5, +(zoom - 0.25).toFixed(2));
    else if (a === 'open') return opts.onOpen?.();
    void render();
  });
  pageInput.addEventListener('change', () => {
    page = Number(pageInput.value) || 1;
    void render();
  });
  pageInput.addEventListener('keydown', (e) => e.stopPropagation());

  // 화면 폭이 바뀌면 다시 그리기
  let lastW = 0;
  const ro = new ResizeObserver(() => {
    const w = container.clientWidth;
    if (doc && Math.abs(w - lastW) > 8) {
      lastW = w;
      void render();
    }
  });
  ro.observe(container);

  openDoc(src)
    .then((d) => {
      if (disposed) return;
      doc = d;
      totalEl.textContent = String(d.numPages);
      msg.remove();
      lastW = container.clientWidth;
      return render();
    })
    .catch((e) => {
      msg.textContent = `PDF를 열 수 없습니다: ${e instanceof Error ? e.message : e}`;
      msg.classList.add('error');
    });

  return () => {
    disposed = true;
    ro.disconnect();
    renderTask?.cancel();
  };
}
