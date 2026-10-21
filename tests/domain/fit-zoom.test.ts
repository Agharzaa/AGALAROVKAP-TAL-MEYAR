/**
 * The page grows with the window (0.7.1 design): readable on a large monitor, nothing
 * cut off on a laptop. The user's own zoom (Ctrl + / −) multiplies this factor.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fitZoom } from '../../src/main/fit-zoom.js';

test('laptop widths keep the design size', () => {
  for (const width of [1280, 1366, 1440, 1536, 1600, 1760])
    assert.equal(fitZoom(width), 1, `${width}`);
});

test('a full HD monitor at 100% scaling gets slightly larger text (and still more rows), a wide one more, with a cap', () => {
  assert.equal(fitZoom(1920), 1.05);
  assert.equal(fitZoom(2100), 1.15);
  assert.equal(fitZoom(2560), 1.25);
  assert.equal(fitZoom(3840), 1.25);
});

test('a narrow window is fitted slightly smaller so the menu and forms are not cut off', () => {
  assert.equal(fitZoom(1024), 0.9);
  assert.equal(fitZoom(1150), 0.9);
});

test('the factor moves in 0.05 steps, so resizing does not shimmer', () => {
  for (let w = 1000; w <= 4000; w += 7) {
    const f = fitZoom(w);
    assert.equal(Math.round(f * 20), f * 20, `${w} → ${f}`);
  }
});
