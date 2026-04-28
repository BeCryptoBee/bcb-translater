// Render the chosen logo SVG to PNG icons at 16/32/48/128 px.
// Run via: pnpm icons (from extension/)
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(__dirname, '..', '..', 'design', 'logos', 'option-1-globe.svg');
const OUT_DIR = resolve(__dirname, '..', 'public', 'icons');
const SIZES = [16, 32, 48, 128];

const svg = readFileSync(SOURCE);
for (const size of SIZES) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
  const png = r.render().asPng();
  const out = resolve(OUT_DIR, `${size}.png`);
  writeFileSync(out, png);
  // eslint-disable-next-line no-console
  console.log(`✓ ${size}.png (${png.byteLength} bytes)`);
}
