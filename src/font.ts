import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DisplayFrame } from "./display.ts";
import { setPixel } from "./pixels.ts";

/** Classic 5×7 bitmap font: one byte per glyph column, bit 0 = top row. */
export interface BitmapFont {
  data: Uint8Array;
}

const GLYPH_COUNT = 95; // printable ASCII 32..126
const GLYPH_COLUMNS = 5;
export const GLYPH_ADVANCE = 6; // 5 columns + 1 px spacing
export const GLYPH_HEIGHT = 7;

/** Load the font asset (assets/font5x7.bin, classic 5×7 table). */
export function loadFont(url: URL): BitmapFont {
  const data = new Uint8Array(readFileSync(fileURLToPath(url)));
  if (data.length !== GLYPH_COUNT * GLYPH_COLUMNS) {
    throw new Error(`font asset malformed: expected ${GLYPH_COUNT * GLYPH_COLUMNS} bytes, got ${data.length}`);
  }
  return { data };
}

export function textWidth(text: string): number {
  return text.length * GLYPH_ADVANCE - 1;
}

/** Shorten text so it fits maxWidth pixels at one glyph per 6 columns. */
export function truncateToWidth(text: string, maxWidth: number): string {
  const maxChars = Math.floor((maxWidth + 1) / GLYPH_ADVANCE);
  return text.length <= maxChars ? text : text.slice(0, Math.max(0, maxChars));
}

/** Draw text with its top-left corner at (x, y). Characters outside printable ASCII render as '?'. */
export function drawText(frame: DisplayFrame, font: BitmapFont, text: string, x: number, y: number, value: 0 | 1 | "xor" = 1): void {
  for (const [index, char] of [...text].entries()) {
    const code = char.codePointAt(0)!;
    const glyph = code >= 32 && code <= 126 ? code : 63;
    const base = (glyph - 32) * GLYPH_COLUMNS;
    for (let column = 0; column < GLYPH_COLUMNS; column++) {
      const bits = font.data[base + column]!;
      for (let row = 0; row < GLYPH_HEIGHT; row++) {
        if ((bits >> row) & 1) setPixel(frame, x + index * GLYPH_ADVANCE + column, y + row, value);
      }
    }
  }
}
