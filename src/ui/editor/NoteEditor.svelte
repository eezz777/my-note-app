<script lang="ts">
  // 노트 편집 화면: 제목 + CodeMirror 편집기(라이브 프리뷰/소스) 또는 읽기 모드 + 서식 툴바
  import { onDestroy, onMount, tick } from 'svelte';
  import { EditorState } from '@codemirror/state';
  import Icon from '../Icon.svelte';
  import Toolbar from './Toolbar.svelte';
  import ReadingView from './ReadingView.svelte';
  import { useApp } from '../context';
  import { dialogs } from '../dialogs.svelte';
  import { formatDateTime } from '../format';
  import { menuPos, noteMenu } from '../menus';
  import { validateName } from '../../core/names';
  import { AutoSaver } from './autosave';
  import { EditorController } from '../../editor/controller';
  import { toggleTaskAt } from '../../editor/commands';
  import { parseWikiTarget } from '../../editor/markdown-ext';
  import type { EditorHost } from '../../editor/host';
  import { kindOf } from '../../core/attachments';
  import { embedMarkup, pickFiles, saveFiles } from '../attach';
  import { EditorView } from '@codemirror/view';
  import { ensureBlockId, findHeadings, findSection } from '../../core/links';
  import NotePanel from './NotePanel.svelte';
  import { bindLinkPreview } from '../linkPreview';

  const app = useApp();
  const note = $derived(app.openNote);
  const fav = $derived(note ? app.favSet.has(note.id) : false);
  const mobile = $derived(app.layout === 'mobile');

  let text = $state('');
  let loadedId = $state<string | null>(null);
  /** 내용까지 편집기에 다 불러온 노트 */
  let readyId = $state<string | null>(null);
  let titleDraft = $state('');
  let titleError = $state<string | null>(null);
  let titleEl: HTMLTextAreaElement | undefined = $state();
  let cmHost: HTMLDivElement | undefined = $state();
  let scrollEl: HTMLDivElement | undefined = $state();
  let ctl = $state<EditorController | null>(null);
  let editorFocused = $state(false);
  let saveState = $state<'saved' | 'pending' | 'saving' | 'error'>('saved');

  /** 저장소에 있는 것으로 알고 있는 현재 노트 내용(바깥 변경 감지용) */
  let lastKnown = '';

  const saver = new AutoSaver(
    async (id, value) => {
      // 입력하는 사이 다른 곳(동기화 등)에서 이 노트 내용이 바뀌었으면 덮어쓰지 않고 내 입력을 사본으로
      if (id === loadedId) {
        const stored = await app.repo.getContent(id);
        if (stored !== lastKnown && stored !== value) {
          await saveTypingAsCopy(id, value, stored);
          return;
        }
      }
      await app.repo.saveContent(id, value);
      if (id === loadedId) lastKnown = value;
    },
    (s, err) => {
      saveState = s;
      if (s === 'error')
        app.toast(`저장 실패: ${err instanceof Error ? err.message : err}. 내용은 화면에 남아 있으니 다시 시도합니다.`, 'error');
    },
  );

  /** 입력 중 바깥 변경과 겹침: 내 입력은 "(충돌 … 이 기기)" 노트로, 편집기는 최신 내용으로 */
  async function saveTypingAsCopy(id: string, mine: string, stored: string) {
    const meta = app.noteById.get(id);
    const d = new Date();
    const p = (x: number) => String(x).padStart(2, '0');
    const label = `${meta?.name ?? '노트'} (충돌 ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}시 ${p(d.getMinutes())}분 이 기기)`;
    const copy = await app.repo.createNote(meta?.folderId ?? null, label, mine);
    lastKnown = stored;
    if (id === loadedId) {
      text = stored;
      ctl?.replaceText(stored);
    }
    app.toast(`입력하는 사이 다른 기기에서 "${meta?.name}"이(가) 바뀌었습니다. 입력한 내용은 "${copy.name}"에 따로 저장했습니다.`, 'error', {
      label: '비교',
      run: () => (app.compare = { a: id, b: copy.id }),
    }, 15000);
  }

  // 편집기가 앱에 요청하는 기능
  const host: EditorHost = {
    noteExists: (name) => !!app.findNote(name),
    openUrl: (url) => {
      const href = /^www\./i.test(url) ? `https://${url}` : url;
      if (/^(https?:|mailto:|tel:)/i.test(href)) window.open(href, '_blank', 'noopener,noreferrer');
    },
    openWikiLink: (raw) => void openWikiLink(raw),
    findAttachment: (name) => app.findAttachment(name),
    getAttachmentUrl: (name) => app.attachmentUrl(name),
    getAttachmentData: (name) => app.attachmentData(name),
    openAttachment: (name) => void app.openAttachment(name),
    attachFiles: (files, pos) => void insertFiles(files, pos),
    openTag: (tag) => {
      void saver.flush();
      app.openTag(tag);
    },
    listTags: () => app.tagList,
    listLinkTargets: () => {
      const from = note?.folderId ?? null;
      const notes = [...app.liveNotes]
        .filter((n) => n.id !== note?.id)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((n) => {
          const insert = app.linkNameFor(n.id, from);
          return { label: n.name, insert, detail: app.folderPathText(n.folderId), kind: 'note' as const, updated: n.updatedAt };
        });
      const files = app.attachments
        .filter((a) => !a.trashed)
        .map((a) => ({ label: a.name, insert: a.name, detail: '첨부', kind: 'file' as const, updated: a.updatedAt }));
      return [...notes, ...files];
    },
    getNoteText: async (name) => {
      const target = name.trim() ? app.findNote(name, note?.folderId ?? null) : note;
      if (!target) return null;
      const t = target.id === loadedId && ctl ? ctl.getText() : await app.repo.getContent(target.id);
      return { id: target.id, name: target.name, text: t };
    },
    addBlockId: async (noteId, line, id) => {
      await app.run(() => app.repo.addBlockId(noteId, line, id));
    },
    currentNoteId: () => loadedId,
    previewLink: (raw, anchor) => app.showPreview(raw, anchor, note?.folderId ?? null),
    noteVersion: (name) => {
      const n = app.findNote(name, note?.folderId ?? null);
      return n ? `${n.id}:${n.updatedAt}` : '';
    },
  };

  // ---------- 제목·문단 위치로 이동 ----------

  /** 노트 안의 #제목 / #^블록 으로 이동하고 잠깐 강조 */
  function goToSub(sub: string) {
    const sec = findSection(app.readMode ? text : (ctl?.getText() ?? text), sub);
    if (!sec) {
      app.toast(`"${sub}" 위치를 찾을 수 없습니다.`, 'error');
      return;
    }
    goToLine(sec.startLine, sub);
  }

  function goToLine(line: number, sub?: string) {
    if (app.readMode) {
      const root = scrollEl?.querySelector('.reading');
      let el: Element | null | undefined = null;
      if (sub?.startsWith('^')) el = root?.querySelector(`[data-block-id="${CSS.escape(sub.slice(1))}"]`);
      else if (sub) {
        const want = sub.split('#').pop()!.trim().toLowerCase();
        el = [...(root?.querySelectorAll('[data-heading]') ?? [])].find((h) => (h as HTMLElement).dataset.heading?.toLowerCase() === want);
      }
      if (!el) {
        // 읽기 모드에서 못 찾으면 편집 모드로 바꿔 이동
        app.readMode = false;
        void tick().then(() => goToLine(line));
        return;
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.add('flash');
      setTimeout(() => el?.classList.remove('flash'), 1700);
      return;
    }
    if (!ctl) return;
    const view = ctl.view;
    const l = view.state.doc.line(Math.min(line + 1, view.state.doc.lines));
    view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'start', yMargin: 80 }) });
    requestAnimationFrame(() => {
      const dom = view.domAtPos(l.from).node;
      const lineEl = (dom instanceof Element ? dom : dom.parentElement)?.closest('.cm-line');
      lineEl?.classList.add('cm-flash');
      setTimeout(() => lineEl?.classList.remove('cm-flash'), 1700);
    });
  }

  // 다른 노트에서 [[이 노트#제목]] 으로 왔거나 같은 노트 안 링크를 눌렀을 때
  $effect(() => {
    void app.anchorSeq;
    const a = app.pendingAnchor;
    // 내용을 다 불러온 노트(readyId)일 때만 이동(불러오는 중이면 switchTo가 처리)
    if (a && a.noteId === readyId && ctl) {
      app.pendingAnchor = null;
      void tick().then(() => (a.line !== undefined ? goToLine(a.line) : goToSub(a.sub)));
    }
  });

  // ---------- 링크 복사 ----------

  async function copyText(s: string, what: string) {
    try {
      await navigator.clipboard.writeText(s);
      app.toast(`${what}를 복사했습니다: ${s}`);
    } catch {
      await dialogs.prompt(`${what} (직접 복사하세요)`, s);
    }
  }

  function copyNoteLink() {
    if (note) void copyText(`[[${note.name}]]`, '노트 링크');
  }

  /** 커서가 있는 문단 링크 복사(문단에 ^ID가 없으면 붙인다). 제목 줄이면 제목 링크 */
  function copyBlockLink() {
    if (!note || !ctl) return;
    const view = ctl.view;
    const lineNo = view.state.doc.lineAt(view.state.selection.main.head).number - 1;
    const doc = view.state.doc.toString();
    const h = findHeadings(doc).find((x) => x.line === lineNo);
    if (h) return void copyText(`[[${note.name}#${h.text}]]`, '제목 링크');
    const r = ensureBlockId(doc, lineNo);
    if (!r) {
      app.toast('커서를 문단이나 목록 항목에 두고 다시 시도하세요.', 'error');
      return;
    }
    if (r.text !== doc) ctl.replaceText(r.text), saver.schedule(note.id, r.text), (text = r.text);
    void copyText(`[[${note.name}#^${r.id}]]`, '문단 링크');
  }

  /** 파일을 첨부로 저장하고 커서(또는 pos) 위치에 링크/임베드를 넣는다 */
  async function insertFiles(files: File[], pos?: number) {
    const id = loadedId;
    if (!id || !files.length) return;
    const metas = await saveFiles(app, files);
    if (!metas.length) return;
    const markup = metas.map(embedMarkup).join('\n');
    if (ctl && ctl.currentId === id && !app.readMode) {
      const view = ctl.view;
      const at = pos ?? view.state.selection.main.head;
      const line = view.state.doc.lineAt(at);
      // 문장 중간이면 따로 한 줄을 차지하도록 앞뒤에 줄바꿈
      const endAt = pos === undefined ? view.state.selection.main.to : at;
      const before = line.text.slice(0, at - line.from).trim() ? '\n' : '';
      const after = line.text.slice(Math.min(endAt, line.to) - line.from).trim() ? '\n' : '';
      const insert = before + markup + after;
      view.dispatch({
        changes: { from: at, to: endAt, insert },
        selection: { anchor: at + before.length + markup.length },
        scrollIntoView: true,
        userEvent: 'input.paste',
      });
      view.focus();
    } else {
      // 그 사이 다른 노트로 옮겼거나 읽기 모드면 원래 노트 끝에 붙인다
      const cur = await app.repo.getContent(id);
      await app.repo.saveContent(id, (cur.endsWith('\n') || !cur ? cur : cur + '\n') + markup);
      if (id === loadedId) {
        text = await app.repo.getContent(id);
        ctl?.replaceText(text);
      }
    }
    app.toast(metas.length === 1 ? `"${metas[0].name}"을(를) 첨부했습니다.` : `파일 ${metas.length}개를 첨부했습니다.`);
  }

  async function attach(kind: 'image' | 'pdf' | 'file') {
    let files: File[] = [];
    if (kind === 'image' && mobile) {
      const choice = await new Promise<'camera' | 'gallery' | null>((resolve) => {
        void dialogs.menu(
          [
            { label: '사진 찍기', icon: 'camera', run: () => resolve('camera') },
            { label: '갤러리·파일에서 선택', icon: 'image', run: () => resolve('gallery') },
          ],
          undefined,
          '이미지 넣기',
        ).then(() => setTimeout(() => resolve(null), 0));
      });
      if (!choice) return;
      files = await pickFiles('image/*', { capture: choice === 'camera' ? 'environment' : undefined, multiple: choice !== 'camera' });
    } else if (kind === 'image') files = await pickFiles('image/*');
    else if (kind === 'pdf') files = await pickFiles('application/pdf,.pdf');
    else files = await pickFiles('');
    await insertFiles(files);
  }

  async function openWikiLink(raw: string) {
    const { name, sub } = parseWikiTarget(raw);
    if (!name) {
      // 같은 노트 안 [[#제목]]
      if (sub) goToSub(sub);
      return;
    }
    // 첨부파일 링크([[보고서.docx]])는 열기/내려받기
    if (kindOf(name) !== 'note') {
      void app.openAttachment(name);
      return;
    }
    const target = app.findNote(name, note?.folderId ?? null);
    await saver.flush();
    app.preview = null;
    if (target) {
      app.openAt(target.id, sub);
      return;
    }
    // 없는 노트: 현재 노트와 같은 폴더에 새로 만든다
    const created = await app.run(() => app.repo.createNote(note?.folderId ?? null, name.split('/').pop()!));
    if (created) {
      app.toast(`새 노트 "${created.name}"을(를) 만들었습니다.`);
      app.open(created.id);
    }
  }

  onMount(() => {
    ctl = new EditorController(cmHost!, {
      host,
      livePreview: app.device.livePreview,
      onChange: (id, value) => {
        if (id === loadedId) text = value;
        saver.schedule(id, value);
      },
      extraKeys: [
        {
          key: 'Mod-e',
          run: () => {
            toggleRead();
            return true;
          },
        },
      ],
    });
    // 새로 열린 노트가 있으면 불러오기
    loadedId = null;
    app.editorFlush = () => saver.flush();
    app.editorHost = host;
    // [[링크]] 미리보기(마우스 올림 / 길게 누름): 편집 화면과 읽기 화면 모두
    const unbind = bindLinkPreview(
      scrollEl!,
      (raw, el) => host.previewLink(raw, el),
      () => app.hidePreviewSoon(),
    );
    if (import.meta.env.DEV) (window as unknown as { __ctl: EditorController }).__ctl = ctl;
    return unbind;
  });

  // 노트가 바뀌면: 이전 노트를 즉시 저장하고 새 노트 내용을 불러온다
  $effect(() => {
    const id = note?.id ?? null;
    if (!ctl || id === loadedId) return;
    void switchTo(id);
  });

  async function switchTo(id: string | null) {
    await saver.flush();
    loadedId = id;
    readyId = null;
    if (!id || !ctl) return;
    const content = await app.repo.getContent(id);
    if (loadedId !== id) return; // 그 사이 다른 노트로 바뀜
    text = content;
    lastKnown = content;
    ctl.load(id, content);
    readyId = id;
    saveState = 'saved';
    scrollEl?.scrollTo({ top: 0 });
    if (app.pendingTitleFocus === id) {
      app.pendingTitleFocus = null;
      app.readMode = false;
      await tick();
      titleEl?.focus();
      titleEl?.select();
    }
    const a = app.pendingAnchor;
    if (a && a.noteId === id) {
      app.pendingAnchor = null;
      await tick();
      requestAnimationFrame(() => (a.line !== undefined ? goToLine(a.line) : goToSub(a.sub)));
    }
  }

  // 다른 곳(링크·태그 자동 갱신, 나중에는 동기화)에서 현재 노트 내용이 바뀌면 편집기에 반영
  $effect(() => {
    const id = note?.id;
    void note?.updatedAt;
    if (!id || id !== loadedId || !ctl) return;
    void (async () => {
      const content = await app.repo.getContent(id);
      if (id !== loadedId || content === lastKnown) return;
      if (saver.hasPending()) return; // 입력 중인 내용이 있으면 덮어쓰지 않음(저장 시 이 내용이 최신)
      lastKnown = content;
      text = content;
      ctl?.replaceText(content);
    })();
  });

  // 라이브 프리뷰 설정 반영
  $effect(() => {
    ctl?.setLivePreview(app.device.livePreview);
  });

  // 첨부·노트 목록이 바뀌면 임베드와 링크 색을 다시 계산
  $effect(() => {
    void app.attByName;
    void app.notesByName;
    ctl?.refresh();
  });

  // 제목 입력란은 노트 이름과 동기화(입력 중이 아닐 때)
  $effect(() => {
    if (note && document.activeElement !== titleEl) {
      titleDraft = note.name;
      titleError = null;
    }
  });

  function toggleRead() {
    if (app.readMode) {
      app.readMode = false;
      ctl?.replaceText(text);
      void tick().then(() => ctl?.focus());
    } else {
      app.readMode = true;
      void saver.flush();
    }
  }

  function toggleTask(line: number) {
    if (!loadedId) return;
    const st = EditorState.create({ doc: text });
    const spec = toggleTaskAt(st, line);
    if (!spec) return;
    text = st.update(spec).state.doc.toString();
    ctl?.replaceText(text);
    saver.schedule(loadedId, text);
  }

  async function commitTitle() {
    if (!note) return;
    const value = titleDraft.replace(/\s*\n\s*/g, ' ').trim();
    if (value === note.name) {
      titleDraft = note.name;
      titleError = null;
      return;
    }
    const err = validateName(value);
    if (err) {
      app.toast(`${err} 원래 이름으로 되돌렸습니다.`, 'error');
      titleDraft = note.name;
      titleError = null;
      return;
    }
    const ok = await app.run(() => app.repo.renameNote(note.id, value).then(() => true));
    if (!ok) titleDraft = note.name;
    titleError = null;
  }

  function onTitleInput() {
    titleError = titleDraft.trim() ? validateName(titleDraft.replace(/\n/g, ' ')) : null;
  }

  function onTitleKey(e: KeyboardEvent) {
    if (e.isComposing) return; // 한글 조합 중 Enter는 무시
    if (e.key === 'Enter' || (e.key === 'ArrowDown' && !e.shiftKey)) {
      e.preventDefault();
      void commitTitle();
      (e.target as HTMLElement).blur();
      if (!app.readMode) ctl?.focus();
    } else if (e.key === 'Escape') {
      titleDraft = note?.name ?? '';
      (e.target as HTMLElement).blur();
    }
  }

  // 읽기 모드에서도 Ctrl+E로 전환
  function onWindowKey(e: KeyboardEvent) {
    if (!note || e.isComposing) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'e' && app.readMode) {
      e.preventDefault();
      toggleRead();
    }
  }

  // 앱이 백그라운드로 가거나 닫힐 때 즉시 저장
  function onHide() {
    if (document.visibilityState === 'hidden') void saver.flush();
  }
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onHide);
  onDestroy(() => {
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onHide);
    void saver.flush();
    app.editorFlush = null;
    app.editorHost = null;
    ctl?.destroy();
  });

  const folderPathText = $derived(note ? app.folderPathText(note.folderId) || '폴더 밖' : '');
  const saveLabel = $derived(
    { saved: '저장됨', pending: '입력 중…', saving: '저장 중…', error: '저장 실패 · 재시도 중' }[saveState],
  );
  const showNote = $derived(!!note && !note.trashed);

  function togglePanel() {
    if (app.layout === 'desktop') void app.setDevice({ rightPanel: !app.device.rightPanel });
    else app.panelSheet = !app.panelSheet;
  }

  /** 목차·백링크 패널에 넘길 위치 이동 */
  function panelGo(line: number) {
    if (app.layout !== 'desktop') app.panelSheet = false;
    goToLine(line);
  }
  // 모바일: 편집 중(키보드가 올라온 상태)에만 하단 툴바 표시
  const showToolbar = $derived(showNote && !app.readMode && (!mobile || editorFocused));
</script>

<svelte:window onkeydown={onWindowKey} />

<article class="editor" class:hidden={!showNote}>
  <header class="bar">
    {#if mobile}
      <button class="icon-btn" aria-label="뒤로" onclick={() => app.open(null)}><Icon name="back" /></button>
    {/if}
    <span class="crumb"><Icon name="folder" size={15} /> {folderPathText}</span>
    <span class="save {saveState}" aria-live="polite">{saveLabel}</span>
    <button
      class="icon-btn"
      class:active={app.readMode}
      aria-label={app.readMode ? '편집 모드로' : '읽기 모드로'}
      title={app.readMode ? '편집 모드로 (Ctrl+E)' : '읽기 모드로 (Ctrl+E)'}
      onclick={toggleRead}
    >
      <Icon name={app.readMode ? 'edit' : 'read'} />
    </button>
    {#if note}
      <button
        class="icon-btn"
        class:fav
        aria-label={fav ? '즐겨찾기 해제' : '즐겨찾기'}
        title={fav ? '즐겨찾기 해제' : '즐겨찾기'}
        onclick={() => app.toggleFavorite(note.id)}
      >
        <Icon name="star" filled={fav} />
      </button>
      <button
        class="icon-btn"
        class:active={app.layout === 'desktop' ? app.device.rightPanel : app.panelSheet}
        aria-label="목차·백링크·그래프"
        title="목차·백링크·그래프"
        onclick={togglePanel}
      >
        <Icon name="panel" />
      </button>
      <button
        class="icon-btn"
        aria-label="노트 메뉴"
        onclick={(e) =>
          dialogs.menu(
            [
              {
                label: app.device.livePreview ? '소스 모드로 보기' : '라이브 프리뷰로 보기',
                icon: 'codeIcon',
                run: () => void app.setDevice({ livePreview: !app.device.livePreview }),
              },
              { label: '노트 링크 복사', icon: 'link', run: copyNoteLink },
              ...(app.readMode ? [] : [{ label: '커서 문단 링크 복사', icon: 'link', run: copyBlockLink }]),
              ...noteMenu(app, note),
            ],
            menuPos(app, e),
            note.name,
          )}
      >
        <Icon name="more" />
      </button>
    {/if}
  </header>

  {#if showToolbar && !mobile}
    <Toolbar {ctl} mobile={false} onattach={attach} />
  {/if}

  <div class="body-row">
  <div class="scroll" bind:this={scrollEl}>
    <div class="page">
      {#if note}
        <textarea
          bind:this={titleEl}
          class="title-input"
          rows="1"
          placeholder="제목"
          aria-label="노트 제목"
          enterkeyhint="next"
          bind:value={titleDraft}
          oninput={onTitleInput}
          onkeydown={onTitleKey}
          onblur={commitTitle}
        ></textarea>
        {#if titleError}<p class="title-error">{titleError}</p>{/if}
        <p class="dates">수정 {formatDateTime(note.updatedAt)}</p>
      {/if}
      {#if app.readMode && note}
        <ReadingView {text} {host} deps={[app.attByName, app.notesByName]} ontoggletask={toggleTask} />
      {/if}
      <div
        class="cm-host"
        class:hidden={app.readMode}
        bind:this={cmHost}
        onfocusin={() => (editorFocused = true)}
        onfocusout={() => {
          editorFocused = false;
          void saver.flush();
        }}
      ></div>
    </div>
  </div>
  {#if note && app.layout === 'desktop' && app.device.rightPanel}
    <aside class="side-panel">
      <NotePanel {note} {text} ongo={panelGo} />
    </aside>
  {/if}
  </div>

  {#if note && app.layout !== 'desktop' && app.panelSheet}
    <div class="sheet-scrim" role="presentation" onclick={() => (app.panelSheet = false)}></div>
    <div class="sheet" role="dialog" aria-label="목차·백링크">
      <NotePanel {note} {text} ongo={panelGo} onclose={() => (app.panelSheet = false)} />
    </div>
  {/if}

  {#if showToolbar && mobile}
    <Toolbar {ctl} mobile onattach={attach} onhidekeyboard={() => ctl?.view.contentDOM.blur()} />
  {/if}
</article>

{#if !showNote}
  <div class="none">
    <Icon name="note" size={48} />
    <p>노트를 선택하거나 새로 만드세요.</p>
    <button class="btn primary" onclick={() => app.newNote()}><Icon name="plus" size={18} /> 새 노트</button>
  </div>
{/if}

<style>
  .editor {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    min-width: 0;
  }
  .hidden {
    display: none !important;
  }
  .body-row {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
  }
  /* 화면이 넉넉하지 않으면 패널을 편집기 위에 겹쳐 띄워 본문 폭을 지킨다 */
  @media (max-width: 1359px) {
    .side-panel {
      position: absolute;
      right: 0;
      top: 0;
      bottom: 0;
      z-index: 5;
      box-shadow: var(--shadow-2);
    }
  }
  .body-row > .scroll {
    flex: 1;
    min-width: 0;
  }
  .side-panel {
    width: 280px;
    flex: none;
    border-left: 1px solid var(--border);
    background: var(--surface-2);
    overflow: hidden;
  }
  .sheet-scrim {
    position: fixed;
    inset: 0;
    z-index: 45;
    background: rgba(10, 15, 12, 0.38);
  }
  .sheet {
    position: fixed;
    z-index: 46;
    left: 0;
    right: 0;
    bottom: 0;
    height: min(70dvh, 560px);
    background: var(--surface);
    border-radius: 22px 22px 0 0;
    box-shadow: var(--shadow-2);
    padding-bottom: env(safe-area-inset-bottom);
    overflow: hidden;
    animation: sheet-up 0.2s ease-out;
  }
  @keyframes sheet-up {
    from {
      transform: translateY(40px);
      opacity: 0;
    }
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 6px 8px;
    padding-top: calc(6px + env(safe-area-inset-top));
    border-bottom: 1px solid var(--border);
  }
  .crumb {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding-left: 8px;
    font-size: 13px;
    color: var(--text-3);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .save {
    font-size: 12px;
    color: var(--text-3);
    padding: 0 6px;
    white-space: nowrap;
  }
  .save.error {
    color: var(--danger);
    font-weight: 600;
  }
  .icon-btn.fav {
    color: #e0a63a;
  }
  .scroll {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }
  .page {
    max-width: 820px;
    margin: 0 auto;
    padding: 24px 28px 0;
    display: flex;
    flex-direction: column;
    min-height: 100%;
  }
  .title-input {
    border: 0;
    outline: none;
    background: none;
    resize: none;
    font-size: 28px;
    font-weight: 750;
    letter-spacing: -0.02em;
    line-height: 1.3;
    padding: 0;
    field-sizing: content;
  }
  .title-error {
    margin: 4px 0 0;
    color: var(--danger);
    font-size: 13px;
  }
  .dates {
    margin: 8px 0 18px;
    font-size: 12px;
    color: var(--text-3);
  }
  .cm-host {
    flex: 1;
    min-height: 50vh;
  }
  .none {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--text-3);
    background: var(--surface);
  }
  @media (max-width: 719px) {
    .page {
      padding: 16px 18px 0;
    }
    .title-input {
      font-size: 24px;
    }
  }
</style>
