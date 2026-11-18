// 데모용 샘플 첨부파일(이미지, PDF)을 코드로 만든다. 저장소에 바이너리 파일을 두지 않기 위함.
import type { Repo } from '../store/repo';

/** 부드러운 녹색 그라데이션 샘플 이미지(PNG) */
async function makeSampleImage(): Promise<Blob> {
  const w = 1200;
  const h = 675;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#2e9e6b');
  grad.addColorStop(1, '#1f6f8b');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  // 둥근 카드 몇 개
  g.fillStyle = 'rgba(255,255,255,0.12)';
  for (const [x, y, r] of [
    [180, 160, 120],
    [980, 520, 180],
    [860, 140, 70],
  ]) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#ffffff';
  g.font = 'bold 72px system-ui, "Malgun Gothic", sans-serif';
  g.textAlign = 'center';
  g.fillText('마이노트 샘플 이미지', w / 2, h / 2);
  g.font = '32px system-ui, "Malgun Gothic", sans-serif';
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fillText('![[sample-image.png|300]] 처럼 크기를 지정할 수 있어요', w / 2, h / 2 + 64);
  return new Promise((res) => c.toBlob((b) => res(b!), 'image/png'));
}

/** 3쪽짜리 샘플 PDF(표준 글꼴 Helvetica, 영문) */
export function makeSamplePdf(): Blob {
  const pages = [
    ['MyNotes sample PDF', 'Page 1 of 3', 'Use the arrows above to move between pages.'],
    ['Page 2', 'Zoom in and out with the + and - buttons.'],
    ['Page 3', 'Link to a page: ![[sample.pdf#page=3]]'],
  ];
  const objs: string[] = [];
  const add = (s: string) => objs.push(s) && objs.length; // 객체 번호(1부터)
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(''); // 2: Pages (나중에 채움)
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids: number[] = [];
  const esc = (t: string) => t.replace(/[\\()]/g, (m) => '\\' + m);
  for (const lines of pages) {
    const ops = lines
      .map((t, i) => `BT /F1 ${i === 0 ? 28 : 16} Tf 72 ${720 - i * 44} Td (${esc(t)}) Tj ET`)
      .join('\n');
    const stream = `0.18 0.62 0.42 rg 0 760 612 32 re f 0 g\n${ops}`;
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([out], { type: 'application/pdf' });
}

/** 데모 DB에 샘플 첨부가 없으면 추가(기존 데모 사용자도 받도록 따로 표시) */
export async function seedDemoAssets(repo: Repo): Promise<void> {
  if (await repo.db.kv.get('seededAssets')) return;
  if (!(await repo.findAttachment('sample-image.png'))) {
    await repo.addAttachment(await makeSampleImage(), 'sample-image.png', { width: 1200, height: 675 });
  }
  if (!(await repo.findAttachment('sample.pdf'))) {
    await repo.addAttachment(makeSamplePdf(), 'sample.pdf');
  }
  await repo.db.kv.put({ key: 'seededAssets', value: true });
}
