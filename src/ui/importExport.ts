// 가져오기(.md 여러 개 / ZIP / 옵시디언 볼트 ZIP)와 전체 백업 ZIP 내려받기
import { unzipSync, zipSync, type Zippable } from 'fflate';
import { extOf, stamp } from '../core/attachments';
import { fixImportedText, planImport, type InFile } from '../core/importer';
import { nameKey } from '../core/names';
import { byId, folderPath, isFolderHidden, isNoteVisible } from '../core/tree';
import { pickFiles } from './attach';
import { dialogs } from './dialogs.svelte';
import type { AppStore } from './state.svelte';

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  txt: 'text/plain',
  csv: 'text/csv',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const mimeOf = (name: string) => MIME[extOf(name)] ?? 'application/octet-stream';

const today = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** 선택한 파일들을 가져오기용 목록으로(ZIP은 풀어서) */
async function readFiles(files: File[]): Promise<InFile[]> {
  const out: InFile[] = [];
  for (const f of files) {
    const data = new Uint8Array(await f.arrayBuffer());
    if (/\.zip$/i.test(f.name)) {
      const entries = unzipSync(data);
      for (const [path, bytes] of Object.entries(entries)) if (!path.endsWith('/')) out.push({ path, data: bytes });
    } else {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      out.push({ path: rel, data });
    }
  }
  return out;
}

export async function importFlow(app: AppStore) {
  const files = await pickFiles('');
  if (!files.length) return;
  let inFiles: InFile[];
  try {
    inFiles = await readFiles(files);
  } catch (e) {
    app.toast(`파일을 읽지 못했습니다: ${e instanceof Error ? e.message : e}`, 'error');
    return;
  }
  const plan = planImport(inFiles);
  if (!plan.notes.length && !plan.attachments.length) {
    app.toast('가져올 노트(.md)나 파일이 없습니다.', 'error');
    return;
  }
  const target = plan.rootName ?? `가져옴 ${today()}`;
  const ok = await dialogs.confirm(
    '노트 가져오기',
    `노트 ${plan.notes.length}개, 폴더 ${plan.folders.length}개, 첨부 ${plan.attachments.length}개를 새 폴더 "${target}"에 넣습니다.` +
      (plan.skipped ? `\n(옵시디언 설정·휴지통 등 ${plan.skipped}개는 건너뜁니다)` : '') +
      '\n첨부파일은 _attachments 폴더로 모이고, 노트 안의 링크·이미지는 그에 맞게 고쳐집니다.',
    { okLabel: '가져오기' },
  );
  if (!ok) return;

  app.toast('가져오는 중…', 'info', undefined, 3000);
  const result = await app.run(async () => {
    const root = await app.repo.createFolder(null, target);
    const folderIds = new Map<string, string>([['', root.id]]);
    for (const parts of plan.folders) {
      const parent = folderIds.get(parts.slice(0, -1).join('/'))!;
      const f = await app.repo.createFolder(parent, parts[parts.length - 1]);
      folderIds.set(parts.join('/'), f.id);
    }
    // 첨부 먼저(저장된 이름으로 노트 링크를 맞추기 위해)
    const attMap = new Map<string, string>();
    for (const a of plan.attachments) {
      const meta = await app.repo.addAttachment(new Blob([a.data as BlobPart], { type: mimeOf(a.name) }), a.name, { mime: mimeOf(a.name) });
      attMap.set(nameKey(a.path), meta.name);
      if (!attMap.has(nameKey(a.name))) attMap.set(nameKey(a.name), meta.name);
    }
    // 이름이 바뀐 노트(금지 문자 등) 목록
    const noteMap = new Map<string, string>();
    for (const n of plan.notes) if (n.original !== n.name) noteMap.set(nameKey(n.original), n.name);
    for (const n of plan.notes) {
      const text = fixImportedText(n.text, n.dir, attMap, noteMap);
      await app.repo.createNote(folderIds.get(n.folder.join('/')) ?? root.id, n.name, text);
    }
    return { notes: plan.notes.length, atts: plan.attachments.length, rootId: root.id };
  });
  if (result) {
    app.toast(`노트 ${result.notes}개, 첨부 ${result.atts}개를 "${target}" 폴더로 가져왔습니다.`);
    app.setView({ kind: 'folder', id: result.rootId });
  }
}

/** 전체 백업: 폴더 구조 그대로 .md + _attachments 를 ZIP으로 */
export async function exportFlow(app: AppStore) {
  const folders = app.folders;
  const fmap = byId(folders);
  const zip: Zippable = {};
  const used = new Set<string>();
  const put = (path: string, data: Uint8Array, store = false) => {
    let p = path;
    for (let i = 2; used.has(p.toLowerCase()); i++) p = path.replace(/(\.[^./]+)?$/, ` ${i}$1`);
    used.add(p.toLowerCase());
    zip[p] = store ? [data, { level: 0 }] : data;
  };
  const enc = new TextEncoder();
  app.toast('백업 파일을 만드는 중…', 'info', undefined, 3000);
  // 빈 폴더도 남기기
  for (const f of folders) if (!isFolderHidden(f.id, fmap)) zip[folderPath(f.id, fmap).join('/') + '/'] = new Uint8Array();
  const notes = app.notes.filter((n) => isNoteVisible(n, fmap));
  const contents = await app.repo.db.contents.bulkGet(notes.map((n) => n.id));
  notes.forEach((n, i) => {
    const dir = folderPath(n.folderId, fmap).join('/');
    put(`${dir ? dir + '/' : ''}${n.name}.md`, enc.encode(contents[i]?.text ?? ''));
  });
  let missing = 0;
  for (const a of app.attachments.filter((x) => !x.trashed)) {
    const blob = await app.attachmentBlob(a);
    if (!blob) {
      missing++;
      continue;
    }
    put(`_attachments/${a.name}`, new Uint8Array(await blob.arrayBuffer()), /^(image|video|audio)\/|zip|pdf/.test(a.mime));
  }
  const data = zipSync(zip, { level: 6 });
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/zip' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `마이노트-백업-${stamp(new Date()).slice(0, 8)}.zip`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  app.toast(
    `노트 ${notes.length}개를 ZIP으로 내려받았습니다.` + (missing ? ` (이 기기에 없고 받지 못한 첨부 ${missing}개 제외)` : ''),
    missing ? 'error' : 'info',
  );
}
