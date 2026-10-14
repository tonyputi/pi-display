/**
 * Candidate demo: the 7 pixel-robot designs from the CC0 spritesheet
 * (robot-spritesheet.png, OpenGameArt), scaled 3×, centered, each with its
 * two-frame idle animation. Shows design after design until interrupted.
 *
 *   node tools/robot-pick.ts
 */
import { decodePng } from "./png.ts";
import { readFileSync } from "node:fs";
import { DisplayClient } from "../src/client.ts";
import { defaultSocketPath } from "../src/service.ts";
import type { DisplayFrame } from "../src/display.ts";

const SCALE = 3;
const SHEET = "/tmp/robots/robot-spritesheet.png";
const DESIGN_XS = [18, 34, 50, 66, 82, 98, 114];
const ROWS: [number, number][] = [
  [15, 28],
  [39, 52],
];

const img = decodePng(readFileSync(SHEET));

/** Convert one sprite to a full-screen frame, scaled, centered. */
function render(x0: number, y0: number, w: number, h: number): DisplayFrame {
  const frame: DisplayFrame = { width: 128, height: 64, pixels: new Uint8Array(128 * 64) };
  const sw = w * SCALE;
  const sh = h * SCALE;
  const ox = Math.floor((128 - sw) / 2);
  const oy = Math.floor((64 - sh) / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * img.width + x0 + x) * 4;
      const lum = 0.3 * img.rgba[i]! + 0.6 * img.rgba[i + 1]! + 0.1 * img.rgba[i + 2]!;
      if (img.rgba[i + 3]! > 128 && lum > 90) {
        for (let dy = 0; dy < SCALE; dy++) {
          for (let dx = 0; dx < SCALE; dx++) {
            frame.pixels[(oy + y * SCALE + dy) * 128 + ox + x * SCALE + dx] = 1;
          }
        }
      }
    }
  }
  return frame;
}

const designs = DESIGN_XS.map((x) => ROWS.map(([y0, y1]) => render(x, y0, 10, y1 - y0 + 1)));

const client = await DisplayClient.connect(defaultSocketPath());
let running = true;
process.on("SIGINT", () => (running = false));
process.on("SIGTERM", () => (running = false));

try {
  let d = 0;
  while (running) {
    const poses = designs[d % designs.length]!;
    for (let cycle = 0; cycle < 4 && running; cycle++) {
      await client.showFrame(poses[cycle % 2]!);
      await new Promise((resolve) => setTimeout(resolve, 380));
    }
    d += 1;
  }
  console.log("done");
} finally {
  await client.close().catch(() => undefined);
}
