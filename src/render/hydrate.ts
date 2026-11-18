// 렌더링된 HTML에 비동기 처리(수식, 코드 강조, 첨부 임베드)를 입힌다.
import { renderMath } from './math';
import { highlightInto } from './highlight';
import { mountEmbed } from '../media/embed';
import type { EditorHost } from '../editor/host';

/** 정리 함수(PDF 뷰어 해제 등)를 돌려준다 */
export function hydrate(root: HTMLElement, host?: EditorHost | null): () => void {
  const cleanups: (() => void)[] = [];
  for (const el of root.querySelectorAll<HTMLElement>('.math[data-tex]')) {
    const tex = el.dataset.tex ?? '';
    void renderMath(tex, el.classList.contains('math-display')).then((html) => {
      if (el.isConnected) el.innerHTML = html;
    });
  }
  for (const code of root.querySelectorAll<HTMLElement>('pre > code[class*="language-"]')) {
    const lang = /language-([\w+#-]+)/.exec(code.className)?.[1];
    if (lang) void highlightInto(code, lang).catch(() => {});
  }
  if (host) {
    for (const el of root.querySelectorAll<HTMLElement>('[data-embed]')) {
      cleanups.push(mountEmbed(el, el.dataset.embed ?? '', host));
    }
  }
  return () => cleanups.forEach((f) => f());
}
