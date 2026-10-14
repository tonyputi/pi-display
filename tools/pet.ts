/**
 * Procedural generator for the pi-display pet: draws the creature's frames and
 * prints them as ASCII (for review) or writes them to assets/pet/*.pbm.
 *
 *   node tools/pet.ts            → ASCII preview of all frames
 *   node tools/pet.ts --export   → writes assets/pet/*.pbm
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { DisplayFrame } from "../src/display.ts";

// --- creature parameters (tweak freely) ------------------------------------
const W = 34; // frame size
const H = 26;
const HEAD = { cx: 24, cy: 9, r: 7 }; // head circle
const EAR = { h: 4, w: 3 }; // ears: small triangles on top of the head
const BODY = { cx: 12, cy: 13, rx: 11, ry: 6 }; // body ellipse
const EYE = { x: 26, y: 7, w: 2, h: 2 }; // eye (dark on light head? here: lit head, dark eye = cleared)
const LEG = { w: 2, h: 6, xs: [4, 9, 17, 22] }; // four legs
const TAIL = { x: 1, y: 8 }; // tail root

type Pose = "walk0" | "walk1" | "idle" | "blink" | "sleep";

// --- drawing primitives -----------------------------------------------------
function newFrame(): DisplayFrame {
  return { width: W, height: H, pixels: new Uint8Array(W * H) };
}

function set(frame: DisplayFrame, x: number, y: number, v: 0 | 1 = 1): void {
  if (x >= 0 && y >= 0 && x < W && y < H) frame.pixels[y * W + x] = v;
}

function fillEllipse(frame: DisplayFrame, cx: number, cy: number, rx: number, ry: number): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) set(frame, x, y);
    }
  }
}

function fillCircle(frame: DisplayFrame, cx: number, cy: number, r: number): void {
  fillEllipse(frame, cx, cy, r, r);
}

function fillRect(frame: DisplayFrame, x: number, y: number, w: number, h: number, v: 0 | 1 = 1): void {
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) set(frame, x + dx, y + dy, v);
}

// --- poses ------------------------------------------------------------------
/** dx: horizontal leg stride offset, dy: body bob, legsUp: which legs are lifted. */
function drawPet({ legShift = 0, bob = 0, lifted = [] as number[], blink = false, sleeping = false, tailUp = false }): DisplayFrame {
  const f = newFrame();
  const legTop = BODY.cy + BODY.ry - 3 + bob;

  if (sleeping) {
    // Lying down: flattened body, closed eye, no legs, Zzz.
    fillEllipse(f, BODY.cx + 2, 18, BODY.rx + 2, 4);
    fillCircle(f, HEAD.cx - 2, 14, HEAD.r - 1);
    fillRect(f, HEAD.cx - 1, 13, 2, 1, 0); // closed eye
    fillRect(f, 2, 4, 1, 1); // Zzz dots
    fillRect(f, 3, 3, 1, 1);
    fillRect(f, 4, 2, 1, 1);
    return f;
  }

  // Tail: a visible curl behind the body, wagging between up and down.
  const tail = [
    [1, 8],
    [0, 6],
    [0, 4],
    [tailUp ? 2 : 1, tailUp ? 2 : 3],
  ] as const;
  for (const [tx, ty] of tail) fillRect(f, tx, ty + bob, 2, 1);

  // Body and head.
  fillEllipse(f, BODY.cx, BODY.cy + bob, BODY.rx, BODY.ry);
  fillCircle(f, HEAD.cx, HEAD.cy + bob, HEAD.r);

  // Ears: two small triangles on the head, merged into its silhouette.
  for (let i = 0; i < EAR.h; i++) {
    fillRect(f, HEAD.cx - 4 - Math.floor(i / 2), HEAD.cy - HEAD.r + bob + i, EAR.w, 1);
    fillRect(f, HEAD.cx + 1, HEAD.cy - HEAD.r + bob + i, EAR.w, 1);
  }

  // Eye (dark), or closed when blinking.
  if (blink) fillRect(f, EYE.x - 1, EYE.y + 1 + bob, 3, 1, 0);
  else fillRect(f, EYE.x, EYE.y + bob, EYE.w, EYE.h, 0);

  // Legs: lifted ones are shorter (raised by 2 px) and shifted forward.
  LEG.xs.forEach((x, i) => {
    const up = lifted.includes(i);
    fillRect(f, x + (up ? legShift : 0), legTop + bob + (up ? -2 : 0), LEG.w, up ? LEG.h - 2 : LEG.h);
  });

  return f;
}

const FRAMES: Record<Pose, DisplayFrame> = {
  walk0: drawPet({ lifted: [0, 2], tailUp: true }),
  walk1: drawPet({ lifted: [1, 3], legShift: 1, bob: -1, tailUp: false }),
  idle: drawPet({}),
  blink: drawPet({ blink: true }),
  sleep: drawPet({ sleeping: true }),
};

// --- output -----------------------------------------------------------------
function toAscii(frame: DisplayFrame): string {
  const lines: string[] = [];
  for (let y = 0; y < frame.height; y++) {
    lines.push([...frame.pixels.slice(y * frame.width, (y + 1) * frame.width)].map((p) => (p ? "█" : " ")).join("").replace(/\s+$/, ""));
  }
  return lines.filter((l, i, a) => l !== "" || (a[i - 1] ?? "") !== "").join("\n");
}

function toPbm(frame: DisplayFrame): string {
  const rows: string[] = [];
  for (let y = 0; y < frame.height; y++) {
    rows.push([...frame.pixels.slice(y * frame.width, (y + 1) * frame.width)].join(" "));
  }
  return `P1\n${frame.width} ${frame.height}\n${rows.join("\n")}\n`;
}

if (process.argv.includes("--export")) {
  const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "pet");
  mkdirSync(outDir, { recursive: true });
  for (const [name, frame] of Object.entries(FRAMES)) {
    writeFileSync(join(outDir, `${name}.pbm`), toPbm(frame));
    console.error(`wrote ${name}.pbm`);
  }
} else {
  const side = (a: string, b: string, c: string) => {
    const [la, lb, lc] = [a.split("\n"), b.split("\n"), c.split("\n")];
    const rows = Math.max(la.length, lb.length, lc.length);
    for (let i = 0; i < rows; i++) console.log((la[i] ?? "").padEnd(W + 2) + (lb[i] ?? "").padEnd(W + 2) + (lc[i] ?? ""));
  };
  console.log("walk0 / walk1 / idle:\n");
  side(toAscii(FRAMES.walk0), toAscii(FRAMES.walk1), toAscii(FRAMES.idle));
  console.log("\nidle / blink / sleep:\n");
  side(toAscii(FRAMES.idle), toAscii(FRAMES.blink), toAscii(FRAMES.sleep));
}
