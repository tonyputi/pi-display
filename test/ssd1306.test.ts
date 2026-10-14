import assert from "node:assert/strict";
import test from "node:test";
import { loadPbmFrame, parsePbmFrame } from "../src/assets.ts";
import type { DisplayFrame } from "../src/display.ts";
import { Ssd1306Display, SSD1306_DEFAULT_ADDRESS } from "../src/drivers/ssd1306.ts";

class FakeI2cDevice {
  readonly writes: Array<{ address: number; bytes: Buffer }> = [];
  closed = false;
  failWrites = false;

  async i2cWrite(address: number, length: number, buffer: Buffer) {
    if (this.failWrites) throw new Error("I2C write failed");
    this.writes.push({ address, bytes: Buffer.from(buffer.subarray(0, length)) });
    return { bytesWritten: length };
  }

  async close() {
    this.closed = true;
  }
}

function testFrame(): DisplayFrame {
  const pixels = new Uint8Array(128 * 64);
  pixels[0] = 1;
  pixels[3 * 128 + 3] = 1;
  pixels[8 * 128 + 3] = 1;
  pixels[63 * 128 + 127] = 1;
  return { width: 128, height: 64, pixels };
}

test("initializes and renders a common display frame at the selected I2C address", async () => {
  const bus = new FakeI2cDevice();
  const display = await Ssd1306Display.initialize(bus, 0x3d);

  assert.deepEqual(bus.writes[0], {
    address: 0x3d,
    bytes: Buffer.from([
      0x00, 0xae, 0xd5, 0x80, 0xa8, 0x3f, 0xd3, 0x00, 0x40,
      0x8d, 0x14, 0x20, 0x00, 0xa1, 0xc8, 0xda, 0x12,
      0x81, 0x7f, 0xd9, 0xf1, 0xdb, 0x40, 0xa4, 0xa6, 0xaf,
    ]),
  });
  assert.equal(display.width, 128);
  assert.equal(display.height, 64);

  await display.render(testFrame());
  const frameWrites = bus.writes.slice(1);
  assert.equal(frameWrites.length, 65); // address-window command + 1024-byte framebuffer in 16-byte chunks
  assert.deepEqual(frameWrites[0].bytes, Buffer.from([0x00, 0x21, 0x00, 0x7f, 0x22, 0x00, 0x07]));
  assert.ok(frameWrites.slice(1).every(({ address, bytes }) => address === 0x3d && bytes.length === 17 && bytes[0] === 0x40));

  const packed = Buffer.concat(frameWrites.slice(1).map(({ bytes }) => bytes.subarray(1)));
  assert.equal(packed[0], 0x01);
  assert.equal(packed[3], 0x08);
  assert.equal(packed[128 + 3], 0x01);
  assert.equal(packed[1023], 0x80);
  assert.equal(packed.reduce((count, byte) => count + byte.toString(2).replaceAll("0", "").length, 0), 4);

  await display.close();
  assert.equal(bus.closed, true);
});

test("rejects frames with incompatible dimensions or pixel data", async () => {
  const display = await Ssd1306Display.initialize(new FakeI2cDevice());
  await assert.rejects(display.render({ width: 1, height: 1, pixels: new Uint8Array(1) }), /expects a 128x64 frame/);
  await assert.rejects(display.render({ width: 128, height: 64, pixels: new Uint8Array(1) }), /must contain 8192 pixels/);
});

test("loads the Pi logo from its separate PBM asset", async () => {
  const logo = await loadPbmFrame(new URL("../assets/pi-logo.pbm", import.meta.url));
  assert.equal(logo.width, 128);
  assert.equal(logo.height, 64);
  assert.equal(logo.pixels.length, 128 * 64);
  assert.ok(logo.pixels.some((pixel) => pixel === 1));
  assert.ok(logo.pixels.some((pixel) => pixel === 0));
});

test("parses a small PBM image and rejects malformed assets", () => {
  assert.deepEqual(parsePbmFrame("P1\n# test image\n2 2\n0 1\n1 0\n"), {
    width: 2,
    height: 2,
    pixels: new Uint8Array([0, 1, 1, 0]),
  });
  assert.throws(() => parsePbmFrame("P3\n1 1\n0"), /expected PBM P1/);
  assert.throws(() => parsePbmFrame("P1\n2 2\n0 1 0"), /expected 4 binary pixels/);
});

test("uses the documented default address", () => {
  assert.equal(SSD1306_DEFAULT_ADDRESS, 0x3c);
});

test("closes the I2C device if controller initialization fails", async () => {
  const bus = new FakeI2cDevice();
  bus.failWrites = true;

  await assert.rejects(Ssd1306Display.initialize(bus), /I2C write failed/);
  assert.equal(bus.closed, true);
});
