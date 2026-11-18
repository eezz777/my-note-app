// 이미지 크기 확인과 줄이기(업로드 전). 브라우저 내장 기능(createImageBitmap, canvas)만 쓴다.

export const LARGE_SIDE = 2560; // 긴 변이 이보다 크거나
export const LARGE_BYTES = 1.5 * 1024 * 1024; // 파일이 이보다 크면 "큰 이미지"
export const TARGET_SIDE = 2048; // 줄일 때 긴 변 크기
const QUALITY = 0.85;

export interface ImageInfo {
  width: number;
  height: number;
}

export async function imageInfo(file: Blob): Promise<ImageInfo | null> {
  try {
    const bmp = await createImageBitmap(file);
    const info = { width: bmp.width, height: bmp.height };
    bmp.close();
    return info;
  } catch {
    return null; // SVG 등 비트맵으로 읽을 수 없는 형식
  }
}

/** 줄일 가치가 있는 큰 이미지인지(GIF·SVG는 움직임/벡터가 깨지므로 제외) */
export function isLarge(file: Blob, info: ImageInfo | null): boolean {
  if (!info || /gif|svg/.test(file.type)) return false;
  return Math.max(info.width, info.height) > LARGE_SIDE || file.size > LARGE_BYTES;
}

/** 긴 변을 maxSide로 줄이고 WebP(지원 안 되면 JPEG)로 압축. 오히려 커지면 원본을 돌려준다. */
export async function shrinkImage(file: Blob, maxSide = TARGET_SIDE): Promise<{ blob: Blob; width: number; height: number; ext: string }> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const toBlob = (type: string) => new Promise<Blob | null>((res) => canvas.toBlob(res, type, QUALITY));
  let blob = await toBlob('image/webp');
  let ext = 'webp';
  if (!blob || blob.type !== 'image/webp') {
    blob = await toBlob('image/jpeg');
    ext = 'jpg';
  }
  if (!blob || blob.size >= file.size) {
    const info = (await imageInfo(file)) ?? { width: w, height: h };
    return { blob: file, width: info.width, height: info.height, ext: '' };
  }
  return { blob, width: w, height: h, ext };
}
