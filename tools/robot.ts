/**
 * Procedural generator for the pi-display robot (Astro-style): a small floating
 * robot, always centered, with a pose per state. Prints frames as ASCII for
 * review, or writes them to assets/robot/*.pbm.
 *
 *   node tools/robot.ts            → ASCII preview of all poses
 *   node tools/robot.ts --export   → writes assets/robot/*.pbm
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { DisplayFrame } from "../src/display.ts";

const W = 56;
const H = 62;

function newFrame(): DisplayFrame {
  return { width: W, height: H, pixels: new Uint8Array(W * H) };
}

function set(f: DisplayFrame, x: number, y: number, v: 0 | 1 = 1): void {
  if (x >= 0 && y >= 0 && x < W && y < H) f.pixels[y * W + x] = v;
}

function fillRect(f: DisplayFrame, x: number, y: number, w: number, h: number, v: 0 | 1 = 1): void {
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) set(f, x + dx, y + dy, v);
}

function fillEllipse(f: DisplayFrame, cx: number, cy: number, rx: number, ry: number, v: 0 | 1 = 1): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) set(f, x, y, v);
    }
  }
}

type Pose = "idle0" | "idle1" | "think0" | "think1" | "work0" | "work1" | "sleep";

interface Options {
  blink?: boolean; // eyes closed
  reading?: boolean; // holding the book, eyes down
  pageFlip?: boolean; // book page mid-flip
  typing?: 0 | 1; // laptop in front, alternating hands
  flame?: 0 | 1; // thruster flicker frame
  sleeping?: boolean; // eyes closed, no flame, Zzz
}

function drawRobot(o: Options): DisplayFrame {
  const f = newFrame();

  // Antenna with a blinking ball.
  fillRect(f, 27, 3, 2, 3);
  if (!o.blink && !o.sleeping) fillRect(f, 25, 0, 6, 3);

  // Head with a dark visor; the eyes are lit inside it.
  fillEllipse(f, 28, 17, 13, 10);
  fillEllipse(f, 28, 18, 9, 5.5, 0);
  if (o.blink || o.sleeping) {
    fillRect(f, 21, 17, 3, 1);
    fillRect(f, 32, 17, 3, 1);
  } else {
    const eyeY = o.reading ? 16 : 14;
    fillRect(f, 22, eyeY, 2, 4);
    fillRect(f, 32, eyeY, 2, 4);
  }

  // Body and side arms (down, unless a pose replaces them).
  fillEllipse(f, 28, 35, 8, 7);
  if (!o.reading && o.typing === undefined) {
    fillRect(f, 15, 30, 3, 9);
    fillRect(f, 38, 30, 3, 9);
  }

  if (o.reading) {
    // Open book in front of the face: two pages, dark spine, text lines.
    fillRect(f, 14, 24, 13, 11);
    fillRect(f, 29, 24, 13, 11);
    fillRect(f, 25, 24, 6, 11, 0);
    for (const [px, py] of [[16, 27], [16, 30], [33, 27], [33, 30]] as const) fillRect(f, px, py, 8, 1, 0);
    if (o.pageFlip) {
      // Right page curling over: cleared diagonal + lit flap edge.
      for (let i = 0; i < 6; i++) set(f, 30 + i, 25 + i, 0);
      for (let i = 0; i < 6; i++) set(f, 31 + i, 25 + i);
    }
    // Arms up from the shoulders holding the book edges.
    fillRect(f, 16, 30, 3, 6);
    fillRect(f, 37, 30, 3, 6);
    fillRect(f, 13, 32, 3, 2);
    fillRect(f, 40, 32, 3, 2);
  }

  if (o.typing !== undefined) {
    // Laptop: lit lid on a base, hands typing on it.
    fillRect(f, 19, 27, 18, 10);
    fillRect(f, 21, 29, 14, 6, 0);
    fillRect(f, 21, 29, 14, 1);
    fillRect(f, 17, 38, 22, 3);
    const handY = o.typing === 0 ? 39 : 38;
    fillRect(f, 16, 31, 3, 6);
    fillRect(f, 37, 31, 3, 6);
    fillRect(f, 22, handY, 3, 2);
    fillRect(f, 31, handY, 3, 2);
  }

  // Thruster flame under the body (off while sleeping).
  if (o.flame === 0) {
    fillRect(f, 26, 44, 4, 1);
    fillRect(f, 27, 45, 2, 2);
  } else if (o.flame === 1) {
    fillRect(f, 27, 44, 2, 1);
    fillRect(f, 26, 45, 4, 2);
  } else if (o.sleeping) {
    // Landed: small ground shadow instead of flame.
    fillRect(f, 20, 45, 16, 1);
  }

  if (o.sleeping) {
    // Zzz to the right of the head.
    const z = [[40, 6], [41, 5], [42, 6], [43, 5], [44, 6], [41, 8], [42, 8], [43, 8], [44, 9], [45, 10], [46, 10], [47, 11]] as const;
    for (const [zx, zy] of z) set(f, zx, zy);
  }

  return f;
}

const FRAMES: Record<Pose, DisplayFrame> = {
  idle0: drawRobot({ blink: false, flame: 0 }),
  idle1: drawRobot({ blink: true, flame: 1 }),
  think0: drawRobot({ reading: true, flame: 0 }),
  think1: drawRobot({ reading: true, pageFlip: true, flame: 1 }),
  work0: drawRobot({ typing: 0, flame: 0 }),
  work1: drawRobot({ typing: 1, flame: 1 }),
  sleep: drawRobot({ sleeping: true }),
};

function toAscii(frame: DisplayFrame): string {
  const lines: string[] = [];
  for (let y = 0; y < frame.height; y++) {
    lines.push([...frame.pixels.slice(y * frame.width, (y + 1) * frame.width)].map((p) => (p ? "█" : " ")).join("").replace(/\s+$/, ""));
  }
  return lines;
}

function toPbm(frame: DisplayFrame): string {
  const rows: string[] = [];
  for (let y = 0; y < frame.height; y++) {
    rows.push([...frame.pixels.slice(y * frame.width, (y + 1) * frame.width)].join(" "));
  }
  return `P1\n${frame.width} ${frame.height}\n${rows.join("\n")}\n`;
}

if (process.argv.includes("--export")) {
  const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "robot");
  mkdirSync(outDir, { recursive: true });
  for (const [name, frame] of Object.entries(FRAMES)) {
    writeFileSync(join(outDir, `${name}.pbm`), toPbm(frame));
    console.error(`wrote ${name}.pbm`);
  }
} else {
  const side = (a: string, b: string) => {
    const [la, lb] = [toAscii(FRAMES[a as Pose]), toAscii(FRAMES[b as Pose])];
    for (let i = 0; i < Math.max(la.length, lb.length); i++) console.log((la[i] ?? "").padEnd(W + 4) + (lb[i] ?? ""));
  };
  console.log("idle0 | idle1 (blink + antenna off):\n");
  side("idle0", "idle1");
  console.log("\nthink0 | think1 (page flip):\n");
  side("think0", "think1");
  console.log("\nwork0 | work1 (typing hands):\n");
  side("work0", "work1");
  console.log("\nsleep:\n");
  side("sleep", "sleep");
}
