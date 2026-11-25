import { mkdir, copyFile, readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
// Keep official font assets and their original license together, without a CDN.
export async function stageGeistFonts(root) {
  const source = resolve(root, 'tools/pages-workbench/node_modules/geist');
  const output = resolve(root, 'site/assets/fonts');
  await mkdir(output, { recursive: true });
  for (const [folder, name] of [['geist-sans','Geist-Variable.woff2'], ['geist-mono','GeistMono-Variable.woff2']]) {
    const input = resolve(source, 'dist/fonts', folder, name);
    const data = await readFile(input);
    if (data.subarray(0,4).toString() !== 'wOF2') throw Error('Invalid Geist WOFF2: ' + name);
    await copyFile(input, resolve(output, name));
  }
  const names = await readdir(source);
  const license = names.find(name => /^(?:license|licence|ofl)(?:\.(?:txt|md))?$/i.test(name));
  if (!license) throw Error('Geist package license not found: ' + names.join(', '));
  await copyFile(resolve(source, license), resolve(output, 'LICENSE.txt'));
}
