// 노트 본문에서 목록·검색용 정보를 뽑는다. 결과는 로컬 캐시에만 저장되며 언제든 다시 만들 수 있다.
import { firstImage, makePreview } from './preview';
import { extractTags } from './tags';
import { linkKeys } from './links';

/** 분석 방식이 바뀌면 올린다 → 다음 실행 때 모든 노트를 다시 분석 */
export const INDEX_VERSION = 4;

export interface NoteAnalysis {
  preview: string;
  thumb?: string;
  tags: string[];
  /** 이 노트가 가리키는 노트 링크 이름(소문자, 백링크 후보 찾기용) */
  links: string[];
}

export function analyzeNote(text: string): NoteAnalysis {
  return { preview: makePreview(text), thumb: firstImage(text), tags: extractTags(text), links: linkKeys(text) };
}
