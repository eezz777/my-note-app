// 동기화 엔진: 두 기기(각자 로컬 DB)가 하나의 가짜 드라이브를 함께 쓰는 상황을 시험한다.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { NotesDb } from '../src/store/db';
import { Repo } from '../src/store/repo';
import { FakeDrive } from '../src/drive/fake';
import { SyncEngine, type ConflictInfo } from '../src/sync/engine';
import { OfflineError } from '../src/drive/types';

let n = 0;
let drive: FakeDrive;

function device() {
  const db = new NotesDb(`sync-${n++}`);
  const repo = new Repo(db);
  const conflicts: ConflictInfo[] = [];
  const engine = new SyncEngine(repo, drive, { onConflict: (c) => conflicts.push(c), now: () => new Date(2026, 10, 18, 14, 5) });
  return { db, repo, engine, conflicts };
}

const live = async (d: ReturnType<typeof device>) => (await d.db.notes.toArray()).filter((x) => !x.trashed);
const byName = async (d: ReturnType<typeof device>, name: string) => (await d.db.notes.toArray()).find((x) => x.name === name)!;
const text = async (d: ReturnType<typeof device>, name: string) => d.repo.getContent((await byName(d, name)).id);

beforeEach(() => {
  drive = new FakeDrive();
});

describe('기본 동기화', () => {
  it('A가 만든 폴더·노트를 B가 받는다(첫 동기화)', async () => {
    const A = device();
    const f = await A.repo.createFolder(null, '업무');
    const sub = await A.repo.createFolder(f.id, '회의록');
    await A.repo.createNote(sub.id, '주간 회의', '# 회의\n#업무 내용');
    await A.repo.createNote(null, '메모', '루트 노트');
    await A.engine.sync();
    expect(await A.engine.pendingCount()).toBe(0);
    expect(drive.byName('주간 회의.md')).toHaveLength(1);
    expect(drive.byName('MyNotes')).toHaveLength(1);

    const B = device();
    await B.engine.sync();
    const bNote = await byName(B, '주간 회의');
    expect(await B.repo.getContent(bNote.id)).toBe('# 회의\n#업무 내용');
    expect(bNote.tags).toEqual(['업무']);
    const bFolder = await B.db.folders.get(bNote.folderId!);
    expect(bFolder?.name).toBe('회의록');
    expect((await B.db.folders.get(bFolder!.parentId!))?.name).toBe('업무');
    expect(drive.byName('MyNotes')).toHaveLength(1); // 루트를 새로 만들지 않고 찾아 씀
  });

  it('수정은 변경분만 주고받는다(이름 변경은 본문을 다시 받지 않음)', async () => {
    const A = device();
    const B = device();
    const note = await A.repo.createNote(null, '노트', '1');
    await A.engine.sync();
    await B.engine.sync();

    await A.repo.saveContent(note.id, '2');
    await A.engine.sync();
    await B.engine.sync();
    expect(await text(B, '노트')).toBe('2');

    const downloads = drive.calls.download ?? 0;
    await A.repo.renameNote(note.id, '새 이름');
    await A.engine.sync();
    await B.engine.sync();
    expect((await live(B)).map((x) => x.name)).toEqual(['새 이름']);
    expect(drive.calls.download ?? 0).toBe(downloads); // 본문 재다운로드 없음
    expect(drive.byName('새 이름.md')).toHaveLength(1);
  });

  it('이동·휴지통·복원·영구 삭제가 전파된다', async () => {
    const A = device();
    const B = device();
    const f = await A.repo.createFolder(null, '보관');
    const note = await A.repo.createNote(null, '노트', 'x');
    await A.engine.sync();
    await B.engine.sync();

    await A.repo.moveNote(note.id, f.id);
    await A.engine.sync();
    await B.engine.sync();
    const bn = await byName(B, '노트');
    expect((await B.db.folders.get(bn.folderId!))?.name).toBe('보관');

    await A.repo.trashNote(note.id);
    await A.engine.sync();
    await B.engine.sync();
    expect((await byName(B, '노트')).trashed).toBe(1);

    await B.repo.restoreNote(bn.id);
    await B.engine.sync();
    await A.engine.sync();
    expect((await A.db.notes.get(note.id))!.trashed).toBe(0);

    await A.repo.trashNote(note.id);
    await A.repo.deleteNoteForever(note.id);
    await A.engine.sync();
    expect(drive.byName('노트.md')).toHaveLength(0);
    await B.engine.sync();
    expect(await B.db.notes.count()).toBe(0);
  });

  it('공통 설정(즐겨찾기)이 다른 기기로 간다', async () => {
    const A = device();
    const B = device();
    const note = await A.repo.createNote(null, '노트', 'x');
    await A.repo.setShared({ favorites: [note.id], accent: '#3f7fd1' });
    await A.engine.sync();
    await B.engine.sync();
    const s = await B.repo.getShared();
    expect(s.accent).toBe('#3f7fd1');
  });

  it('첨부파일: 올리고, 다른 기기는 필요할 때 받는다', async () => {
    const A = device();
    const B = device();
    await A.repo.addAttachment(new Blob(['PNGDATA'], { type: 'image/png' }), '사진.png');
    await A.engine.sync();
    expect(drive.byName('사진.png')).toHaveLength(1);
    await B.engine.sync();
    const att = (await B.repo.findAttachment('사진.png'))!;
    expect(await B.repo.getAttachmentBlob(att.id)).toBeUndefined(); // 아직 안 받음
    const blob = await B.engine.fetchAttachment(att);
    expect(await blob!.text()).toBe('PNGDATA');
  });
});

describe('충돌과 데이터 보호', () => {
  it('두 기기가 같은 노트를 동시에 고치면 어느 쪽도 잃지 않는다', async () => {
    const A = device();
    const B = device();
    const note = await A.repo.createNote(null, '회의', '원본');
    await A.engine.sync();
    await B.engine.sync();
    const bId = (await byName(B, '회의')).id;

    // 둘 다 오프라인에서 수정
    await A.repo.saveContent(note.id, 'A의 수정');
    await B.repo.saveContent(bId, 'B의 수정');
    await A.engine.sync(); // A가 먼저 올림
    await B.engine.sync(); // B는 충돌

    expect(B.conflicts).toHaveLength(1);
    expect(B.conflicts[0].kind).toBe('mine');
    expect(await text(B, '회의')).toBe('A의 수정'); // 원본 = 먼저 올라간 버전
    const copyName = '회의 (충돌 2026-11-18 14시 05분)';
    expect(await text(B, copyName)).toBe('B의 수정'); // 내 버전은 사본으로

    await A.engine.sync();
    expect(await text(A, copyName)).toBe('B의 수정'); // A도 사본을 받음
    expect(drive.byName(`${copyName}.md`)).toHaveLength(1);
  });

  it('양쪽이 똑같이 고쳤으면 충돌로 보지 않는다', async () => {
    const A = device();
    const B = device();
    const note = await A.repo.createNote(null, '노트', '원본');
    await A.engine.sync();
    await B.engine.sync();
    await A.repo.saveContent(note.id, '같은 수정');
    await B.repo.saveContent((await byName(B, '노트')).id, '같은 수정');
    await A.engine.sync();
    await B.engine.sync();
    expect(B.conflicts).toHaveLength(0);
    expect(await B.engine.pendingCount()).toBe(0);
  });

  it('확인과 올리기 사이에 다른 기기가 끼어들어도 그 내용을 살린다', async () => {
    const A = device();
    const note = await A.repo.createNote(null, '노트', '원본');
    await A.engine.sync();
    const driveId = (await A.db.notes.get(note.id))!.driveId!;
    await A.repo.saveContent(note.id, 'A 수정');
    // 올리기 직전에 다른 기기의 쓰기가 끼어드는 상황
    const orig = drive.updateContent.bind(drive);
    drive.updateContent = async (id: string, data: string | Blob, mime?: string) => {
      await drive.externalWrite(driveId, '끼어든 다른 기기 수정');
      drive.updateContent = orig;
      return orig(id, data, mime);
    };
    await A.engine.sync();
    expect(A.conflicts.map((c) => c.kind)).toEqual(['theirs']);
    expect(await text(A, '노트')).toBe('A 수정');
    expect(await text(A, '노트 (충돌 2026-11-18 14시 05분 다른 기기)')).toBe('끼어든 다른 기기 수정');
  });

  it('받는 도중 이 기기에서 고친 내용은 덮어쓰지 않는다', async () => {
    const A = device();
    const B = device();
    const note = await A.repo.createNote(null, '노트', '원본');
    await A.engine.sync();
    await B.engine.sync();
    const bId = (await byName(B, '노트')).id;
    await A.repo.saveContent(note.id, 'A 수정');
    await A.engine.sync();
    // B가 내려받는 사이에 사용자가 입력
    const orig = drive.download.bind(drive);
    drive.download = async (id) => {
      await B.repo.saveContent(bId, 'B가 방금 입력');
      drive.download = orig;
      return orig(id);
    };
    await B.engine.sync();
    const names = (await live(B)).map((x) => x.name).sort();
    expect(names).toEqual(['노트', '노트 (충돌 2026-11-18 14시 05분)']);
    expect(await text(B, '노트')).toBe('A 수정');
    expect(await text(B, '노트 (충돌 2026-11-18 14시 05분)')).toBe('B가 방금 입력');
  });

  it('드라이브에서 지워졌어도 이 기기에서 고친 노트는 다시 올린다', async () => {
    const A = device();
    const B = device();
    const note = await A.repo.createNote(null, '노트', '원본');
    await A.engine.sync();
    await B.engine.sync();
    await B.repo.saveContent((await byName(B, '노트')).id, 'B 수정');
    await A.repo.trashNote(note.id);
    await A.repo.deleteNoteForever(note.id);
    await A.engine.sync();
    await B.engine.sync();
    expect(await text(B, '노트')).toBe('B 수정');
    expect(await drive.textOf(drive.byName('노트.md')[0].id)).toBe('B 수정');
  });

  it('다른 기기가 휴지통에 넣은 노트를 이 기기에서 고치는 중이면 휴지통에서 꺼내 살린다', async () => {
    const A = device();
    const B = device();
    const note = await A.repo.createNote(null, '노트', '원본');
    await A.engine.sync();
    await B.engine.sync();
    await B.repo.saveContent((await byName(B, '노트')).id, 'B 수정');
    await A.repo.trashNote(note.id);
    await A.engine.sync();
    await B.engine.sync();
    expect((await byName(B, '노트')).trashed).toBe(0);
    await A.engine.sync();
    expect((await A.db.notes.get(note.id))!.trashed).toBe(0);
    expect(await text(A, '노트')).toBe('B 수정');
  });

  it('올리기 전 상태 확인은 배치 요청 한 번으로 묶는다', async () => {
    const A = device();
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push((await A.repo.createNote(null, `n${i}`, 'x')).id);
    await A.engine.sync();
    drive.calls = {};
    for (const id of ids) await A.repo.saveContent(id, 'y');
    await A.engine.sync();
    expect(drive.calls.getMetas).toBe(1);
    expect(drive.calls.getMeta ?? 0).toBe(0);
    expect(drive.calls.updateContent).toBe(5);
  });

  it('오프라인 중에 만든 같은 이름 노트는 둘 다 살아남는다', async () => {
    const A = device();
    const B = device();
    await A.engine.sync();
    await B.engine.sync();
    await A.repo.createNote(null, '회의', 'A');
    await B.repo.createNote(null, '회의', 'B');
    await A.engine.sync();
    await B.engine.sync();
    await A.engine.sync();
    const aNames = (await live(A)).map((x) => x.name).sort();
    const bNames = (await live(B)).map((x) => x.name).sort();
    expect(aNames).toEqual(['회의', '회의 2']);
    expect(bNames).toEqual(['회의', '회의 2']);
  });

  it('첫 동기화가 중간에 끊겨도 이어서 끝낸다', async () => {
    const A = device();
    for (let i = 0; i < 6; i++) await A.repo.createNote(null, `노트${i}`, `본문${i}`);
    await A.engine.sync();
    const B = device();
    // 내려받기 세 번째에서 연결이 끊김
    const orig = drive.download.bind(drive);
    let count = 0;
    drive.download = async (id) => {
      if (++count === 3) throw new OfflineError();
      return orig(id);
    };
    await expect(B.engine.sync()).rejects.toBeInstanceOf(OfflineError);
    drive.download = orig;
    await B.engine.sync();
    for (let i = 0; i < 6; i++) expect(await text(B, `노트${i}`)).toBe(`본문${i}`);
  });

  it('폴더 안 노트를 고치는 사이 다른 기기가 폴더를 지우면, 고친 노트는 루트로 살린다', async () => {
    const A = device();
    const B = device();
    const f = await A.repo.createFolder(null, '폴더');
    await A.repo.createNote(f.id, '노트', '원본');
    await A.engine.sync();
    await B.engine.sync();
    await B.repo.saveContent((await byName(B, '노트')).id, 'B 수정');
    await A.repo.trashFolder(f.id);
    await A.repo.deleteFolderForever(f.id);
    await A.engine.sync();
    await B.engine.sync();
    const bn = await byName(B, '노트');
    expect(bn.folderId).toBeNull();
    expect(await text(B, '노트')).toBe('B 수정');
    await A.engine.sync();
    expect(await text(A, '노트')).toBe('B 수정');
  });
});
