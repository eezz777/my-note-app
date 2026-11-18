// 가져오기 계획: 파일 목록(.md 여러 개, ZIP, 옵시디언 볼트)을 폴더·노트·첨부로 나누고 링크를 맞춘다.
import { kindOf } from './attachments';
import { nameKey, sanitizeName } from './names';
import { findLinks, rewriteLinks } from './links';

export interface InFile {
  /** "폴더/하위/파일.md" 형태(구분자 /) */
  path: string;
  data: Uint8Array;
}

export interface PlanNote {
  /** 폴더 경로 조각(정리된 이름) */
  folder: string[];
  /** 원래 폴더 경로(상대 경로 이미지 찾기용) */
  dir: string;
  /** 원래 파일 이름(.md 뺀 것) */
  original: string;
  name: string;
  text: string;
}

export interface PlanAttachment {
  /** 원래 경로와 파일 이름(링크 맞추기용) */
  path: string;
  name: string;
  data: Uint8Array;
}

export interface ImportPlan {
  /** ZIP이 폴더 하나로 감싸져 있으면 그 이름(볼트 이름) */
  rootName: string | null;
  folders: string[][];
  notes: PlanNote[];
  attachments: PlanAttachment[];
  skipped: number;
}

const SKIP = /(^|\/)(\.obsidian|\.trash|\.git|__MACOSX|node_modules)(\/|$)|(^|\/)\.DS_Store$|(^|\/)Thumbs\.db$/i;

const decoder = new TextDecoder('utf-8');

export function planImport(files: InFile[]): ImportPlan {
  let list = files.filter((f) => !SKIP.test(f.path) && !f.path.split('/').some((seg) => seg.startsWith('.') && seg !== '.'));
  const skipped = files.length - list.length;
  // 모두 같은 최상위 폴더 안에 있으면(볼트 ZIP) 그 폴더를 벗긴다
  let rootName: string | null = null;
  const tops = new Set(list.map((f) => (f.path.includes('/') ? f.path.split('/')[0] : '')));
  if (tops.size === 1 && !tops.has('')) {
    rootName = [...tops][0];
    list = list.map((f) => ({ ...f, path: f.path.slice(rootName!.length + 1) }));
  }

  const folders = new Map<string, string[]>();
  const notes: PlanNote[] = [];
  const attachments: PlanAttachment[] = [];
  const usedNoteNames = new Map<string, Set<string>>();

  for (const f of list) {
    const parts = f.path.split('/').filter(Boolean);
    const file = parts.pop();
    if (!file) continue;
    if (/\.md$/i.test(file) || /\.markdown$/i.test(file)) {
      const folder = parts.map((p) => sanitizeName(p, '폴더'));
      for (let i = 1; i <= folder.length; i++) folders.set(folder.slice(0, i).join('/'), folder.slice(0, i));
      const key = folder.join('/');
      const used = usedNoteNames.get(key) ?? new Set();
      let name = sanitizeName(file.replace(/\.(md|markdown)$/i, ''));
      for (let n = 2; used.has(nameKey(name)); n++) name = `${sanitizeName(file.replace(/\.(md|markdown)$/i, ''))} ${n}`;
      used.add(nameKey(name));
      usedNoteNames.set(key, used);
      notes.push({
        folder,
        dir: parts.join('/'),
        original: file.replace(/\.(md|markdown)$/i, ''),
        name,
        text: decoder.decode(f.data).replace(/^﻿/, '').replace(/\r\n/g, '\n'),
      });
    } else {
      attachments.push({ path: f.path, name: file, data: f.data });
    }
  }
  return { rootName, folders: [...folders.values()].sort((a, b) => a.length - b.length), notes, attachments, skipped };
}

/**
 * 가져온 노트의 링크를 실제 저장된 이름에 맞춘다.
 * - attMap: 원래 첨부 경로/파일 이름(소문자) → 저장된 첨부 이름
 * - noteMap: 원래 노트 이름(소문자) → 저장된 노트 이름(이름이 바뀐 경우만)
 * - 마크다운 이미지 ![설명](상대/경로.png) 도 가져온 첨부면 ![[이름]] 으로 바꾼다
 */
export function fixImportedText(text: string, noteDir: string, attMap: Map<string, string>, noteMap: Map<string, string>): string {
  let out = rewriteLinks(text, (l) => {
    const target = l.name.trim();
    if (kindOf(target) === 'note') return noteMap.get(nameKey(target.replace(/\.md$/i, '').split('/').pop()!)) ?? null;
    return attMap.get(nameKey(target)) ?? attMap.get(nameKey(target.split('/').pop()!)) ?? null;
  });
  // ![설명](경로) → ![[첨부]]  (외부 주소는 그대로)
  out = out.replace(/!\[([^\]]*)\]\(<?([^)>\s]+)>?(?:\s+"[^"]*")?\)/g, (all, _alt, href: string) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return all;
    let p = decodeURIComponent(href).replace(/^\.\//, '');
    if (noteDir && !p.startsWith('/')) {
      const segs = noteDir.split('/').filter(Boolean);
      for (const s of p.split('/')) {
        if (s === '..') segs.pop();
        else if (s !== '.') segs.push(s);
      }
      p = segs.join('/');
    } else p = p.replace(/^\//, '');
    const name = attMap.get(nameKey(p)) ?? attMap.get(nameKey(p.split('/').pop()!));
    return name ? `![[${name}]]` : all;
  });
  return out;
}

/** 노트에 쓰인 링크 대상 이름들(검증용) */
export function linkTargets(text: string): string[] {
  return findLinks(text).map((l) => l.name);
}
