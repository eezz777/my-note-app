// 콜아웃 종류별 기본 제목(한국어)
const LABEL: Record<string, string> = {
  note: '노트', info: '정보', tip: '팁', hint: '팁', important: '중요', warning: '주의', caution: '주의',
  attention: '주의', danger: '위험', error: '오류', bug: '버그', example: '예시', quote: '인용', cite: '인용',
  question: '질문', help: '질문', faq: '질문', success: '성공', done: '완료', check: '완료', failure: '실패',
  fail: '실패', missing: '없음', todo: '할 일', abstract: '요약', summary: '요약', tldr: '요약',
};

export function calloutLabelText(type: string): string {
  return LABEL[type.toLowerCase()] ?? type.charAt(0).toUpperCase() + type.slice(1);
}
