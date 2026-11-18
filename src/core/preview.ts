// 목록 카드에 보여 줄 본문 미리보기와 썸네일을 만든다.

const PREVIEW_LEN = 240;

/** 마크다운 기호를 대략 걷어 내고 앞부분 텍스트만 남긴다 */
export function makePreview(text: string): string {
  let body = text;
  // YAML frontmatter 제거
  body = body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  // 코드 블록 울타리 줄 제거(내용은 남김)
  body = body.replace(/^\s*(```|~~~).*$/gm, '');
  // 표: 구분 줄(| --- |) 제거, 칸 구분 기호는 공백으로
  body = body
    .replace(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/gm, '')
    .replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_, row: string) => row.split('|').map((c) => c.trim()).join('  '));
  const out = body
    .replace(/!\[\[[^\]]*\]\]/g, '') // 임베드
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // 이미지
    .replace(/\[\[([^\]|#^]*)(?:[#^][^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, n, alias) => alias || n)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 링크 → 텍스트
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // 제목 기호
    .replace(/^\s*>\s?(\[![^\]]*\][+-]?\s*)?/gm, '') // 인용/콜아웃
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '') // 체크박스
    .replace(/^\s*([-*+]|\d+[.)])\s+/gm, '') // 목록 기호
    .replace(/(\*\*|__|==|~~|`)/g, '')
    .replace(/\s\^[A-Za-z0-9-]+$/gm, '') // 블록 ID
    .replace(/\s+/g, ' ')
    .trim();
  return out.slice(0, PREVIEW_LEN);
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

/** 본문의 첫 번째 이미지 임베드 파일 이름 */
export function firstImage(text: string): string | undefined {
  const re = /!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const name = m[1].trim();
    if (IMAGE_EXT.test(name)) return name;
  }
  return undefined;
}
