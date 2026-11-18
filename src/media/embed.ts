// ![[파일]] 임베드를 실제 화면 요소로 만든다. 편집기(라이브 프리뷰)와 읽기 모드가 함께 쓴다.
import { kindOf, parseEmbedSize, parsePdfPage, formatBytes } from '../core/attachments';
import { parseWikiTarget } from '../editor/markdown-ext';
import type { EditorHost } from '../editor/host';
import { mountPdfViewer } from './pdf';
import { findSection } from '../core/links';
import { renderMarkdown } from '../render/markdown';
import { hydrate } from '../render/hydrate';

const fileIcon =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20zM14 3.5V8h4"/></svg>';

function missing(el: HTMLElement, name: string) {
  el.className = 'embed-missing';
  el.textContent = `첨부파일을 찾을 수 없음: ${name}`;
}

const MAX_DEPTH = 3;

/** ![[노트]] / ![[노트#제목]] / ![[노트#^블록]]: 해당 부분을 렌더링해 끼워 넣는다 */
function mountNoteEmbed(el: HTMLElement, name: string, sub: string | null, host: EditorHost): () => void {
  el.className = 'embed-note';
  // 임베드 안의 임베드는 3단계까지만(서로를 임베드하는 무한 반복 방지)
  let depth = 0;
  for (let p = el.parentElement; p; p = p.parentElement) if (p.classList.contains('embed-note')) depth++;
  const head = document.createElement('div');
  head.className = 'embed-note-head';
  head.textContent = name + (sub ? ` › ${sub.replace(/^\^/, '¶ ')}` : '');
  head.title = '눌러서 열기';
  head.addEventListener('mousedown', (e) => e.stopPropagation());
  head.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    host.openWikiLink(sub ? `${name}#${sub}` : name);
  });
  const body = document.createElement('div');
  body.className = 'embed-note-body md-body';
  body.textContent = '불러오는 중…';
  el.append(head, body);
  let cleanup = () => {};
  let alive = true;
  void host.getNoteText(name).then((target) => {
    if (!alive) return;
    if (!target) {
      body.textContent = '노트를 찾을 수 없습니다.';
      el.classList.add('missing');
      return;
    }
    if (depth >= MAX_DEPTH || (target.id === host.currentNoteId() && !sub)) {
      body.textContent = '여기서는 더 깊이 임베드할 수 없습니다.';
      return;
    }
    const sec = findSection(target.text, sub);
    if (!sec) {
      body.textContent = `"${sub}" 부분을 찾을 수 없습니다.`;
      return;
    }
    body.innerHTML = renderMarkdown(sec.text);
    cleanup = hydrate(body, host);
  });
  // 임베드 안 링크·태그 클릭
  body.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).closest('a')) e.stopPropagation();
  });
  body.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>('a');
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    if (a.dataset.tag) host.openTag(a.dataset.tag);
    else if (a.dataset.wikilink) host.openWikiLink(a.dataset.wikilink);
    else if (a.getAttribute('href') && !a.getAttribute('href')!.startsWith('#')) host.openUrl(a.getAttribute('href')!);
  });
  return () => {
    alive = false;
    cleanup();
  };
}

/**
 * el 안에 임베드를 그린다. 정리 함수(PDF 뷰어 해제 등)를 돌려준다.
 * raw: "사진.png|300", "문서.pdf#page=3"
 */
export function mountEmbed(el: HTMLElement, raw: string, host: EditorHost): () => void {
  const { name, sub, alias } = parseWikiTarget(raw);
  const kind = kindOf(name);
  el.innerHTML = '';
  el.dataset.embedKind = kind;

  if (kind === 'note') return mountNoteEmbed(el, name, sub, host);

  const att = host.findAttachment(name);
  if (!att) {
    missing(el, name);
    return () => {};
  }

  if (kind === 'image') {
    el.className = 'embed-image';
    const img = document.createElement('img');
    img.alt = name;
    // 로컬 blob이라 지연 로딩이 이득이 없고, 편집기는 이미 보이는 부분만 그린다
    img.decoding = 'async';
    const size = parseEmbedSize(alias);
    if (size?.width) img.style.width = `${size.width}px`;
    if (size?.height) img.style.height = `${size.height}px`;
    if (att.width && att.height && !size?.height) img.style.aspectRatio = `${att.width} / ${att.height}`;
    el.append(img);
    void host.getAttachmentUrl(name).then((url) => {
      if (url) img.src = url;
      else missing(el, name);
    });
    return () => {};
  }

  if (kind === 'audio' || kind === 'video') {
    el.className = `embed-${kind}`;
    const media = document.createElement(kind);
    media.controls = true;
    media.preload = 'metadata';
    el.append(media);
    void host.getAttachmentUrl(name).then((url) => url && (media.src = url));
    return () => media.pause();
  }

  if (kind === 'pdf') {
    el.className = 'embed-pdf';
    return mountPdfViewer(
      el,
      { key: `${att.id}:${att.updatedAt}`, load: async () => (await host.getAttachmentData(name))! },
      { name: att.name, page: parsePdfPage(sub), onOpen: () => host.openAttachment(name) },
    );
  }

  // 그 밖의 파일: 파일 카드(누르면 내려받기/열기)
  el.className = 'embed-file';
  el.innerHTML = `${fileIcon.trim()}<span class="ef-name"></span><span class="ef-size"></span>`;
  el.querySelector('.ef-name')!.textContent = att.name;
  el.querySelector('.ef-size')!.textContent = formatBytes(att.size);
  el.title = '눌러서 열기/내려받기';
  el.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    host.openAttachment(name);
  });
  return () => {};
}
