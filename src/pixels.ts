import type { DisplayFrame } from "./display.ts";

/** Set one pixel; coordinates outside the frame are ignored. */
export function setPixel(frame: DisplayFrame, x: number, y: number, value: 0 | 1 = 1): void {
  if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return;
  frame.pixels[y * frame.width + x] = value;
}

export function fillRect(frame: DisplayFrame, x: number, y: number, width: number, height: number, value: 0 | 1 = 1): void {
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) setPixel(frame, x + dx, y + dy, value);
  }
}

export function drawRect(frame: DisplayFrame, x: number, y: number, width: number, height: number, value: 0 | 1 = 1): void {
  fillRect(frame, x, y, width, 1, value);
  fillRect(frame, x, y + height - 1, width, 1, value);
  fillRect(frame, x, y, 1, height, value);
  fillRect(frame, x + width - 1, y, 1, height, value);
}

/** Invert every pixel in a rectangle. */
export function invertRect(frame: DisplayFrame, x: number, y: number, width: number, height: number): void {
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      if (x + dx < frame.width && y + dy < frame.height) {
        const index = (y + dy) * frame.width + (x + dx);
        frame.pixels[index] = frame.pixels[index] ? 0 : 1;
      }
    }
  }
}
