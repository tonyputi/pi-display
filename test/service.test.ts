import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { connect } from "node:net";
import { DisplayClient } from "../src/client.ts";
import type { DisplayDriver, DisplayFrame } from "../src/display.ts";
import { decodeFrame, encodeFrame } from "../src/protocol.ts";
import { DisplayService } from "../src/service.ts";

class FakeDisplay implements DisplayDriver {
  readonly width = 128;
  readonly height = 64;
  readonly frames: DisplayFrame[] = [];
  failRender = false;

  async render(frame: DisplayFrame): Promise<void> {
    if (this.failRender) throw new Error("render failed");
    this.frames.push(frame);
  }

  async close(): Promise<void> {}
}

function uniqueSocketPath(): string {
  return join(tmpdir(), `pi-display-test-${process.pid}-${Math.random().toString(36).slice(2)}.sock`);
}

test("serves frames from clients and enforces a single instance", async (t) => {
  const socketPath = uniqueSocketPath();
  const display = new FakeDisplay();
  const service = await DisplayService.create(socketPath);
  t.after(() => service.close());
  service.setDisplay(display);

  const client = await DisplayClient.connect(socketPath);
  t.after(() => client.close());
  const frame: DisplayFrame = { width: 128, height: 64, pixels: new Uint8Array(128 * 64) };
  frame.pixels[5] = 1;
  await client.showFrame(frame);

  assert.equal(display.frames.length, 1);
  assert.equal(display.frames[0].pixels[5], 1);

  await assert.rejects(DisplayService.create(socketPath), /already listening/);

  await client.close();
  await service.close();
  assert.equal(existsSync(socketPath), false);
});

test("replies with errors for malformed or failed requests", async (t) => {
  const socketPath = uniqueSocketPath();
  const display = new FakeDisplay();
  const service = await DisplayService.create(socketPath);
  t.after(() => service.close());
  service.setDisplay(display);

  const client = await DisplayClient.connect(socketPath);
  t.after(() => client.close());
  await assert.rejects(
    client.showFrame({ width: 128, height: 64, pixels: new Uint8Array(3) }),
    /carries 3 pixels; expected 8192/,
  );

  display.failRender = true;
  await assert.rejects(client.showFrame({ width: 128, height: 64, pixels: new Uint8Array(128 * 64) }), /render failed/);
  display.failRender = false;
});

test("answers invalid JSON lines with an error response", async (t) => {
  const socketPath = uniqueSocketPath();
  const service = await DisplayService.create(socketPath);
  t.after(() => service.close());

  const raw = connect(socketPath);
  t.after(() => raw.destroy());
  const response = new Promise<string>((resolve, reject) => {
    raw.setEncoding("utf8");
    raw.on("data", (chunk: string) => resolve(chunk));
    raw.on("error", reject);
  });
  raw.write("not-json\n");
  assert.equal(JSON.parse(await response).type, "error");
});

test("creates the socket directory when missing", async (t) => {
  const socketPath = join(tmpdir(), `pi-display-test-${Math.random().toString(36).slice(2)}`, "nested", "pi-display.sock");
  t.after(() => rmSync(dirname(dirname(socketPath)), { recursive: true, force: true }));
  const service = await DisplayService.create(socketPath);
  t.after(() => service.close());
  service.setDisplay(new FakeDisplay());

  const client = await DisplayClient.connect(socketPath);
  t.after(() => client.close());
  await client.showFrame({ width: 128, height: 64, pixels: new Uint8Array(128 * 64) });
});

test("client connect fails on a missing socket", async () => {
  await assert.rejects(DisplayClient.connect(join(tmpdir(), "pi-display-missing.sock"), 200), /not reachable/);
});

test("frames survive the transport encoding", () => {
  const frame: DisplayFrame = { width: 2, height: 2, pixels: new Uint8Array([0, 1, 1, 0]) };
  assert.deepEqual(decodeFrame(encodeFrame(frame)), frame);
  assert.throws(() => decodeFrame({ width: 2, height: 2, pixels: "AAAA" }), /carries 3 pixels; expected 4/);
});
