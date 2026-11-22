/**
 * Draws an invented object from its blueprint: a base shape plus details,
 * in the same pixel style as everything else. Used in the world and for the
 * approval preview in the comm box.
 */
import type { PublicBlueprint } from '@blurb/shared';
import { type Ctx, dark, disc, dot, ellipse, ink, light, outlinedRect, rect } from './pixel.js';

const ITEM_COLORS = ['#e8303a', '#3f7fdc', '#f5d442', '#4caf50', '#9b59d0', '#f39c34'];

export function drawBlueprint(ctx: Ctx, bp: PublicBlueprint, x: number, floorY: number, color = bp.color) {
  const has = (d: string) => bp.details.includes(d as never);
  const W = bp.width;
  const legs = has('legs') && bp.base !== 'table' ? 3 : 0;
  const H = bp.height - legs;
  const top = floorY - bp.height;
  const a = bp.accent;
  const c = color;

  if (legs) {
    rect(ctx, x + 1, floorY - legs, 2, legs, ink(c));
    rect(ctx, x + W - 3, floorY - legs, 2, legs, ink(c));
  }

  switch (bp.base) {
    case 'round': {
      ellipse(ctx, x + W / 2, top + H / 2 + 1, W / 2, H / 2, ink(c));
      ellipse(ctx, x + W / 2, top + H / 2 + 1, W / 2 - 1, H / 2 - 1, c);
      ellipse(ctx, x + W / 2 - W / 6, top + H / 3, Math.max(1, W / 6), Math.max(1, H / 6), light(c, 0.18));
      break;
    }
    case 'table': {
      outlinedRect(ctx, x, top, W, Math.min(4, H), c, ink(c));
      rect(ctx, x + 1, top + 1, W - 2, 1, light(c));
      rect(ctx, x + 2, top + 4, 2, bp.height - 4, dark(c));
      rect(ctx, x + W - 4, top + 4, 2, bp.height - 4, dark(c));
      break;
    }
    case 'shelf': {
      outlinedRect(ctx, x, top, W, H, c, ink(c));
      rect(ctx, x + 2, top + 2, W - 4, H - 4, dark(c, 0.22));
      const rows = Math.max(1, Math.floor((H - 4) / 9));
      for (let r = 0; r < rows; r++) {
        const sy = top + 2 + (r + 1) * ((H - 4) / rows) - 1;
        rect(ctx, x + 1, sy, W - 2, 1, light(c, 0.05));
        for (let ix = x + 3, i = r; ix < x + W - 5; ix += 5, i++) rect(ctx, ix, sy - 4, 3, 4, ITEM_COLORS[i % ITEM_COLORS.length]);
      }
      break;
    }
    case 'chest': {
      outlinedRect(ctx, x, top + 3, W, H - 3, c, ink(c));
      // curved lid
      rect(ctx, x + 1, top + 1, W - 2, 3, ink(c));
      rect(ctx, x + 2, top, W - 4, 1, ink(c));
      rect(ctx, x + 2, top + 1, W - 4, 2, light(c, 0.06));
      rect(ctx, x + 1, top + 4, W - 2, 1, a);
      rect(ctx, x + W / 2 - 1, top + 4, 3, 3, a); // latch
      break;
    }
    default: {
      // box / cabinet / tall
      outlinedRect(ctx, x, top, W, H, c, ink(c));
      rect(ctx, x + 1, top + 1, W - 2, 1, light(c));
      rect(ctx, x + W - 2, top + 1, 1, H - 2, dark(c, 0.1));
      if (bp.base === 'tall') rect(ctx, x - 1, top, W + 2, 2, ink(c)); // crown
    }
  }

  // details
  if (has('lid') && bp.base !== 'chest') {
    rect(ctx, x - 1, top - 1, W + 2, 3, ink(a));
    rect(ctx, x, top, W, 1, a);
  }
  if (has('stripes')) for (let y = top + 4; y < floorY - legs - 2; y += 5) rect(ctx, x + 1, y, W - 2, 1, a);
  if (has('window')) {
    const ww = Math.max(4, Math.floor(W / 3));
    outlinedRect(ctx, x + Math.floor((W - ww) / 2), top + 3, ww, Math.max(4, Math.floor(H / 4)), '#bfe6f5', ink(c));
    dot(ctx, x + Math.floor((W - ww) / 2) + 1, top + 4, '#ffffff');
  }
  if (has('shelves') && bp.base !== 'shelf') {
    for (let y = top + Math.floor(H / 3); y < floorY - legs - 3; y += Math.max(5, Math.floor(H / 3))) rect(ctx, x + 2, y, W - 4, 1, dark(c, 0.2));
  }
  if (has('drawers')) {
    const n = Math.max(1, Math.min(4, Math.floor(H / 7)));
    const dh = Math.floor((H - 2) / n);
    for (let i = 0; i < n; i++) {
      const dy = top + 1 + i * dh;
      rect(ctx, x + 2, dy + dh - 1, W - 4, 1, ink(c));
      rect(ctx, x + W / 2 - 1, dy + Math.floor(dh / 2), 3, 1, a);
    }
  }
  if (has('doors')) {
    rect(ctx, x + Math.floor(W / 2), top + 2, 1, H - 3, ink(c));
    rect(ctx, x + Math.floor(W / 2) - 2, top + Math.floor(H / 2), 1, 2, a);
    rect(ctx, x + Math.floor(W / 2) + 2, top + Math.floor(H / 2), 1, 2, a);
  }
  if (has('handles')) {
    rect(ctx, x - 1, top + Math.floor(H / 2), 1, 3, a);
    rect(ctx, x + W, top + Math.floor(H / 2), 1, 3, a);
  }
  if (has('knobs')) for (let kx = x + 3; kx < x + W - 2; kx += Math.max(4, Math.floor(W / 3))) disc(ctx, kx, top + 3, 1, a);
  if (has('cushion')) {
    ellipse(ctx, x + W / 2, top, W / 2 - 1, 2, ink(a));
    ellipse(ctx, x + W / 2, top, W / 2 - 2, 1, a);
  }
}
