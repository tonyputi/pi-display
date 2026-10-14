import assert from "node:assert/strict";
import test from "node:test";
import { Compositor } from "../src/compositor.ts";
import { loadFont, drawText, textWidth, truncateToWidth } from "../src/font.ts";
import { parseSession, parseSessionId } from "../src/protocol.ts";
import type { DisplayFrame } from "../src/display.ts";

const font = loadFont(new URL("../assets/font5x7.bin", import.meta.url));

const logo: DisplayFrame = { width: 4, height: 4, pixels: new Uint8Array([1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) };

function session(overrides: Partial<Parameters<typeof parseSession>[0]> = {}): ReturnType<typeof parseSession> {
  return parseSession({
    id: "s1",
    name: "my-session",
    model: "gpt-6-luna",
    ctxPercent: 42,
    ctxTokens: 84_000,
    ctxWindow: 200_000,
    cost: 1.234,
    state: "working",
    ...overrides,
  });
}

function pixelAt(frame: DisplayFrame, x: number, y: number): number {
  return frame.pixels[y * frame.width + x]!;
}

test("loads the 5×7 font asset and draws glyphs", () => {
  const frame: DisplayFrame = { width: 32, height: 8, pixels: new Uint8Array(32 * 8) };
  drawText(frame, font, "A", 0, 0);
  // 'A' columns: 7c 12 11 12 7c → top pixel only in the middle column, left column starts at row 2.
  assert.equal(pixelAt(frame, 0, 0), 0);
  assert.equal(pixelAt(frame, 2, 0), 1);
  assert.equal(pixelAt(frame, 0, 2), 1);
  assert.equal(pixelAt(frame, 0, 1), 0);
  assert.equal(textWidth("abc"), 17); // 3 glyphs × 6 − 1
  assert.equal(truncateToWidth("abcdef", 11), "ab"); // floor(12/6) = 2 chars
});

test("validates session payloads", () => {
  assert.throws(() => parseSession({ ...session(), id: "" }), /non-empty id/);
  assert.throws(() => parseSession({ ...session(), state: "maybe" }), /state/);
  assert.throws(() => parseSession({ ...session(), cost: "free" }), /cost/);
  assert.throws(() => parseSessionId(42), /session_end/);
  assert.equal(parseSessionId("abc"), "abc");
});

test("shows the splash first, then the session page", () => {
  const compositor = new Compositor({ font, splash: logo, splashSeconds: 2 });
  compositor.setSession(session());
  assert.deepEqual(compositor.buildFrame(), logo); // splash passes the frame through
  assert.equal(compositor.tick(), false); // splash second 1
  assert.equal(compositor.tick(), true); // splash ends → must redraw
  assert.notEqual(compositor.buildFrame(), logo);

  const page = compositor.buildFrame();
  assert.equal(pixelAt(page, 0, 63), 1); // inverted footer: bottom-left corner lit
  assert.equal(pixelAt(page, 63, 16), 1); // bar border at y=16
});

test("renders the idle screen when no sessions are registered", () => {
  const compositor = new Compositor({ font, splash: logo, splashSeconds: 0 });
  const idle = compositor.buildFrame();
  assert.equal(pixelAt(idle, 0, 63), 1); // footer strip present
  assert.equal(pixelAt(idle, 0, 0), 0); // header area empty

  compositor.setSession(session());
  compositor.endSession("s1");
  assert.equal(compositor.pageCount, 0);
});

test("rotates across pages and shows the page indicator", () => {
  const compositor = new Compositor({ font, splashSeconds: 0 });
  compositor.setSession(session({ id: "a", name: "alpha" }));
  compositor.setSession(session({ id: "b", name: "beta" }));

  const first = compositor.buildFrame();
  assert.equal(compositor.tick(), false);
  assert.equal(compositor.tick(), false);
  assert.equal(compositor.tick(), false);
  assert.equal(compositor.tick(), true); // 4th second → rotate
  const second = compositor.buildFrame();
  assert.notDeepEqual(first, second);
  assert.equal(compositor.pageCount, 2);
});

test("unknown context usage renders a hatched bar, not an empty one", () => {
  const compositor = new Compositor({ font, splashSeconds: 0 });
  compositor.setSession(session({ ctxPercent: null, ctxTokens: null, ctxWindow: null }));
  const page = compositor.buildFrame();
  // Inside the bar (y=20): hatching lights columns 1, 5, 9… and not 2.
  assert.equal(pixelAt(page, 1, 20), 1);
  assert.equal(pixelAt(page, 2, 20), 0);
  assert.equal(pixelAt(page, 5, 20), 1);
});
