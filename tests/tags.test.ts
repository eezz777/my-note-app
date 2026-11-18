import { describe, expect, it } from 'vitest';
import { buildTagTree, extractTags, findBodyTags, frontmatterTags, hasTag, matchTags, renameTagInText, tagAncestry } from '../src/core/tags';

describe('본문 태그 인식', () => {
  it('한글·중첩·영문 태그', () => {
    expect(extractTags('회의 #업무/회의 그리고 #Project_1 #독서')).toEqual(['업무/회의', 'Project_1', '독서']);
  });

  it('제목 기호, 숫자만, URL, 링크 안의 #은 태그가 아님', () => {
    const text = [
      '# 제목',
      '## 두번째 제목',
      '이슈 #123 은 태그 아님',
      'https://example.com/#anchor 와 [링크](#목차)',
      '[[노트#제목]] [[#제목만]]',
      'C#언어',
    ].join('\n');
    expect(extractTags(text)).toEqual([]);
  });

  it('줄 맨 앞의 #태그(공백 없음)는 태그', () => {
    expect(extractTags('#할일 정리하기')).toEqual(['할일']);
  });

  it('코드 블록·인라인 코드·수식 안은 무시', () => {
    const text = ['```js', '// #코드주석', 'x = "#문자열"', '```', '`#인라인`', '$#수식$', '~~~', '#물결코드', '~~~', '진짜 #태그'].join('\n');
    expect(extractTags(text)).toEqual(['태그']);
  });

  it('괄호 안·문장부호 앞에서 끝남', () => {
    expect(findBodyTags('(#업무) 그리고 #독서, #여행.').map((h) => h.tag)).toEqual(['업무', '독서', '여행']);
  });

  it('끝의 / 는 제외', () => {
    expect(extractTags('#업무/ 끝')).toEqual(['업무']);
  });

  it('대소문자가 다른 같은 태그는 하나로', () => {
    expect(extractTags('#Todo #todo #TODO')).toEqual(['Todo']);
  });
});

describe('frontmatter 태그', () => {
  it('대괄호·쉼표·목록 형식', () => {
    expect(frontmatterTags('---\ntags: [가이드, 마크다운]\n---\n본문')).toEqual(['가이드', '마크다운']);
    expect(frontmatterTags('---\ntags: a, "#b"\n---\n')).toEqual(['a', 'b']);
    expect(frontmatterTags('---\ntitle: x\ntags:\n  - 하나\n  - 둘\nother: y\n---\n')).toEqual(['하나', '둘']);
  });
  it('본문 태그와 합침, frontmatter 안의 #은 본문 태그로 보지 않음', () => {
    expect(extractTags('---\ntags: [a]\ncolor: "#fff"\n---\n본문 #b')).toEqual(['a', 'b']);
  });
});

describe('태그 필터', () => {
  it('상위 태그를 고르면 하위 태그 노트도 포함', () => {
    expect(hasTag(['업무/회의'], '업무')).toBe(true);
    expect(hasTag(['업무회의'], '업무')).toBe(false);
    expect(tagAncestry('업무/회의/주간')).toEqual(['업무', '업무/회의', '업무/회의/주간']);
  });
  it('AND / OR', () => {
    const tags = ['업무/회의', '중요'];
    expect(matchTags(tags, ['업무', '중요'], 'and')).toBe(true);
    expect(matchTags(tags, ['업무', '개인'], 'and')).toBe(false);
    expect(matchTags(tags, ['업무', '개인'], 'or')).toBe(true);
    expect(matchTags(tags, [], 'and')).toBe(true);
  });
});

describe('태그 트리', () => {
  it('중첩 태그와 노트 수(노트당 한 번)', () => {
    const { roots, byKey } = buildTagTree([['업무/회의', '업무/보고'], ['업무'], ['개인'], undefined, ['Upmu/x']]);
    // 한국어 정렬: 한글이 영문보다 앞
    expect(roots.map((r) => `${r.full}:${r.count}`)).toEqual(['개인:1', '업무:2', 'Upmu:1']);
    expect(byKey.get('업무')!.children.map((c) => `${c.name}:${c.count}`)).toEqual(['보고:1', '회의:1']);
  });
});

describe('태그 이름 바꾸기', () => {
  it('본문과 하위 태그, 대소문자 무시, 코드는 그대로', () => {
    const text = '#업무 #업무/회의 #업무회의 #UPMU\n```\n#업무\n```';
    expect(renameTagInText(text, '업무', '회사')).toBe('#회사 #회사/회의 #업무회의 #UPMU\n```\n#업무\n```');
  });
  it('frontmatter의 여러 형식', () => {
    const text = '---\ntags: [업무, "업무/회의", 개인]\n---\n본문 #업무';
    expect(renameTagInText(text, '업무', '회사')).toBe('---\ntags: [회사, "회사/회의", 개인]\n---\n본문 #회사');
    const list = '---\ntags:\n  - 업무\n  - 개인\n---\n';
    expect(renameTagInText(list, '업무', '회사')).toBe('---\ntags:\n  - 회사\n  - 개인\n---\n');
  });
  it('중첩 태그로 옮기기', () => {
    expect(renameTagInText('#독서 메모', '독서', '취미/독서')).toBe('#취미/독서 메모');
  });
});
