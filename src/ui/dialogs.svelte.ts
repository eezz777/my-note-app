// 약속(Promise) 기반 대화상자/메뉴. 화면 어디서든 await로 사용자 응답을 받는다.

export interface MenuItem {
  label: string;
  icon?: string;
  danger?: boolean;
  disabled?: boolean;
  run: () => void;
}

export type DialogReq =
  | {
      kind: 'prompt';
      title: string;
      value: string;
      placeholder?: string;
      okLabel?: string;
      validate?: (v: string) => string | null;
      resolve: (v: string | null) => void;
    }
  | {
      kind: 'confirm';
      title: string;
      message: string;
      okLabel?: string;
      cancelLabel?: string;
      danger?: boolean;
      resolve: (ok: boolean) => void;
    }
  | {
      kind: 'folder';
      title: string;
      /** 고를 수 없는 폴더(이동 중인 폴더 자신과 하위) */
      exclude?: string;
      current?: string | null;
      resolve: (v: { id: string | null } | null) => void;
    }
  | {
      kind: 'menu';
      title?: string;
      items: MenuItem[];
      /** 데스크톱: 마우스 위치에 표시. 없으면 하단 시트로 표시 */
      at?: { x: number; y: number };
      resolve: () => void;
    }
  | { kind: 'settings'; resolve: () => void };

/** 대화상자는 쌓일 수 있다(예: 폴더 선택 중 "새 폴더" 입력창) */
class Dialogs {
  stack = $state<DialogReq[]>([]);
  private seq = 0;

  prompt(title: string, value = '', opts: { placeholder?: string; okLabel?: string; validate?: (v: string) => string | null } = {}) {
    return this.push<string | null>((resolve) => ({ kind: 'prompt', title, value, ...opts, resolve }));
  }

  confirm(title: string, message: string, opts: { okLabel?: string; cancelLabel?: string; danger?: boolean } = {}) {
    return this.push<boolean>((resolve) => ({ kind: 'confirm', title, message, ...opts, resolve }));
  }

  pickFolder(title: string, opts: { exclude?: string; current?: string | null } = {}) {
    return this.push<{ id: string | null } | null>((resolve) => ({ kind: 'folder', title, ...opts, resolve }));
  }

  menu(items: MenuItem[], at?: { x: number; y: number }, title?: string) {
    return this.push<void>((resolve) => ({ kind: 'menu', items, at, title, resolve }));
  }

  settings() {
    return this.push<void>((resolve) => ({ kind: 'settings', resolve }));
  }

  /** 응답하면 해당 대화상자만 닫는다 */
  private push<T>(make: (resolve: (v: T) => void) => DialogReq): Promise<T> {
    return new Promise<T>((resolve) => {
      const key = ++this.seq;
      const req = make((v: T) => {
        this.stack = this.stack.filter((r) => (r as { key?: number }).key !== key);
        resolve(v);
      });
      (req as { key?: number }).key = key;
      this.stack = [...this.stack, req];
    });
  }
}

export const dialogs = new Dialogs();
