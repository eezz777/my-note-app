<script lang="ts">
  // 이전 버전 보기/복원: 드라이브의 버전 기록(리비전)을 이용한다.
  import Icon from '../Icon.svelte';
  import { useApp } from '../context';
  import { diffLines } from '../../core/diff';
  import { formatDateTime } from '../format';
  import type { RemoteRevision } from '../../drive/types';

  const app = useApp();
  const note = $derived(app.versionsFor ? app.noteById.get(app.versionsFor) : null);
  let revs = $state<RemoteRevision[]>([]);
  let loading = $state(true);
  let error = $state('');
  let selected = $state<string | null>(null);
  let revText = $state<string | null>(null);
  let current = $state('');
  let showDiff = $state(true);

  $effect(() => {
    const n = note;
    if (!n) return;
    loading = true;
    error = '';
    selected = null;
    revText = null;
    void (async () => {
      try {
        current = await app.repo.getContent(n.id);
        if (!n.driveId || !app.sync) throw new Error('아직 드라이브에 올라가지 않은 노트입니다.');
        revs = (await app.sync.drive.listRevisions(n.driveId)).reverse(); // 최신이 위로
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      } finally {
        loading = false;
      }
    })();
  });

  async function pick(r: RemoteRevision) {
    selected = r.id;
    revText = null;
    try {
      revText = await (await app.sync!.drive.downloadRevision(note!.driveId!, r.id)).text();
    } catch (e) {
      revText = `(불러오지 못했습니다: ${e instanceof Error ? e.message : e})`;
    }
  }

  async function restore() {
    if (!note || revText === null) return;
    const t = revText;
    const r = revs.find((x) => x.id === selected);
    const ok = await app.run(() => app.repo.saveContent(note.id, t));
    if (ok !== undefined) {
      app.toast(`${r ? formatDateTime(Date.parse(r.modifiedTime)) : '선택한'} 버전으로 되돌렸습니다. (지금 내용도 버전 기록에 남아 있습니다)`);
      app.versionsFor = null;
    }
  }

  const close = () => (app.versionsFor = null);
</script>

{#if note}
  <div class="scrim" role="presentation" onclick={close}></div>
  <div class="ver" role="dialog" aria-label="이전 버전">
    <header>
      <h2>이전 버전 · {note.name}</h2>
      <button class="icon-btn" aria-label="닫기" onclick={close}><Icon name="close" /></button>
    </header>
    <div class="cols">
      <div class="list">
        {#if loading}
          <p class="muted">불러오는 중…</p>
        {:else if error}
          <p class="err">{error}</p>
        {:else}
          {#each revs as r, i (r.id)}
            <button class="rev" class:on={selected === r.id} onclick={() => pick(r)}>
              <span>{formatDateTime(Date.parse(r.modifiedTime))}</span>
              {#if i === 0}<span class="cur">현재</span>{/if}
            </button>
          {:else}
            <p class="muted">버전 기록이 없습니다.</p>
          {/each}
          <p class="hint">드라이브는 버전을 보통 30일(최대 100개)까지 보관합니다.</p>
        {/if}
      </div>
      <div class="view">
        {#if revText === null}
          <p class="muted">{selected ? '불러오는 중…' : '왼쪽에서 버전을 고르세요.'}</p>
        {:else}
          <label class="sw"><input type="checkbox" bind:checked={showDiff} /> 지금 내용과 비교</label>
          {#if showDiff}
            <div class="diff">
              {#each diffLines(revText, current) as l, i (i)}
                <div class="dl {l.kind}"><span class="sign">{l.kind === 'del' ? '−' : l.kind === 'add' ? '+' : ' '}</span>{l.text || ' '}</div>
              {/each}
            </div>
            <p class="legend">− 이 버전에만 있음 · + 지금 내용에만 있음</p>
          {:else}
            <pre class="full">{revText}</pre>
          {/if}
        {/if}
      </div>
    </div>
    <footer>
      <button class="btn" onclick={close}>닫기</button>
      <button class="btn primary" disabled={revText === null} onclick={restore}>이 버전으로 복원</button>
    </footer>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 57;
    background: rgba(10, 15, 12, 0.4);
  }
  .ver {
    position: fixed;
    z-index: 58;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(900px, calc(100vw - 16px));
    height: min(86dvh, 720px);
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-radius: 20px;
    box-shadow: var(--shadow-2);
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    padding: 10px 10px 8px 20px;
    border-bottom: 1px solid var(--border);
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: 17px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cols {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .list {
    width: 230px;
    flex: none;
    overflow-y: auto;
    border-right: 1px solid var(--border);
    padding: 8px;
  }
  .rev {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    min-height: 42px;
    padding: 0 10px;
    border-radius: 10px;
    font-size: 13px;
    text-align: left;
  }
  .rev:hover {
    background: var(--hover);
  }
  .rev.on {
    background: var(--accent-soft);
    color: var(--accent-strong);
    font-weight: 600;
  }
  .cur {
    font-size: 11px;
    color: var(--text-3);
  }
  .view {
    flex: 1;
    min-width: 0;
    overflow: auto;
    padding: 10px 14px;
  }
  .sw {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    margin-bottom: 8px;
  }
  .diff,
  .full {
    font-family: var(--mono);
    font-size: 13px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
  }
  .dl {
    padding: 0 6px;
    border-radius: 4px;
  }
  .dl.del {
    background: color-mix(in srgb, var(--danger) 16%, transparent);
  }
  .dl.add {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }
  .sign {
    display: inline-block;
    width: 1.4em;
    color: var(--text-3);
  }
  .legend,
  .hint {
    font-size: 12px;
    color: var(--text-3);
  }
  .err {
    color: var(--danger);
    font-size: 13px;
  }
  .muted {
    font-size: 13px;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    padding: 10px 14px calc(12px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--border);
  }
  @media (max-width: 719px) {
    .cols {
      flex-direction: column;
    }
    .list {
      width: auto;
      max-height: 34%;
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }
  }
</style>
