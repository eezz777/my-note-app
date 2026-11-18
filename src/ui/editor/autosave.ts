// 자동 저장: 입력이 멈추고 1초 뒤 로컬(IndexedDB)에 저장한다.
// 실패하면 내용을 버리지 않고 점점 간격을 늘려 재시도한다.

export type SaveState = 'saved' | 'pending' | 'saving' | 'error';

export class AutoSaver {
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** 노트별 아직 저장되지 않은 최신 내용 (노트를 빠르게 바꿔도 섞이거나 사라지지 않게) */
  private pending = new Map<string, string>();
  private chain: Promise<void> = Promise.resolve();
  private retryDelay = 1000;

  constructor(
    private save: (id: string, text: string) => Promise<unknown>,
    private onState: (s: SaveState, err?: unknown) => void,
    private delay = 1000,
  ) {}

  /** 입력할 때마다 호출. 마지막 입력 후 delay 뒤 저장 */
  schedule(id: string, text: string) {
    this.pending.set(id, text);
    this.onState('pending');
    this.clearTimer();
    this.timer = setTimeout(() => void this.flush(), this.delay);
  }

  /** 대기 중인 내용을 즉시 저장. 저장 작업은 한 줄로 세워 순서를 보장한다. */
  flush(): Promise<void> {
    this.clearTimer();
    this.chain = this.chain.then(() => this.drain());
    return this.chain;
  }

  private async drain(): Promise<void> {
    if (!this.pending.size) return;
    const jobs = [...this.pending];
    this.pending.clear();
    this.onState('saving');
    for (const [id, text] of jobs) {
      try {
        await this.save(id, text);
      } catch (err) {
        // 그 사이 새 입력이 없을 때만 실패한 내용을 다시 대기열에 넣는다
        if (!this.pending.has(id)) this.pending.set(id, text);
        this.onState('error', err);
        this.timer = setTimeout(() => void this.flush(), this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, 30000);
        return;
      }
    }
    this.retryDelay = 1000;
    this.onState(this.pending.size ? 'pending' : 'saved');
  }

  hasPending(): boolean {
    return this.pending.size > 0;
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
