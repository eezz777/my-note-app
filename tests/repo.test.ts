import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { NotesDb } from '../src/store/db';
import { Repo, UserError } from '../src/store/repo';
import { buildFolderTree, byId, isNoteVisible } from '../src/core/tree';

let repo: Repo;
let n = 0;

beforeEach(async () => {
  const db = new NotesDb(`test-${n++}`);
  let t = 1000;
  repo = new Repo(db, () => t++);
});

describe('폴더', () => {
  it('같은 위치에 같은 이름을 만들면 숫자를 붙인다', async () => {
    const a = await repo.createFolder(null, '프로젝트');
    const b = await repo.createFolder(null, '프로젝트');
    expect(a.name).toBe('프로젝트');
    expect(b.name).toBe('프로젝트 2');
  });

  it('이름 변경 시 중복이면 거부한다', async () => {
    await repo.createFolder(null, 'A');
    const b = await repo.createFolder(null, 'B');
    await expect(repo.renameFolder(b.id, 'a')).rejects.toBeInstanceOf(UserError);
  });

  it('자기 하위 폴더로 이동할 수 없다', async () => {
    const a = await repo.createFolder(null, 'A');
    const b = await repo.createFolder(a.id, 'B');
    const c = await repo.createFolder(b.id, 'C');
    await expect(repo.moveFolder(a.id, c.id)).rejects.toBeInstanceOf(UserError);
    await expect(repo.moveFolder(a.id, a.id)).rejects.toBeInstanceOf(UserError);
  });

  it('이동 시 대상에 같은 이름이 있으면 숫자를 붙인다', async () => {
    const a = await repo.createFolder(null, 'A');
    await repo.createFolder(a.id, '자료');
    const other = await repo.createFolder(null, '자료');
    expect(await repo.moveFolder(other.id, a.id)).toBe('자료 2');
  });

  it('폴더를 휴지통에 넣으면 안의 노트도 숨겨지고, 복원하면 다시 보인다', async () => {
    const a = await repo.createFolder(null, 'A');
    const sub = await repo.createFolder(a.id, 'Sub');
    const note = await repo.createNote(sub.id, '노트');
    await repo.trashFolder(a.id);

    let folders = await repo.db.folders.toArray();
    expect(buildFolderTree(folders)).toHaveLength(0);
    expect(isNoteVisible((await repo.db.notes.get(note.id))!, byId(folders))).toBe(false);

    const trash = await repo.trashItems();
    expect(trash.folders.map((f) => f.id)).toEqual([a.id]); // 최상위만 보임
    expect(trash.notes).toHaveLength(0);

    await repo.restoreFolder(a.id);
    folders = await repo.db.folders.toArray();
    expect(isNoteVisible((await repo.db.notes.get(note.id))!, byId(folders))).toBe(true);
  });

  it('영구 삭제는 하위 폴더와 노트까지 지운다', async () => {
    const a = await repo.createFolder(null, 'A');
    const sub = await repo.createFolder(a.id, 'Sub');
    const note = await repo.createNote(sub.id, '노트', '본문');
    await repo.trashFolder(a.id);
    await repo.emptyTrash();
    expect(await repo.db.folders.count()).toBe(0);
    expect(await repo.db.notes.get(note.id)).toBeUndefined();
    expect(await repo.db.contents.get(note.id)).toBeUndefined();
  });
});

describe('태그 색인', () => {
  it('저장할 때 태그가 갱신되고, 일괄 이름 바꾸기가 된다', async () => {
    const a = await repo.createNote(null, 'A', '#업무/회의 메모');
    const b = await repo.createNote(null, 'B', '---\ntags: [업무]\n---\n본문');
    const c = await repo.createNote(null, 'C', '#개인');
    expect((await repo.db.notes.get(a.id))!.tags).toEqual(['업무/회의']);
    expect(await repo.renameTag('업무', '회사')).toBe(2);
    expect(await repo.getContent(a.id)).toBe('#회사/회의 메모');
    expect((await repo.db.notes.get(b.id))!.tags).toEqual(['회사']);
    expect((await repo.db.notes.get(c.id))!.tags).toEqual(['개인']);
    await expect(repo.renameTag('개인', '123')).rejects.toBeInstanceOf(UserError);
  });

  it('전체 재색인은 수정일·동기화 표시를 바꾸지 않는다', async () => {
    const a = await repo.createNote(null, 'A', '#하나');
    await repo.db.notes.update(a.id, { tags: [], dirty: 0 });
    const before = (await repo.db.notes.get(a.id))!;
    await repo.reindexAll();
    const after = (await repo.db.notes.get(a.id))!;
    expect(after.tags).toEqual(['하나']);
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.dirty).toBe(0);
    expect(await repo.ensureIndex()).toBe(false);
  });
});

describe('링크 자동 갱신', () => {
  it('노트 이름을 바꾸면 [[링크]]가 따라 바뀐다(제목·별칭 유지)', async () => {
    const t = await repo.createNote(null, '회의');
    const a = await repo.createNote(null, 'A', '[[회의]] [[회의#안건|보기]] ![[회의#^x]] [[다른]] `[[회의]]`');
    await repo.renameNote(t.id, '정기 회의');
    expect(await repo.getContent(a.id)).toBe('[[정기 회의]] [[정기 회의#안건|보기]] ![[정기 회의#^x]] [[다른]] `[[회의]]`');
    expect(repo.lastRelinked).toBe(1);
    expect((await repo.db.notes.get(a.id))!.links).toEqual(['정기 회의', '다른']);
  });

  it('같은 이름의 다른 노트를 가리키는 링크는 건드리지 않는다', async () => {
    const f = await repo.createFolder(null, '업무');
    const t1 = await repo.createNote(f.id, '회의');
    await repo.createNote(null, '회의');
    const inF = await repo.createNote(f.id, 'X', '[[회의]]'); // 같은 폴더의 t1을 가리킴
    const atRoot = await repo.createNote(null, 'Y', '[[회의]]'); // 루트의 회의를 가리킴
    await repo.renameNote(t1.id, '업무 회의');
    expect(await repo.getContent(inF.id)).toBe('[[업무 회의]]');
    expect(await repo.getContent(atRoot.id)).toBe('[[회의]]');
  });

  it('경로 링크는 노트·폴더 이동/이름 변경 후 새 경로로', async () => {
    const f = await repo.createFolder(null, '업무');
    const g = await repo.createFolder(null, '보관');
    const t = await repo.createNote(f.id, '회의');
    await repo.createNote(null, '회의'); // 이름만으로는 루트 것이 잡히는 상황
    const a = await repo.createNote(null, 'A', '[[업무/회의]]');
    await repo.renameFolder(f.id, '회사');
    expect(await repo.getContent(a.id)).toBe('[[회사/회의]]');
    await repo.moveNote(t.id, g.id);
    expect(await repo.getContent(a.id)).toBe('[[보관/회의]]');
  });

  it('이동해도 이름으로 계속 해석되면 그대로 둔다', async () => {
    const g = await repo.createFolder(null, '보관');
    const t = await repo.createNote(null, '유일한 노트');
    const a = await repo.createNote(null, 'A', '[[유일한 노트]]');
    await repo.moveNote(t.id, g.id);
    expect(await repo.getContent(a.id)).toBe('[[유일한 노트]]');
  });
});

describe('첨부파일', () => {
  it('저장하고 이름으로 찾는다(이름 중복 방지, 대소문자 무시)', async () => {
    const a = await repo.addAttachment(new Blob(['x'], { type: 'image/png' }), '사진.png');
    const b = await repo.addAttachment(new Blob(['yy'], { type: 'image/png' }), '사진.png');
    expect(a.name).toBe('사진.png');
    expect(b.name).toBe('사진 2.png');
    expect((await repo.findAttachment('사진.PNG'))?.id).toBe(a.id);
    expect((await repo.findAttachment('_attachments/사진 2.png'))?.id).toBe(b.id);
    expect((await repo.getAttachmentBlob(b.id))?.size).toBe(2);
    expect(await repo.findAttachment('없음.png')).toBeUndefined();
  });
});

describe('노트', () => {
  it('생성·저장 시 미리보기와 썸네일이 갱신되고 dirty로 표시된다', async () => {
    const note = await repo.createNote(null, '첫 노트');
    await repo.db.notes.update(note.id, { dirty: 0 });
    const changed = await repo.saveContent(note.id, '# 제목\n**굵게** 본문 ![[사진.png|300]]');
    expect(changed).toBe(true);
    const meta = (await repo.db.notes.get(note.id))!;
    expect(meta.preview).toBe('제목 굵게 본문');
    expect(meta.thumb).toBe('사진.png');
    expect(meta.dirty).toBe(1);
    expect(await repo.saveContent(note.id, '# 제목\n**굵게** 본문 ![[사진.png|300]]')).toBe(false);
  });

  it('같은 폴더 내 이름 중복 방지, 다른 폴더는 허용', async () => {
    const f = await repo.createFolder(null, 'F');
    const a = await repo.createNote(null, '메모');
    const b = await repo.createNote(null, '메모');
    const c = await repo.createNote(f.id, '메모');
    expect([a.name, b.name, c.name]).toEqual(['메모', '메모 2', '메모']);
    await expect(repo.renameNote(b.id, '메모')).rejects.toBeInstanceOf(UserError);
  });

  it('복제와 이동', async () => {
    const f = await repo.createFolder(null, 'F');
    const a = await repo.createNote(null, '메모', '내용');
    const copy = await repo.duplicateNote(a.id);
    expect(copy.name).toBe('메모 사본');
    expect(await repo.getContent(copy.id)).toBe('내용');
    await repo.createNote(f.id, '메모');
    expect(await repo.moveNote(a.id, f.id)).toBe('메모 2');
  });

  it('휴지통 폴더 안으로는 이동할 수 없다', async () => {
    const f = await repo.createFolder(null, 'F');
    const a = await repo.createNote(null, '메모');
    await repo.trashFolder(f.id);
    await expect(repo.moveNote(a.id, f.id)).rejects.toBeInstanceOf(UserError);
  });

  it('원래 폴더가 사라졌으면 루트로 복원하고 이름 충돌을 피한다', async () => {
    const f = await repo.createFolder(null, 'F');
    const a = await repo.createNote(f.id, '메모');
    await repo.trashNote(a.id);
    await repo.trashFolder(f.id);
    await repo.createNote(null, '메모');
    await repo.restoreNote(a.id);
    const meta = (await repo.db.notes.get(a.id))!;
    expect(meta.folderId).toBeNull();
    expect(meta.name).toBe('메모 2');
  });
});
