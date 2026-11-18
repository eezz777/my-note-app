// 읽기 모드 렌더러 테스트 (DOMPurify가 DOM을 쓰므로 jsdom 환경)
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderNote, splitFrontmatter } from '../src/render/markdown';

describe('renderNote', () => {
  it('형광펜, 위키링크, 임베드', () => {
    const html = renderNote('==중요== [[다른 노트|별칭]] ![[사진.png|300]]');
    expect(html).toContain('<mark>중요</mark>');
    expect(html).toContain('data-wikilink="다른 노트|별칭"');
    expect(html).toContain('>별칭</a>');
    expect(html).toContain('data-embed="사진.png|300"');
  });

  it('체크박스는 원문 줄 번호를 가진다(frontmatter 포함)', () => {
    const html = renderNote('---\ntags: [a]\n---\n# 제목\n- [ ] 하나\n- [x] 둘');
    expect(html).toContain('data-line="5"');
    expect(html).toMatch(/data-line="6"[^>]*checked/);
    expect(html).toContain('class="frontmatter"');
  });

  it('콜아웃', () => {
    const html = renderNote('> [!warning] 조심\n> 내용');
    expect(html).toContain('callout callout-warning');
    expect(html).toContain('<div class="callout-title">조심</div>');
    expect(html).toContain('내용');
    expect(html).not.toContain('[!warning]');
  });

  it('블록 ID는 숨기고 속성으로', () => {
    const html = renderNote('문단입니다 ^abc-1');
    expect(html).toContain('data-block-id="abc-1"');
    expect(html).not.toContain('^abc-1');
  });

  it('수식과 코드 안의 기호는 건드리지 않음', () => {
    const html = renderNote('값 $x^2$ 입니다\n\n```js\nconst a = "==no==";\n```');
    expect(html).toContain('data-tex="x^2"');
    expect(html).toContain('==no==');
  });

  it('태그는 링크로, 코드·URL·제목 기호는 그대로', () => {
    const html = renderNote('# 제목\n본문 #업무/회의 C#언어 `#코드` https://a.com/#x');
    expect(html).toContain('data-tag="업무/회의"');
    expect((html.match(/class="tag"/g) ?? []).length).toBe(1);
    expect(html).toContain('<code>#코드</code>');
  });

  it('스크립트는 제거된다', () => {
    const html = renderNote('<script>alert(1)</script><img src=x onerror="alert(1)">');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
  });
});

describe('splitFrontmatter', () => {
  it('오프셋 계산', () => {
    expect(splitFrontmatter('---\na: 1\n---\n본문').offset).toBe(3);
    expect(splitFrontmatter('본문').offset).toBe(0);
  });
});
