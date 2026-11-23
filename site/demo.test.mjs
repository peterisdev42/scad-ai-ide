import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Pages cheese STL is a complete binary triangle mesh', () => {
  const data = readFileSync(new URL('./assets/cheese.stl', import.meta.url));
  assert.ok(data.byteLength > 84, 'binary STL has 80-byte header and count');
  const count = data.readUInt32LE(80);
  assert.ok(count > 1000, 'the cheese model contains real triangle geometry');
  assert.equal(data.byteLength, 84 + count * 50, 'triangle count matches byte length');
  for (let offset = 84; offset < data.length; offset += 50) {
    for (let i = 0; i < 12; i++) {
      assert.ok(Number.isFinite(data.readFloatLE(offset + 4 * i)), 'all triangle coordinates and normals are finite');
    }
  }
});

test('Pages renders a real STL, without pretending to run OpenSCAD', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const js = readFileSync(new URL('./workbench.js', import.meta.url), 'utf8');
  const scad = readFileSync(new URL('./assets/cheese.scad', import.meta.url), 'utf8');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const threeVersion = pkg.dependencies?.three ?? pkg.devDependencies?.three;
  assert.ok(threeVersion, 'Three.js dependency exists');
  assert.ok(html.includes('three@' + threeVersion + '/build/three.module.js'), 'website Three.js version matches the extension');
  assert.match(html, /data-vsc-canvas/);
  assert.match(html, /data-vsc-action="measure"/);
  assert.match(html, /data-vsc-action="wireframe"/);
  assert.match(html, /data-vsc-action="perspective"/);
  assert.match(html, /data-vsc-action="orthographic"/);
  assert.match(html, /does not run|not running|not execute|not embedded|precompiled/i);
  assert.match(js, /STLLoader/);
  assert.match(js, /TrackballControls/);
  assert.match(js, /geometry\.attributes\.position\.count/);
  assert.doesNotMatch(js, /vsc-geometry|SVGElement|Simulate render/);
  assert.match(scad, /difference\(\)/);
  assert.match(scad, /sphere\(r/);
});
