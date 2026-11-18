// Lezer 마크다운 문법 확장: 형광펜(==), 위키링크([[ ]]), 임베드(![[ ]])
import { Tag, tags } from '@lezer/highlight';
import type { MarkdownConfig } from '@lezer/markdown';
import { readTagAt } from '../core/tags';

export const mdTags = {
  highlight: Tag.define(),
  wikilink: Tag.define(tags.link),
  hashtag: Tag.define(),
};

const HighlightDelim = { resolve: 'Highlight', mark: 'HighlightMark' };
const PUNCT = /[\p{P}\p{S}]/u;

/** ==형광펜== */
export const Highlight: MarkdownConfig = {
  defineNodes: [
    { name: 'Highlight', style: mdTags.highlight },
    { name: 'HighlightMark', style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: 'Highlight',
      parse(cx, next, pos) {
        if (next !== 61 /* = */ || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61) return -1;
        const before = cx.slice(pos - 1, pos);
        const after = cx.slice(pos + 2, pos + 3);
        const sBefore = /\s|^$/.test(before);
        const sAfter = /\s|^$/.test(after);
        const pBefore = PUNCT.test(before);
        const pAfter = PUNCT.test(after);
        return cx.addDelimiter(
          HighlightDelim,
          pos,
          pos + 2,
          !sAfter && (!pAfter || sBefore || pBefore),
          !sBefore && (!pBefore || sAfter || pAfter),
        );
      },
      after: 'Emphasis',
    },
  ],
};

/** [[노트]] / [[노트#제목|별칭]] / ![[파일]] */
export const WikiLink: MarkdownConfig = {
  defineNodes: [
    { name: 'WikiLink', style: mdTags.wikilink },
    { name: 'Embed', style: mdTags.wikilink },
    { name: 'WikiLinkMark', style: tags.processingInstruction },
    { name: 'WikiLinkTarget' },
  ],
  parseInline: [
    {
      name: 'WikiLink',
      parse(cx, next, pos) {
        let embed = false;
        if (next === 33 /* ! */ && cx.char(pos + 1) === 91 && cx.char(pos + 2) === 91) embed = true;
        else if (!(next === 91 && cx.char(pos + 1) === 91)) return -1;
        const open = pos + (embed ? 3 : 2);
        for (let i = open; i < cx.end - 1; i++) {
          const c = cx.char(i);
          if (c === 10 || c === 91) return -1; // 줄바꿈이나 [ 가 나오면 링크 아님
          if (c === 93 && cx.char(i + 1) === 93) {
            if (i === open) return -1;
            return cx.addElement(
              cx.elt(embed ? 'Embed' : 'WikiLink', pos, i + 2, [
                cx.elt('WikiLinkMark', pos, open),
                cx.elt('WikiLinkTarget', open, i),
                cx.elt('WikiLinkMark', i, i + 2),
              ]),
            );
          }
        }
        return -1;
      },
      before: 'Link',
    },
  ],
};

/** #태그 (규칙은 core/tags.ts와 같음) */
export const Hashtag: MarkdownConfig = {
  defineNodes: [{ name: 'Hashtag', style: mdTags.hashtag }],
  parseInline: [
    {
      name: 'Hashtag',
      parse(cx, next, pos) {
        if (next !== 35 /* # */) return -1;
        // 줄(인라인 구간) 텍스트 기준으로 판별
        const text = cx.slice(cx.offset, cx.end);
        const hit = readTagAt(text, pos - cx.offset);
        if (!hit) return -1;
        return cx.addElement(cx.elt('Hashtag', pos, cx.offset + hit.to));
      },
      before: 'Emphasis',
    },
  ],
};

/** 위키링크 대상 문자열을 나눈다: "노트#제목|별칭" */
export function parseWikiTarget(raw: string): { name: string; sub: string | null; alias: string | null } {
  const bar = raw.indexOf('|');
  const target = bar >= 0 ? raw.slice(0, bar) : raw;
  const alias = bar >= 0 ? raw.slice(bar + 1) : null;
  const hash = target.indexOf('#');
  return {
    name: (hash >= 0 ? target.slice(0, hash) : target).trim(),
    sub: hash >= 0 ? target.slice(hash + 1).trim() : null,
    alias: alias?.trim() || null,
  };
}
