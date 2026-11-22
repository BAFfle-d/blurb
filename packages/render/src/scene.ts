/** The house + yard backdrop, with a real-time day/night cycle. */
import { WORLD, hexToRgb, rgbToHex } from '@blurb/shared';
import { type Ctx, dark, disc, dot, ellipse, hash01, light, rect } from './pixel.js';

const { width: W, height: H, floorY: FLOOR, ceilingY: CEIL, doorX: DOOR, houseX: HOUSE, backDoorX: BACK, fieldX: FIELD, viewWidth: VIEW } = WORLD;

type Key = [hour: number, top: string, bottom: string];
const SKY: Key[] = [
  [0, '#0a0f2c', '#1a2350'],
  [4.5, '#0d1335', '#25306a'],
  [6, '#f28a6a', '#ffd6a0'],
  [7.5, '#78c8f8', '#cdeeff'],
  [16.5, '#6ec0f8', '#d2f0ff'],
  [18.5, '#ff8a65', '#ffd180'],
  [20, '#3b2a6a', '#b06a8a'],
  [21.5, '#0d1335', '#25306a'],
  [24, '#0a0f2c', '#1a2350'],
];

function lerpHex(a: string, b: string, t: number) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

export function skyColors(hour: number): [string, string] {
  const h = ((hour % 24) + 24) % 24;
  for (let i = 0; i < SKY.length - 1; i++) {
    const [h0, t0, b0] = SKY[i];
    const [h1, t1, b1] = SKY[i + 1];
    if (h >= h0 && h <= h1) {
      const t = (h - h0) / (h1 - h0 || 1);
      return [lerpHex(t0, t1, t), lerpHex(b0, b1, t)];
    }
  }
  return [SKY[0][1], SKY[0][2]];
}

/** 0 = full day, 1 = full night. */
export function nightFactor(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h < 4.5 || h >= 21) return 1;
  if (h < 6.5) return 1 - (h - 4.5) / 2;
  if (h < 18.5) return 0;
  return (h - 18.5) / 2.5;
}

function drawSky(ctx: Ctx, x: number, y: number, w: number, h: number, hour: number, t: number) {
  const [top, bottom] = skyColors(hour);
  const bands = 12;
  for (let i = 0; i < bands; i++) {
    rect(ctx, x, y + (h * i) / bands, w, h / bands + 1, lerpHex(top, bottom, i / (bands - 1)));
  }
  const night = nightFactor(hour);
  if (night > 0.3) {
    for (let i = 0; i < 40; i++) {
      const sx = hash01(i * 3.3) * W;
      const sy = hash01(i * 7.1) * (FLOOR - 40);
      if (sx < x || sx > x + w || sy < y || sy > y + h) continue;
      const tw = Math.sin(t * 2 + i) > 0.6 ? 1 : 0.6;
      ctx.globalAlpha = (night - 0.3) * tw;
      dot(ctx, sx, sy, '#ffffff');
      ctx.globalAlpha = 1;
    }
  }
}

/** Sun/moon arc across whatever part of the sky is in view (it doesn't scroll away). */
function celestial(ctx: Ctx, hour: number, camX: number) {
  const h = ((hour % 24) + 24) % 24;
  const isDay = h >= 6 && h < 19;
  const span = isDay ? (h - 6) / 13 : ((h + 24 - 19) % 24) / 11;
  const cx = camX + 30 + span * (VIEW - 60);
  const cy = 70 - Math.sin(span * Math.PI) * 48;
  if (isDay) {
    disc(ctx, cx, cy, 9, '#fff3b0');
    disc(ctx, cx, cy, 7, '#ffe066');
  } else {
    disc(ctx, cx, cy, 7, '#f2f0e6');
    disc(ctx, cx + 3, cy - 2, 6, skyColors(hour)[0]);
  }
}

function clouds(ctx: Ctx, t: number, night: number) {
  const c = night > 0.5 ? '#3a4270' : '#ffffff';
  for (let i = 0; i < 4; i++) {
    const speed = 2 + i * 0.7;
    const x = ((hash01(i) * W + t * speed) % (W + 80)) - 40;
    const y = 18 + hash01(i * 9) * 50;
    ctx.globalAlpha = 0.85;
    ellipse(ctx, x, y, 12, 4, c);
    ellipse(ctx, x + 9, y - 3, 8, 4, c);
    ellipse(ctx, x - 8, y + 1, 7, 3, c);
    ctx.globalAlpha = 1;
  }
}

function outdoors(ctx: Ctx, hour: number, t: number, camX: number) {
  const night = nightFactor(hour);
  celestial(ctx, hour, camX);
  clouds(ctx, t, night);
  // hills along the whole horizon (the building covers its part)
  const hill = night > 0.5 ? '#1e3b3a' : '#7ccf8a';
  const hill2 = night > 0.5 ? '#173230' : '#68b878';
  for (let x = 0; x < W; x++) {
    const far = 26 + Math.sin(x * 0.013 + 1) * 10;
    rect(ctx, x, FLOOR - far, 1, far, hill2);
    const hgt = 18 + Math.sin(x * 0.03) * 8 + Math.sin(x * 0.011 + 2) * 6;
    rect(ctx, x, FLOOR - hgt, 1, hgt, hill);
  }
  const fence = night > 0.5 ? '#6b6058' : '#e9dcc5';
  const fenceRun = (x0: number, x1: number) => {
    for (let x = x0 + 6; x < x1; x += 9) {
      rect(ctx, x, FLOOR - 24, 5, 24, dark(fence, 0.1));
      rect(ctx, x + 1, FLOOR - 25, 3, 24, fence);
    }
    rect(ctx, x0, FLOOR - 19, x1 - x0, 3, fence);
    rect(ctx, x0, FLOOR - 9, x1 - x0, 3, fence);
  };
  fenceRun(0, BACK); // back yard
  fenceRun(DOOR, FIELD); // front yard
  // field: a gate post, then open meadow with a worn path to the playground
  rect(ctx, FIELD - 2, FLOOR - 30, 5, 30, dark(fence, 0.15));
  rect(ctx, FIELD - 1, FLOOR - 31, 3, 30, fence);
  // ground everywhere outside
  for (const [x0, x1] of [[0, BACK], [DOOR, W]] as Array<[number, number]>) {
    rect(ctx, x0, FLOOR, x1 - x0, H - FLOOR, '#8b5e3c');
    rect(ctx, x0, FLOOR, x1 - x0, 4, '#5cb85c');
    rect(ctx, x0, FLOOR, x1 - x0, 1, '#7fd07f');
    for (let i = 0; i < (x1 - x0) / 6; i++) {
      const gx = x0 + hash01(i * 1.9 + x0) * (x1 - x0);
      dot(ctx, gx, FLOOR - 1, '#5cb85c');
      dot(ctx, gx + 2, FLOOR + 6 + hash01(i + x0) * 16, '#7a5230');
    }
  }
  // a sandy patch under the playground
  ellipse(ctx, FIELD + 140, FLOOR + 2, 110, 2, night > 0.5 ? '#7a6a48' : '#e6cf8f');
  // little tufts of meadow grass in the field
  for (let i = 0; i < 40; i++) {
    const gx = FIELD + 8 + hash01(i * 3.7) * (W - FIELD - 16);
    rect(ctx, gx, FLOOR - 3, 1, 3, '#4c9f4c');
    rect(ctx, gx + 2, FLOOR - 2, 1, 2, '#4c9f4c');
  }
}

/** The storage room: plank walls, shelves of jars and boxes, and the back door. */
function storageRoom(ctx: Ctx, hour: number, t: number) {
  const x0 = BACK;
  const x1 = HOUSE;
  const plank = '#d9b98a';
  rect(ctx, x0, CEIL, x1 - x0, FLOOR - CEIL, plank);
  for (let x = x0 + 4; x < x1; x += 12) rect(ctx, x, CEIL, 1, FLOOR - CEIL, '#c4a272');
  for (let y = CEIL + 16; y < FLOOR; y += 22) rect(ctx, x0, y, x1 - x0, 1, '#c9a878');
  // a small high window
  rect(ctx, x0 + 92, CEIL + 14, 26, 20, '#7a5230');
  drawSky(ctx, x0 + 94, CEIL + 16, 22, 16, hour, t);
  rect(ctx, x0 + 104, CEIL + 16, 2, 16, '#f4efe6');
  // wall shelves stocked with jars, boxes and tins
  const JARS = ['#e8303a', '#f5d442', '#80d0f8', '#7fe0b0', '#c3a6f0', '#f39c34'];
  for (const [sy, sx0, sx1] of [[CEIL + 56, x0 + 14, x0 + 84], [CEIL + 86, x0 + 14, x0 + 84], [CEIL + 70, x0 + 96, x1 - 10]] as Array<[number, number, number]>) {
    rect(ctx, sx0, sy, sx1 - sx0, 3, '#8d5a3b');
    rect(ctx, sx0 + 2, sy + 3, 2, 5, '#7a5230');
    rect(ctx, sx1 - 4, sy + 3, 2, 5, '#7a5230');
    let x = sx0 + 3;
    let i = Math.floor(sy + sx0);
    while (x < sx1 - 6) {
      const kind = i % 3;
      const c = JARS[i % JARS.length];
      if (kind === 0) {
        rect(ctx, x, sy - 7, 5, 7, '#bfe6f5');
        rect(ctx, x + 1, sy - 4, 3, 4, c);
        rect(ctx, x, sy - 8, 5, 1, '#8c96a0');
        x += 7;
      } else if (kind === 1) {
        rect(ctx, x, sy - 8, 9, 8, '#b88a5b');
        rect(ctx, x, sy - 8, 9, 1, '#d2a874');
        rect(ctx, x + 3, sy - 5, 3, 1, '#7a5230');
        x += 11;
      } else {
        rect(ctx, x, sy - 6, 6, 6, c);
        rect(ctx, x, sy - 6, 6, 1, light(c, 0.2));
        x += 8;
      }
      i++;
    }
  }
  // floor
  rect(ctx, x0, FLOOR, x1 - x0, H - FLOOR, '#9c6b40');
  for (let y = FLOOR + 6; y < H; y += 7) rect(ctx, x0, y, x1 - x0, 1, '#7a5230');
  // back door, propped open to the back yard
  rect(ctx, x0 - 3, FLOOR - 52, 9, 52, '#7a5230');
  rect(ctx, x0 - 1, FLOOR - 50, 5, 50, '#8d5a3b');
  rect(ctx, x0 + 6, FLOOR - 50, 14, 48, '#a0703c');
  rect(ctx, x0 + 7, FLOOR - 49, 12, 46, '#b88a5b');
  rect(ctx, x0 + 9, FLOOR - 44, 8, 12, '#a0703c');
  rect(ctx, x0 + 9, FLOOR - 28, 8, 14, '#a0703c');
  dot(ctx, x0 + 17, FLOOR - 26, '#e0b23a');
}

/** The main room (the original house), drawn in its own coordinates and shifted into place. */
function mainRoom(ctx: Ctx, hour: number, t: number) {
  const wall = '#f3e3c3';
  const stripe = '#ebd6ae';
  const R = DOOR - HOUSE; // room width
  ctx.save();
  ctx.translate(HOUSE, 0);
  rect(ctx, 0, CEIL, R, FLOOR - CEIL, wall);
  for (let x = 6; x < R; x += 10) rect(ctx, x, CEIL, 3, FLOOR - CEIL, stripe);
  rect(ctx, 0, FLOOR - 30, R, 30, '#c99a6b');
  rect(ctx, 0, FLOOR - 30, R, 2, '#a97a4b');
  for (let x = 8; x < R - 10; x += 24) {
    rect(ctx, x, FLOOR - 24, 18, 18, '#b88a5b');
    rect(ctx, x + 1, FLOOR - 23, 16, 16, '#c99a6b');
  }
  rect(ctx, 0, FLOOR - 4, R, 4, '#7a5230');
  for (const [wx, wy] of [[84, 126], [236, 124]] as Array<[number, number]>) {
    rect(ctx, wx - 2, wy - 2, 38, 34, '#7a5230');
    drawSky(ctx, wx, wy, 34, 30, hour, t);
    rect(ctx, wx + 16, wy, 2, 30, '#f4efe6');
    rect(ctx, wx, wy + 14, 34, 2, '#f4efe6');
    rect(ctx, wx - 4, wy + 30, 42, 3, '#8d5a3b');
    rect(ctx, wx - 3, wy - 3, 6, 30, '#e8a0b8');
    rect(ctx, wx + 31, wy - 3, 6, 30, '#e8a0b8');
    rect(ctx, wx - 3, wy - 3, 6, 2, '#d0809a');
  }
  rect(ctx, 182, 140, 20, 18, '#e0b23a');
  rect(ctx, 184, 142, 16, 14, '#fff6e0');
  ellipse(ctx, 192, 151, 5, 4, '#ff0a28');
  dot(ctx, 190, 150, '#3a0008');
  dot(ctx, 194, 150, '#3a0008');
  clock(ctx, 150, 120, hour);
  rect(ctx, 228, 114, 44, 3, '#8d5a3b');
  rect(ctx, 232, 108, 6, 6, '#d2734a');
  ellipse(ctx, 235, 106, 4, 2, '#4caf50');
  rect(ctx, 252, 107, 6, 7, '#bfe6f5');
  rect(ctx, 252, 106, 6, 1, '#e0b23a');
  rect(ctx, 262, 109, 3, 5, '#e8303a');
  rect(ctx, 265, 108, 3, 6, '#3f7fdc');
  // the wall to the storage room has an open doorway at the bottom
  rect(ctx, -3, CEIL - 4, 6, FLOOR - CEIL - 52 + 4, '#8d5a3b');
  rect(ctx, -5, FLOOR - 52, 10, 4, '#7a5230');
  // front door frame (open doorway to the yard)
  rect(ctx, R - 4, CEIL - 4, 8, FLOOR - CEIL - 48, '#8d5a3b');
  rect(ctx, R - 6, FLOOR - 52, 12, 4, '#7a5230');
  rect(ctx, R - 4, FLOOR - 48, 2, 48, '#7a5230');
  rect(ctx, 0, FLOOR, R, H - FLOOR, '#b07a4a');
  for (let y = FLOOR + 6; y < H; y += 7) rect(ctx, 0, y, R, 1, '#8d5a3b');
  for (let i = 0; i < 18; i++) {
    const y = FLOOR + 1 + Math.floor(i / 6) * 7;
    rect(ctx, (i * 53 + Math.floor(i / 6) * 25) % R, y, 1, 6, '#8d5a3b');
  }
  rect(ctx, 0, FLOOR, R, 1, light('#b07a4a', 0.08));
  ctx.restore();
}

/** One roof over the storage room and the main room. */
function roof(ctx: Ctx) {
  rect(ctx, BACK - 4, CEIL - 4, DOOR - BACK + 10, 6, '#7a5230');
  const c = '#c0504d';
  const span = DOOR - BACK;
  for (let i = 0; i < 40; i++) {
    const y = CEIL - 5 - i;
    const inset = i * 1.6;
    if (inset * 2 > span) break;
    rect(ctx, BACK - 6 + inset, y, span + 18 - inset * 2, 1, i % 4 === 0 ? dark(c, 0.1) : c);
  }
  rect(ctx, HOUSE + 220, 50, 14, 24, '#9a5a40');
  rect(ctx, HOUSE + 218, 48, 18, 4, '#7a3a28');
}

/** Everything behind objects and the pet. `camX` keeps the sun put while the view scrolls. */
export function drawBackdrop(ctx: Ctx, hour: number, t: number, camX = 0) {
  drawSky(ctx, 0, 0, W, FLOOR, hour, t);
  outdoors(ctx, hour, t, camX);
  storageRoom(ctx, hour, t);
  mainRoom(ctx, hour, t);
  roof(ctx);
}

/** Wall clock showing the real local time. */
function clock(ctx: Ctx, cx: number, cy: number, hour: number) {
  disc(ctx, cx, cy, 8, '#7a5230');
  disc(ctx, cx, cy, 7, '#fff6e0');
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    dot(ctx, cx + Math.sin(a) * 6, cy - Math.cos(a) * 6, i % 3 === 0 ? '#3a2a1a' : '#c9b89a');
  }
  const hand = (frac: number, len: number, color: string) => {
    const a = frac * Math.PI * 2;
    for (let r = 0; r <= len; r += 0.5) dot(ctx, cx + Math.sin(a) * r, cy - Math.cos(a) * r, color);
  };
  hand((hour % 12) / 12, 3.5, '#3a2a1a');
  hand(hour % 1, 5.5, '#c0504d');
  dot(ctx, cx, cy, '#3a2a1a');
}

/** Darkness pass applied after objects + pet are drawn. */
export function drawNightShade(ctx: Ctx, hour: number, lampXs: number[]) {
  const night = nightFactor(hour);
  if (night <= 0) return;
  ctx.fillStyle = `rgba(10,14,40,${0.42 * night})`;
  ctx.fillRect(0, 0, W, H);
  // warm pools around lamps (drawn after darkness so they read as light)
  for (const lx of lampXs) {
    const g = (ctx as CanvasRenderingContext2D).createRadialGradient?.(lx + 6, FLOOR - 38, 2, lx + 6, FLOOR - 20, 60);
    if (!g) continue;
    g.addColorStop(0, `rgba(255,210,130,${0.28 * night})`);
    g.addColorStop(1, 'rgba(255,210,130,0)');
    ctx.fillStyle = g;
    ctx.fillRect(lx - 60, FLOOR - 100, 130, 110);
  }
}
