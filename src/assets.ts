import { readFile } from "node:fs/promises";
import type { DisplayFrame } from "./display.ts";

/** Load a portable monochrome PBM (P1) image as a row-major display frame. */
export async function loadPbmFrame(url: URL): Promise<DisplayFrame> {
  return parsePbmFrame(await readFile(url, "utf8"));
}

export function parsePbmFrame(source: string): DisplayFrame {
  const tokens = source.replace(/#[^\n]*/g, " ").trim().split(/\s+/);
  if (tokens[0] !== "P1") throw new Error("Unsupported bitmap asset: expected PBM P1 format");

  const width = Number(tokens[1]);
  const height = Number(tokens[2]);
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    throw new Error("Invalid PBM dimensions");
  }

  const pixels = tokens.slice(3);
  if (pixels.length !== width * height || pixels.some((pixel) => pixel !== "0" && pixel !== "1")) {
    throw new Error(`Invalid PBM pixel data: expected ${width * height} binary pixels`);
  }

  return { width, height, pixels: Uint8Array.from(pixels, Number) };
}
