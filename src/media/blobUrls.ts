// 첨부파일 blob URL 캐시. 같은 파일은 URL 하나를 재사용하고, 내용이 바뀌면 새로 만든다.
const urls = new Map<string, { url: string; size: number; updated: number }>();

export function blobUrlFor(id: string, blob: Blob, updated: number): string {
  const hit = urls.get(id);
  if (hit && hit.updated === updated && hit.size === blob.size) return hit.url;
  if (hit) URL.revokeObjectURL(hit.url);
  const url = URL.createObjectURL(blob);
  urls.set(id, { url, size: blob.size, updated });
  return url;
}

export function revokeAll() {
  for (const { url } of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
}
