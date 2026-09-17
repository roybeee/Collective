import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const { version } = JSON.parse(readFileSync(new URL('node_modules/pdfjs-dist/package.json', root), 'utf8'));
const directory = new URL('public/vendor/', root);
mkdirSync(directory, { recursive: true });
// A static asset avoids dev-server DOM instrumentation inside a Web Worker.
copyFileSync(new URL('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', root), new URL(`archive-pdf.worker-${version}.mjs`, directory));
