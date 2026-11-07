import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { copyFile } from 'node:fs/promises';

const output = new URL('../dist/', import.meta.url);
await mkdir(new URL('server/', output), { recursive: true });
await mkdir(new URL('.openai/', output), { recursive: true });
const read = (name) => readFile(new URL('../' + name, import.meta.url), 'utf8');
const files = {
  '/': ['text/html; charset=utf-8', 'web/index.html'],
  '/styles.css': ['text/css; charset=utf-8', 'web/styles.css'],
  '/app.js': ['text/javascript; charset=utf-8', 'web/app.js'],
  '/mark.svg': ['image/svg+xml', 'web/mark.svg'],
};
const assets = Object.fromEntries(await Promise.all(
  Object.entries(files).map(async ([path, [type, name]]) => [path, { type, body: await read(name) }])
));
assets['/app.js'].body += '\n' + await read('web/equipment.js') + '\nselectView();\nload();';
const [library, fontkit, domain, equipment, pdf, worker] = await Promise.all(
  ['node_modules/pdf-lib/dist/pdf-lib.min.js', 'node_modules/@pdf-lib/fontkit/dist/fontkit.umd.min.js', 'worker/domain.js', 'worker/equipment.js', 'worker/report.js', 'worker/index.js'].map(read)
);
const fontData = await Promise.all(['400', '700'].map(async (weight) => {
  const bytes = await readFile(new URL('../node_modules/@fontsource/open-sans/files/open-sans-latin-' + weight + '-normal.woff', import.meta.url));
  return bytes.toString('base64');
}));
const commonJs = (name, code) =>
  'const ' + name + ' = { exports: {} };\n((module, exports) => {\n' + code +
  '\n})(' + name + ', ' + name + '.exports);';
await writeFile(new URL('server/index.js', output), [
  'const assets = ' + JSON.stringify(assets) + ';',
  commonJs('pdfModule', library),
  commonJs('fontModule', fontkit),
  'const fontData = ' + JSON.stringify(fontData) + ';',
  domain, equipment, pdf, worker
].join('\n\n'));
try {
  await copyFile(new URL('../.openai/hosting.json', import.meta.url), new URL('.openai/hosting.json', output));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
