// 데모 모드 샘플 노트. 폴더, 태그, 링크, 이미지, PDF 사용 예시를 담는다.
// (이미지/PDF 파일 자체는 3단계에서 첨부 기능과 함께 추가된다)
import type { Repo } from '../store/repo';

const WELCOME = `마이노트에 오신 것을 환영합니다! 이 노트는 **데모 모드** 샘플입니다.

## 기본 사용법
- 왼쪽 사이드바에서 폴더를 고르고, \`+\` 버튼으로 새 노트를 만드세요.
- 노트·폴더의 \`⋮\` 버튼(또는 마우스 오른쪽 클릭, 폰에서는 길게 누르기)으로 이름 변경·이동·복제·삭제를 합니다.
- PC에서는 노트나 폴더를 끌어다 사이드바의 폴더에 놓아 옮길 수 있습니다.

## 마크다운 예시
**굵게**, *기울임*, ~~취소선~~, ==형광펜==, \`인라인 코드\`

- [ ] 할 일 체크박스
- [x] 끝난 일

> [!note] 콜아웃
> 옵시디언 방식의 콜아웃입니다.

## 링크와 태그
- 다른 노트 링크: [[마크다운 문법 정리]]
- 제목으로 링크: [[마크다운 문법 정리#표]]
- 아직 없는 노트: [[새로 만들 노트]]
- 태그: #시작하기 #가이드/기본

## 첨부
![[sample-image.png|300]]
![[sample.pdf#page=1]]
`;

const SYNTAX = `---
tags: [가이드, 마크다운]
---
# 마크다운 문법 정리

## 제목
\`# 제목1\`, \`## 제목2\`, \`### 제목3\`

## 목록
1. 첫째
2. 둘째
   - 들여쓴 항목

## 표
| 이름 | 설명 |
| --- | --- |
| 굵게 | \`**텍스트**\` |
| 형광펜 | \`==텍스트==\` |

## 코드 블록
\`\`\`js
// 코드 안의 #해시는 태그가 아닙니다
const greeting = '안녕하세요';
console.log(greeting);
\`\`\`

## 각주
각주가 달린 문장입니다.[^1]

[^1]: 각주 내용.

## 수식
$$E = mc^2$$

이 문단에는 블록 ID가 있습니다. ^syntax-para
`;

const MEETING = `#업무/회의 #프로젝트

## 참석자
- 김민수, 이지은

## 논의 사항
- [ ] 디자인 시안 검토 → [[디자인 가이드]]
- [x] 일정 확정

## 다음 할 일
[[마크다운 문법 정리#^syntax-para]] 문단 참고.
`;

const DESIGN = `#프로젝트 #디자인

# 디자인 가이드
- 포인트 컬러: 녹색 계열
- 둥근 모서리, 부드러운 그림자

![[마크다운 문법 정리#표]]
`;

const IDEAS = `#아이디어

떠오르는 생각을 자유롭게 적는 곳.

- 주말 등산 코스 정리
- 독서 목록 만들기 #독서
`;

const SHOPPING = `- [ ] 우유
- [ ] 계란
- [x] 커피 원두
`;

/** 빈 DB에 샘플 데이터를 채운다 */
export async function seedDemo(repo: Repo): Promise<void> {
  const work = await repo.createFolder(null, '업무');
  const meetings = await repo.createFolder(work.id, '회의록');
  const project = await repo.createFolder(work.id, '프로젝트 A');
  const personal = await repo.createFolder(null, '개인');
  const guide = await repo.createFolder(null, '가이드');

  const welcome = await repo.createNote(null, '마이노트 시작하기', WELCOME);
  await repo.createNote(guide.id, '마크다운 문법 정리', SYNTAX);
  await repo.createNote(meetings.id, '2026-11-17 주간 회의', MEETING);
  await repo.createNote(project.id, '디자인 가이드', DESIGN);
  await repo.createNote(personal.id, '아이디어 메모', IDEAS);
  await repo.createNote(personal.id, '장보기', SHOPPING);

  await repo.setShared({ favorites: [welcome.id] });
  await repo.setDevice({ expanded: [work.id], lastNoteId: welcome.id });
  await repo.db.kv.put({ key: 'seeded', value: true });
}
