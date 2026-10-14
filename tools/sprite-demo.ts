/**
 * Sprite candidate demo on the real display: cycles the greenbot expression
 * heads (CC0, OpenGameArt), centered. 
 *
 *   node tools/sprite-demo.ts
 */
import { decodePng } from "./png.ts";
import { readFileSync } from "node:fs";
import { DisplayClient } from "../src/client.ts";
import { defaultSocketPath } from "../src/service.ts";
import type { DisplayFrame } from "../src/display.ts";

const CELL = { w: 48, h: 32 };
const X = (128 - CELL.w) / 2;
const Y = (64 - CELL.h) / 2;

const img = decodePng(readFileSync("/tmp/robots/greenbot.png"));
const frames: DisplayFrame[] = [];
for (let row = 0; row < Math.floor(img.height / CELL.h); row++) {
  for (let col = 0; col < Math.floor(img.width / CELL.w); col++) {
    const frame: DisplayFrame = { width: 128, height: 64, pixels: new Uint8Array(128 * 64) };
    let any = false;
    for (let y = 0; y < CELL.h; y++) {
      for (let x = 0; x < CELL.w; x++) {
        const i = ((row * CELL.h + y) * img.width + col * CELL.w + x) * 4;
        const lum = 0.3 * img.rgba[i]! + 0.6 * img.rgba[i + 1]! + 0.1 * img.rgba[i + 2]!;
        if (img.rgba[i + 3]! > 128 && lum >= 100) {
          frame.pixels[(Y + y) * 128 + X + x] = 1;
          any = true;
        }
      }
    }
    if (any) frames.push(frame);
  }
}
console.log(`extracted ${frames.length} expression frames`);

const client = await DisplayClient.connect(defaultSocketPath());
let running = true;
const stop = () => {
  running = false;
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

try {
  while (running) {
    for (const frame of frames) {
      if (!running) break;
      await client.showFrame(frame);
      await new Promise((resolve) => setTimeout(resolve, 550));
    }
  }
  console.log("demo stopped — the last expression stays on screen");
} finally {
  await client.close().catch(() => undefined);
}
