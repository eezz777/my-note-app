// 터치로 좌우 밀기(스와이프) 동작. 세로 스크롤은 그대로 두고 가로로 충분히 밀었을 때만 반응한다.
import type { Action } from 'svelte/action';

export interface SwipeOptions {
  enabled: () => boolean;
  /** 왼쪽으로 밀었을 때(예: 휴지통) */
  onLeft?: () => void;
  /** 오른쪽으로 밀었을 때(예: 즐겨찾기) */
  onRight?: () => void;
  /** 미는 중 방향 표시(배경 색/아이콘 바꾸기용) */
  onDrag?: (dir: 'left' | 'right' | null, ratio: number) => void;
}

const DECIDE = 12; // 이만큼 움직이면 가로/세로 판정
const TRIGGER = 0.32; // 너비의 이 비율 이상 밀면 실행

export const swipeable: Action<HTMLElement, SwipeOptions> = (el, opts) => {
  let o = opts;
  let id: number | null = null;
  let x0 = 0;
  let y0 = 0;
  let state: 'idle' | 'wait' | 'swipe' = 'idle';
  let dx = 0;
  let suppressClick = false;

  const reset = (animate = true) => {
    el.style.transition = animate ? 'transform 0.2s ease' : '';
    el.style.transform = '';
    o.onDrag?.(null, 0);
    state = 'idle';
    id = null;
  };

  const down = (e: PointerEvent) => {
    if (e.pointerType !== 'touch' || !o.enabled() || state !== 'idle') return;
    id = e.pointerId;
    x0 = e.clientX;
    y0 = e.clientY;
    dx = 0;
    state = 'wait';
  };

  const move = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    const ddx = e.clientX - x0;
    const ddy = e.clientY - y0;
    if (state === 'wait') {
      if (Math.abs(ddy) > DECIDE && Math.abs(ddy) > Math.abs(ddx)) return reset(false); // 세로 스크롤
      if (Math.abs(ddx) > DECIDE && Math.abs(ddx) > Math.abs(ddy) * 1.5) {
        // 해당 방향 동작이 없으면 무시
        if ((ddx < 0 && !o.onLeft) || (ddx > 0 && !o.onRight)) return reset(false);
        state = 'swipe';
        el.setPointerCapture(e.pointerId);
        el.style.transition = '';
      } else return;
    }
    dx = ddx;
    const w = el.offsetWidth || 300;
    // 끝까지 밀수록 저항감
    const shown = Math.sign(dx) * Math.min(Math.abs(dx), w * 0.6 + (Math.abs(dx) - w * 0.6) * 0.2 * Number(Math.abs(dx) > w * 0.6));
    el.style.transform = `translateX(${shown}px)`;
    o.onDrag?.(dx < 0 ? 'left' : 'right', Math.min(1, Math.abs(dx) / (w * TRIGGER)));
  };

  const up = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    if (state !== 'swipe') return reset(false);
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 400);
    const w = el.offsetWidth || 300;
    if (Math.abs(dx) >= w * TRIGGER) {
      const fn = dx < 0 ? o.onLeft : o.onRight;
      if (dx < 0) {
        // 휴지통: 밖으로 밀어낸 뒤 실행
        el.style.transition = 'transform 0.18s ease';
        el.style.transform = `translateX(${-w}px)`;
        setTimeout(() => {
          fn?.();
          reset(false);
        }, 170);
      } else {
        fn?.();
        reset();
      }
    } else reset();
  };

  const click = (e: MouseEvent) => {
    if (suppressClick) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', () => reset());
  el.addEventListener('click', click, true);
  el.style.touchAction = 'pan-y';

  return {
    update(n) {
      o = n;
    },
    destroy() {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('click', click, true);
    },
  };
};
