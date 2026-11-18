// pdf.js 보조 파일(한글 등 CJK 글꼴 매핑 cmaps, 표준 글꼴, 이미지 디코더 wasm, 색 프로필)을
// 앱과 같은 주소(/pdfjs/...)에서 제공한다. 외부 CDN을 쓰지 않기 위함.
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

const DIRS = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];
const ROOT = path.resolve('node_modules/pdfjs-dist');

const TYPES: Record<string, string> = {
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.icc': 'application/vnd.iccprofile',
};

export function pdfjsAssets(): Plugin {
  return {
    name: 'pdfjs-assets',
    // 개발 서버: /<base>/pdfjs/<폴더>/<파일> 요청을 node_modules에서 바로 응답
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /\/pdfjs\/([\w-]+)\/([^?#]+)/.exec(req.url ?? '');
        if (!m || !DIRS.includes(m[1])) return next();
        const file = path.join(ROOT, m[1], path.normalize(decodeURIComponent(m[2])));
        if (!file.startsWith(path.join(ROOT, m[1])) || !fs.existsSync(file)) return next();
        res.setHeader('Content-Type', TYPES[path.extname(file)] ?? 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
      });
    },
    // 빌드: dist/pdfjs/ 아래로 복사
    generateBundle() {
      for (const dir of DIRS) {
        const base = path.join(ROOT, dir);
        if (!fs.existsSync(base)) continue;
        for (const f of fs.readdirSync(base, { recursive: true }) as string[]) {
          const full = path.join(base, f);
          if (!fs.statSync(full).isFile()) continue;
          this.emitFile({ type: 'asset', fileName: `pdfjs/${dir}/${f.replace(/\\/g, '/')}`, source: fs.readFileSync(full) });
        }
      }
    },
  };
}
