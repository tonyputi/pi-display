import type { DisplayFrame } from "./display.ts";

/** Frame encoded for transport: row-major pixels as base64 (1 = on, 0 = off). */
export interface EncodedFrame {
  width: number;
  height: number;
  pixels: string;
}

export type SessionState = "working" | "idle";

/** Page elements a session can request; anything not listed is not drawn. */
export const SHOW_OPTIONS = ["bar", "cost", "model", "state", "tokens"] as const;
export const DEFAULT_SHOW = ["bar", "cost", "model", "state"] as const;

/** One pi session as reported by its extension; null means unknown right now. */
export interface SessionData {
  id: string;
  name: string;
  model: string | null;
  ctxPercent: number | null;
  ctxTokens: number | null;
  ctxWindow: number | null;
  cost: number | null;
  state: SessionState;
  /** Which page elements to draw; defaults to DEFAULT_SHOW. */
  show: string[];
}

export type ServiceRequest =
  | { type: "show"; frame: EncodedFrame }
  | { type: "session"; session: SessionData }
  | { type: "session_end"; id: string };

export type ServiceResponse = { type: "ok" } | { type: "error"; message: string };

/** Validate a session upsert payload; throws with a human-readable message. */
export function parseSession(value: unknown): SessionData {
  const raw = value as Record<string, unknown> | null;
  if (!raw || typeof raw.id !== "string" || !raw.id) throw new Error("invalid session: expected a non-empty id");
  if (typeof raw.name !== "string") throw new Error("invalid session: expected a name");
  if (raw.state !== "working" && raw.state !== "idle") throw new Error('invalid session: state must be "working" or "idle"');
  for (const key of ["ctxPercent", "ctxTokens", "ctxWindow", "cost"] as const) {
    const v = raw[key];
    if (v !== null && (typeof v !== "number" || !Number.isFinite(v))) {
      throw new Error(`invalid session: ${key} must be a number or null`);
    }
  }
  if (raw.model !== null && typeof raw.model !== "string") throw new Error("invalid session: model must be a string or null");
  let show: string[] = [...DEFAULT_SHOW];
  if (raw.show !== undefined) {
    if (!Array.isArray(raw.show) || raw.show.some((s) => !SHOW_OPTIONS.includes(s))) {
      throw new Error(`invalid session: show must be a subset of ${SHOW_OPTIONS.join(", ")}`);
    }
    show = raw.show as string[];
  }
  return {
    id: raw.id,
    name: raw.name,
    model: raw.model as string | null,
    ctxPercent: raw.ctxPercent as number | null,
    ctxTokens: raw.ctxTokens as number | null,
    ctxWindow: raw.ctxWindow as number | null,
    cost: raw.cost as number | null,
    state: raw.state,
    show,
  };
}

/** Validate a session_end id; throws with a human-readable message. */
export function parseSessionId(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("invalid session_end: expected a non-empty id");
  return value;
}

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
