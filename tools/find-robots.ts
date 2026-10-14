/** One-off: extract robot bounding boxes from the pixel-robot spritesheet. */
import { decodePng } from "./png.ts";
import { readFileSync } from "node:fs";

const img = decodePng(readFileSync("/tmp/robots/robot-spritesheet.png"));
const lit = (x: number, y: number) => {
  const i = (y * img.width + x) * 4;
  const l = 0.3 * img.rgba[i]! + 0.6 * img.rgba[i + 1]! + 0.1 * img.rgba[i + 2]!;
  return img.rgba[i + 3]! > 128 && l > 90;
};
const rowHas = Array.from({ length: img.height }, (_, y) => Array.from({ length: img.width }, (_, x) => lit(x, y)).some(Boolean));
const bands: [number, number][] = [];
let start = -1;
rowHas.forEach((v, y) => {
  if (v && start < 0) start = y;
  if (!v && start >= 0) {
    bands.push([start, y - 1]);
    start = -1;
  }
});
if (start >= 0) bands.push([start, img.height - 1]);

for (const [y0, y1] of bands) {
  const cols: [number, number][] = [];
  let s = -1;
  for (let x = 0; x <= img.width; x++) {
    const v = x < img.width && Array.from({ length: y1 - y0 + 1 }, (_, y) => lit(x, y0 + y)).some(Boolean);
    if (v && s < 0) s = x;
    if (!v && s >= 0) {
      cols.push([s, x - 1]);
      s = -1;
    }
  }
  console.log(`banda y=${y0}..${y1}:`, JSON.stringify(cols));
}
