import type { DisplayFrame } from "./display.ts";

/** Frame encoded for transport: row-major pixels as base64 (1 = on, 0 = off). */
export interface EncodedFrame {
  width: number;
  height: number;
  pixels: string;
}

export type ServiceRequest = { type: "show"; frame: EncodedFrame };

export type ServiceResponse = { type: "ok" } | { type: "error"; message: string };

export function encodeFrame(frame: DisplayFrame): EncodedFrame {
  return {
    width: frame.width,
    height: frame.height,
    pixels: Buffer.from(frame.pixels).toString("base64"),
  };
}

export function decodeFrame(encoded: EncodedFrame): DisplayFrame {
  if (typeof encoded?.width !== "number" || typeof encoded?.height !== "number" || typeof encoded?.pixels !== "string") {
    throw new Error("invalid frame: expected width, height, and base64 pixels");
  }
  if (encoded.width < 1 || encoded.height < 1) {
    throw new Error("invalid frame dimensions");
  }
  const pixels = new Uint8Array(Buffer.from(encoded.pixels, "base64"));
  if (pixels.length !== encoded.width * encoded.height) {
    throw new Error(`frame carries ${pixels.length} pixels; expected ${encoded.width * encoded.height}`);
  }
  return { width: encoded.width, height: encoded.height, pixels };
}

/** Serialize one message as a JSON line. */
export function encodeMessage(message: unknown): string {
  return `${JSON.stringify(message)}\n`;
}

/** Split a buffer into complete JSON messages plus the trailing partial line. Throws on invalid JSON. */
export function decodeMessages(buffer: string): { messages: unknown[]; rest: string } {
  const messages: unknown[] = [];
  let index: number;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) messages.push(JSON.parse(line));
  }
  return { messages, rest: buffer };
}
