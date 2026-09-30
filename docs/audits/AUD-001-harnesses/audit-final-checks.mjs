import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { encodeMnemonic, parseDate, formatEncoded } from './dist/core.js';
const root = '/tmp/mnemocode-aud-001/evidence';
const result = {};
const dates = ['31-10-2008', '03-01-2009', '12-01-2009', '22-05-2010'].map(parseDate);
const colors = formatEncoded(
  encodeMnemonic('abandon '.repeat(11) + 'about', dates),
  'colors',
).split(' ');
result.png = [];
const names = (await readdir(root + '/png-cards')).sort();
for (const [index, name] of names.entries()) {
  const path = root + '/png-cards/' + name;
  const png = PNG.sync.read(await readFile(path));
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height, {
    inversionAttempts: 'dontInvert',
  })?.data;
  const expected = colors.slice(index * 6, (index + 1) * 6).join(' ');
  result.png.push({
    name,
    width: png.width,
    height: png.height,
    mode: ((await stat(path)).mode & 0o777).toString(8),
    decoded,
    expected,
    matches: decoded === expected,
  });
}
result.jpg = [];
for (const name of (await readdir(root + '/jpg-pages')).sort()) {
  const path = root + '/jpg-pages/' + name;
  const bytes = await readFile(path);
  result.jpg.push({
    name,
    isJpeg: bytes[0] === 255 && bytes[1] === 216,
    mode: ((await stat(path)).mode & 0o777).toString(8),
  });
}
result.directoryModes = {
  png: ((await stat(root + '/png-cards')).mode & 0o777).toString(8),
  jpg: ((await stat(root + '/jpg-pages')).mode & 0o777).toString(8),
};
await writeFile(root + '/image-export-verification.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
