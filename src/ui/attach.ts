// 첨부파일 넣기 흐름: 파일 고르기 → (큰 이미지면 줄이기) → 저장 → 노트에 넣을 텍스트 만들기
import { formatBytes, kindOf, stemOf } from '../core/attachments';
import type { AttachmentMeta } from '../core/types';
import { imageInfo, isLarge, shrinkImage } from '../media/image';
import { dialogs } from './dialogs.svelte';
import type { AppStore } from './state.svelte';

const WARN_SIZE = 100 * 1024 * 1024;

/** 파일 선택 창 열기. capture를 주면 폰에서 카메라가 바로 열린다. */
export function pickFiles(accept: string, opts: { multiple?: boolean; capture?: 'environment' | 'user' } = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = opts.multiple ?? true;
    if (opts.capture) input.setAttribute('capture', opts.capture);
    input.style.display = 'none';
    let done = false;
    const finish = (files: File[]) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => finish([...(input.files ?? [])]));
    input.addEventListener('cancel', () => finish([]));
    document.body.append(input);
    input.click();
  });
}

/** 파일들을 첨부로 저장한다. 저장된 첨부 목록을 돌려준다(취소·실패한 것은 빠짐). */
export async function saveFiles(app: AppStore, files: File[]): Promise<AttachmentMeta[]> {
  const saved: AttachmentMeta[] = [];
  for (const file of files) {
    try {
      if (file.size > WARN_SIZE) {
        const ok = await dialogs.confirm(
          '큰 파일',
          `"${file.name}"은(는) ${formatBytes(file.size)}입니다. 구글드라이브 업로드와 다른 기기 동기화에 시간이 걸릴 수 있습니다. 그래도 넣을까요?`,
          { okLabel: '넣기' },
        );
        if (!ok) continue;
      }
      let blob: Blob = file;
      let name = file.name;
      let width: number | undefined;
      let height: number | undefined;
      if (file.type.startsWith('image/')) {
        const info = await imageInfo(file);
        width = info?.width;
        height = info?.height;
        if (isLarge(file, info)) {
          let shrink = app.device.imageResize === 'auto';
          if (app.device.imageResize === 'ask') {
            shrink = await dialogs.confirm(
              '큰 이미지',
              `${file.name || '붙여넣은 이미지'} (${info!.width}×${info!.height}, ${formatBytes(file.size)})\n` +
                '긴 변 2048px로 줄여서 넣을까요? 용량이 크게 줄어 동기화가 빨라집니다.\n(설정에서 항상 줄이기/원본 유지를 고를 수 있습니다)',
              { okLabel: '줄여서 넣기', cancelLabel: '원본 그대로' },
            );
          }
          if (shrink) {
            const r = await shrinkImage(file);
            if (r.ext) {
              blob = r.blob;
              width = r.width;
              height = r.height;
              name = `${stemOf(file.name || 'image')}.${r.ext}`;
            }
          }
        }
      }
      const meta = await app.repo.addAttachment(blob, name, { mime: blob.type || file.type, width, height });
      saved.push(meta);
    } catch (e) {
      app.fail(e);
    }
  }
  return saved;
}

/** 노트에 넣을 텍스트: 이미지·PDF·오디오·비디오는 임베드, 그 밖은 링크 */
export function embedMarkup(att: AttachmentMeta): string {
  const kind = kindOf(att.name);
  return kind === 'file' ? `[[${att.name}]]` : `![[${att.name}]]`;
}
