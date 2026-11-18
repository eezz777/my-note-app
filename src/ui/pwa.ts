// 서비스 워커(오프라인·앱 설치) 등록. 첫 화면에서부터 등록해야 처음 방문해도 "앱 설치"가 뜬다.
// 알림(새 버전, 오프라인 준비)은 노트 화면이 열린 뒤 보여 준다.

interface PwaListener {
  onNeedRefresh: () => void;
  onOfflineReady: () => void;
}

let listener: PwaListener | null = null;
const pending = { refresh: false, offline: false };
let update: ((reload?: boolean) => Promise<void>) | null = null;

/** 앱 시작 때 한 번(배포본에서만) */
export function initPwa(): void {
  if (!import.meta.env.PROD) return;
  void import('virtual:pwa-register').then(({ registerSW }) => {
    update = registerSW({
      onNeedRefresh() {
        pending.refresh = true;
        listener?.onNeedRefresh();
      },
      onOfflineReady() {
        pending.offline = true;
        if (listener) {
          pending.offline = false;
          listener.onOfflineReady();
        }
      },
    });
  });
}

/** 노트 화면에서 알림 받기(그 전에 일어난 일도 바로 알려 줌) */
export function listenPwa(l: PwaListener): () => void {
  listener = l;
  if (pending.refresh) l.onNeedRefresh();
  if (pending.offline) {
    pending.offline = false;
    l.onOfflineReady();
  }
  return () => {
    if (listener === l) listener = null;
  };
}

/** 새 버전 적용(새로고침) */
export function applyUpdate(): void {
  void update?.(true);
}
