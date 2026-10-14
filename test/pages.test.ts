import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Compositor } from "../src/compositor.ts";
import { loadDisplayConfig } from "../src/config.ts";
import { loadFont, drawText, textWidth, truncateToWidth } from "../src/font.ts";
import { parseSession, parseSessionId } from "../src/protocol.ts";
import { createRenderQueue } from "../src/render-queue.ts";
import type { DisplayFrame } from "../src/display.ts";

const font = loadFont(new URL("../assets/font5x7.bin", import.meta.url));

const logo: DisplayFrame = { width: 4, height: 4, pixels: new Uint8Array([1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) };

function session(overrides: Partial<Record<string, any>> = {}): ReturnType<typeof parseSession> {
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
  assert.throws(() => parseSession({ ...session(), show: ["nonsense"] }), /show/);
  assert.throws(() => parseSessionId(42), /session_end/);
  assert.equal(parseSessionId("abc"), "abc");
  assert.deepEqual(parseSession({ ...session(), show: undefined }).show, ["bar", "cost", "model", "state"]);
  assert.deepEqual(parseSession(session({ show: ["bar"] })).show, ["bar"]);
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
  assert.equal(pixelAt(page, 63, 10), 1); // bar top border at y=10
  assert.equal(pixelAt(page, 63, 21), 1); // bar bottom border at y=21
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

test("display config merges agent-wide and project settings, invalid falls back to defaults", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-display-config-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const agentDir = join(root, "agent");
  const projectDir = join(root, "project");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(join(projectDir, ".pi"), { recursive: true });
  process.env.PI_AGENT_DIR = agentDir;
  t.after(() => delete process.env.PI_AGENT_DIR);

  // No settings at all → defaults.
  assert.deepEqual(loadDisplayConfig(projectDir).show, ["bar", "cost", "model", "state"]);

  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ "pi-display": { show: ["bar", "cost", "tokens"] } }));
  assert.deepEqual(loadDisplayConfig(projectDir).show, ["bar", "cost", "tokens"]);

  // Project wins.
  writeFileSync(join(projectDir, ".pi", "settings.json"), JSON.stringify({ "pi-display": { show: ["bar"] } }));
  assert.deepEqual(loadDisplayConfig(projectDir).show, ["bar"]);

  // Invalid values fall back to defaults instead of breaking the page.
  writeFileSync(join(projectDir, ".pi", "settings.json"), JSON.stringify({ "pi-display": { show: ["nonsense"] } }));
  assert.deepEqual(loadDisplayConfig(projectDir).show, ["bar", "cost", "model", "state"]);
  writeFileSync(join(projectDir, ".pi", "settings.json"), "{broken json");
  // Broken project file → agent-wide config still applies.
  assert.deepEqual(loadDisplayConfig(projectDir).show, ["bar", "cost", "tokens"]);
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

test("the percentage is drawn XOR-style inside the bar", () => {
  const compositor = new Compositor({ font, splashSeconds: 0 });
  const scratch: DisplayFrame = { width: 128, height: 64, pixels: new Uint8Array(128 * 64) };
  const label = "42%";
  const x0 = Math.floor((128 - textWidth(label)) / 2);
  drawText(scratch, font, label, x0, 12);
  const firstSet = scratch.pixels.findIndex((p) => p === 1);
  assert.ok(firstSet >= 0);

  // Low fill: the glyph sits on emptiness → XOR lights it up.
  compositor.setSession(session({ ctxPercent: 42 }));
  assert.equal(compositor.buildFrame().pixels[firstSet]!, 1);
  // High fill: the glyph sits on the filled part → XOR turns it dark.
  compositor.setSession(session({ ctxPercent: 80 }));
  assert.equal(compositor.buildFrame().pixels[firstSet]!, 0);
});

test("tokens appear only when requested; hidden cost and model leave no trace", () => {
  const compositor = new Compositor({ font, splashSeconds: 0 });
  compositor.setSession(session({ show: ["bar", "tokens"] }));
  const page = compositor.buildFrame();
  const scratch: DisplayFrame = { width: 128, height: 64, pixels: new Uint8Array(128 * 64) };
  drawText(scratch, font, "84k/200k", 1, 25);
  assert.ok(scratch.pixels.some((p) => p === 1));
  // Every glyph pixel of the tokens line must also be lit on the page (it was drawn there too).
  let match = true;
  for (const [i, p] of scratch.pixels.entries()) if (p === 1 && page.pixels[i] !== 1) match = false;
  assert.equal(match, true);
  assert.equal(page.pixels.some((p) => p === 1), true);

  const minimal = new Compositor({ font, splashSeconds: 0 });
  minimal.setSession(session({ show: ["bar"], cost: null, model: null }));
  const bare = minimal.buildFrame();
  assert.equal(pixelAt(bare, 0, 63), 0); // no footer when neither state nor model is shown
});

test("the render queue coalesces concurrent renders and never overlaps them", async () => {
  let active = 0;
  let overlap = false;
  let renders = 0;
  const delay = () => new Promise((resolve) => setTimeout(resolve, 10));
  const queue = createRenderQueue(async () => {
    if (active > 0) overlap = true;
    active += 1;
    await delay();
    active -= 1;
    renders += 1;
  });

  queue();
  queue();
  queue();
  queue();
  await delay();
  await delay();
  assert.equal(overlap, false); // never two renders at once
  assert.ok(renders <= 2); // burst coalesced into at most two passes
});
