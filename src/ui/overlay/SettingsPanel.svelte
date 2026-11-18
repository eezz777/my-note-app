<script lang="ts">
  import Icon from '../Icon.svelte';
  import { useApp } from '../context';
  import { dialogs } from '../dialogs.svelte';
  import { exportFlow, importFlow } from '../importExport';

  let { onclose }: { onclose: () => void } = $props();
  const app = useApp();

  // 차분한 포인트 컬러 후보
  const ACCENTS = ['#2e9e6b', '#2f8f9d', '#3f7fd1', '#6b63c9', '#c0598f', '#d0743c', '#8a8f3a', '#5f6b66'];
  const THEMES = [
    { v: 'system', l: '시스템 설정' },
    { v: 'light', l: '라이트' },
    { v: 'dark', l: '다크' },
  ] as const;

  async function resetDemo() {
    const ok = await dialogs.confirm(
      '데모 데이터 초기화',
      '이 기기의 데모 노트를 모두 지우고 샘플 노트로 다시 채웁니다. 되돌릴 수 없습니다.',
      { okLabel: '초기화', danger: true },
    );
    if (ok) await app.onResetDemo?.();
  }

  async function signOut() {
    const pending = app.sync?.pending ?? 0;
    const warn = pending ? `\n\n⚠ 아직 드라이브에 올리지 못한 변경이 ${pending}개 있습니다. 이 기기의 사본을 지우면 그 변경은 사라집니다.` : '';
    const ok = await dialogs.confirm(
      '로그아웃',
      `구글 로그인을 끊습니다. 이 기기에 있는 노트 사본은 남겨 두어 다음에 로그인하면 바로 이어서 씁니다.${warn}`,
      { okLabel: '로그아웃' },
    );
    if (!ok) return;
    let wipe = false;
    if (!pending) {
      wipe = await dialogs.confirm('이 기기의 사본도 지울까요?', '공용 기기라면 지우는 것이 안전합니다. 노트는 구글드라이브에 그대로 있습니다.', {
        okLabel: '사본 지우기',
        cancelLabel: '남겨 두기',
        danger: true,
      });
    }
    await app.onSignOut?.(wipe);
  }
</script>

<div class="panel">
  <header>
    <h2>설정</h2>
    <button class="icon-btn" aria-label="닫기" onclick={onclose}><Icon name="close" /></button>
  </header>

  <div class="body">
    <section>
      <h3>화면 모드</h3>
      <div class="seg" role="radiogroup" aria-label="화면 모드">
        {#each THEMES as t}
          <button
            role="radio"
            aria-checked={app.device.theme === t.v}
            class:on={app.device.theme === t.v}
            onclick={() => app.setDevice({ theme: t.v })}>{t.l}</button
          >
        {/each}
      </div>
    </section>

    <section>
      <h3>포인트 색상 <span class="hint">(모든 기기 공통)</span></h3>
      <div class="swatches">
        {#each ACCENTS as c}
          <button
            class="sw"
            class:on={app.shared.accent === c}
            style:background={c}
            aria-label="색상 {c}"
            onclick={() => app.setShared({ accent: c })}
          >
            {#if app.shared.accent === c}<Icon name="check" size={18} />{/if}
          </button>
        {/each}
      </div>
    </section>

    <section>
      <h3>글꼴 크기 <span class="hint">{app.device.fontSize}px</span></h3>
      <input
        type="range"
        min="13"
        max="22"
        step="1"
        value={app.device.fontSize}
        oninput={(e) => app.setDevice({ fontSize: Number((e.target as HTMLInputElement).value) })}
        aria-label="글꼴 크기"
      />
    </section>

    <section>
      <h3>편집기</h3>
      <label class="switch">
        <input
          type="checkbox"
          checked={app.device.livePreview}
          onchange={(e) => app.setDevice({ livePreview: (e.target as HTMLInputElement).checked })}
        />
        <span>라이브 프리뷰 <span class="hint">(끄면 마크다운 기호를 그대로 보는 소스 모드)</span></span>
      </label>
    </section>

    <section>
      <h3>큰 이미지 넣을 때 <span class="hint">(긴 변 2560px 또는 1.5MB 초과)</span></h3>
      <div class="seg" role="radiogroup" aria-label="큰 이미지 처리">
        {#each [{ v: 'ask', l: '매번 묻기' }, { v: 'auto', l: '자동으로 줄이기' }, { v: 'original', l: '원본 유지' }] as const as o}
          <button
            role="radio"
            aria-checked={app.device.imageResize === o.v}
            class:on={app.device.imageResize === o.v}
            onclick={() => app.setDevice({ imageResize: o.v })}>{o.l}</button
          >
        {/each}
      </div>
    </section>

    <section>
      <h3>단축키 <span class="hint">(PC)</span></h3>
      <dl class="keys">
        <dt>Ctrl+P</dt><dd>빠른 열기(노트 이름, 초성)</dd>
        <dt>Ctrl+Shift+F</dt><dd>전체 검색</dd>
        <dt>Ctrl+Alt+N</dt><dd>새 노트</dd>
        <dt>Ctrl+E</dt><dd>편집 ↔ 읽기 모드</dd>
        <dt>Ctrl+F</dt><dd>노트 안에서 찾기/바꾸기</dd>
        <dt>Ctrl+B / I / K</dt><dd>굵게 / 기울임 / 링크</dd>
        <dt>Ctrl+Shift+H / X</dt><dd>형광펜 / 취소선</dd>
        <dt>Ctrl+Enter</dt><dd>체크박스 완료 전환</dd>
        <dt>Ctrl+\</dt><dd>사이드바 접기/고정</dd>
        <dt>Ctrl·Shift+클릭</dt><dd>노트 여러 개 선택</dd>
      </dl>
      <p class="desc">폰에서는 노트 카드를 <b>길게 누르면 선택</b>, <b>왼쪽으로 밀면 휴지통</b>, <b>오른쪽으로 밀면 즐겨찾기</b>입니다.</p>
    </section>

    <section>
      <h3>저장소</h3>
      {#if app.sync}
        <p class="desc">
          <b>구글드라이브</b>{#if app.sync.email} · {app.sync.email}{/if}<br />
          노트는 드라이브의 <code>MyNotes</code> 폴더에 저장되고, 이 기기에도 사본이 있어 오프라인에서 읽고 쓸 수 있습니다.
        </p>
        <div class="row-btns">
          <button class="btn" onclick={() => app.sync?.syncNow(true)}>지금 동기화</button>
          <button class="btn" onclick={signOut}>로그아웃</button>
          <button class="btn" onclick={() => app.onSwitchMode?.('demo')}>데모 모드 열기</button>
        </div>
      {:else}
        <p class="desc">
          지금은 <b>데모 모드</b>입니다. 노트는 이 기기 브라우저(IndexedDB)에만 저장됩니다.
        </p>
        <div class="row-btns">
          <button class="btn primary" onclick={() => app.onSwitchMode?.('connect')}>구글드라이브 연결</button>
          <button class="btn danger" onclick={resetDemo}>데모 데이터 초기화</button>
        </div>
      {/if}
    </section>

    <section>
      <h3>가져오기 · 백업</h3>
      <p class="desc">
        다른 곳의 노트(.md 여러 개, ZIP, 옵시디언 볼트 ZIP)를 가져오거나, 모든 노트와 첨부를 폴더 구조 그대로 ZIP으로 내려받습니다.
      </p>
      <div class="row-btns">
        <button class="btn" onclick={() => importFlow(app)}>가져오기</button>
        <button class="btn" onclick={() => exportFlow(app)}>전체 백업(ZIP)</button>
      </div>
    </section>
  </div>
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
  }
  header {
    display: flex;
    align-items: center;
    padding: 14px 10px 6px 22px;
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: 18px;
  }
  .body {
    padding: 0 22px 22px;
  }
  section {
    padding: 14px 0;
    border-bottom: 1px solid var(--border);
  }
  section:last-child {
    border-bottom: 0;
  }
  h3 {
    margin: 0 0 10px;
    font-size: 14px;
    color: var(--text-2);
  }
  .hint {
    font-weight: 400;
    color: var(--text-3);
  }
  .seg {
    display: flex;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 3px;
  }
  .seg button {
    flex: 1;
    min-height: 38px;
    border-radius: 999px;
    color: var(--text-2);
  }
  .seg button.on {
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
  }
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .sw {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: #fff;
  }
  .sw.on {
    box-shadow: 0 0 0 3px var(--surface), 0 0 0 5px currentColor;
    color: #fff;
  }
  .keys {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 14px;
    margin: 0 0 10px;
    font-size: 13px;
  }
  .keys dt {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--accent-strong);
    white-space: nowrap;
  }
  .keys dd {
    margin: 0;
    color: var(--text-2);
  }
  .switch {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    font-size: 14px;
    cursor: pointer;
  }
  .switch input {
    width: 20px;
    height: 20px;
    accent-color: var(--accent);
  }
  input[type='range'] {
    width: 100%;
    accent-color: var(--accent);
  }
  .row-btns {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .row-btns .btn:not(.primary) {
    border: 1px solid var(--border);
  }
  code {
    font-family: var(--mono);
    font-size: 0.9em;
  }
  .desc {
    margin: 0 0 10px;
    font-size: 14px;
    line-height: 1.6;
    color: var(--text-2);
  }
</style>
