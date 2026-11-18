// 링크 미리보기 동작: PC는 마우스를 올려 두면, 폰은 길게 누르면 미리보기를 띄운다.
import { linkGuard } from '../editor/host';
import { kindOf } from '../core/attachments';
import { splitTarget } from '../core/links';

const HOVER_DELAY = 450;
const LONG_PRESS = 500;

/** root 안의 [[링크]] 요소(data-wikilink)에 미리보기 동작을 붙인다. 정리 함수를 돌려준다. */
export function bindLinkPreview(
  root: HTMLElement,
  show: (raw: string, el: HTMLElement) => void,
  hide: () => void,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let startX = 0;
  let startY = 0;
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const linkOf = (t: EventTarget | null) => {
    const el = (t as HTMLElement | null)?.closest?.<HTMLElement>('[data-wikilink]');
    // 첨부파일 링크는 미리보기 대상 아님(노트만)
    if (!el || kindOf(splitTarget(el.dataset.wikilink ?? '').name) !== 'note') return null;
    return el;
  };

  const over = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    const el = linkOf(e.target);
    if (!el) return;
    clear();
    timer = setTimeout(() => show(el.dataset.wikilink!, el), HOVER_DELAY);
  };
  const out = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || !linkOf(e.target)) return;
    clear();
    hide();
  };
  const touchStart = (e: TouchEvent) => {
    const el = linkOf(e.target);
    if (!el || e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    clear();
    timer = setTimeout(() => {
      timer = null;
      linkGuard.until = Date.now() + 900; // 손을 뗄 때 링크로 이동하지 않게
      show(el.dataset.wikilink!, el);
    }, LONG_PRESS);
  };
  const touchMove = (e: TouchEvent) => {
    if (timer && (Math.abs(e.touches[0].clientX - startX) > 10 || Math.abs(e.touches[0].clientY - startY) > 10)) clear();
  };
  const click = (e: MouseEvent) => {
    if (Date.now() < linkGuard.until) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const ctxMenu = (e: Event) => {
    if (linkOf(e.target)) e.preventDefault(); // 길게 누를 때 브라우저 메뉴 대신 미리보기
  };

  root.addEventListener('pointerover', over);
  root.addEventListener('pointerout', out);
  root.addEventListener('touchstart', touchStart, { passive: true });
  root.addEventListener('touchmove', touchMove, { passive: true });
  root.addEventListener('touchend', clear);
  root.addEventListener('click', click, true);
  root.addEventListener('contextmenu', ctxMenu);
  return () => {
    clear();
    root.removeEventListener('pointerover', over);
    root.removeEventListener('pointerout', out);
    root.removeEventListener('touchstart', touchStart);
    root.removeEventListener('touchmove', touchMove);
    root.removeEventListener('touchend', clear);
    root.removeEventListener('click', click, true);
    root.removeEventListener('contextmenu', ctxMenu);
  };
}
