import assert from "node:assert/strict";
import test from "node:test";
import { Ssd1306Display, SSD1306_DEFAULT_ADDRESS } from "../src/ssd1306.ts";

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

test("initializes and renders the Pi logo using the selected I2C address", async () => {
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

  await display.showPiLogo();
  const frameWrites = bus.writes.slice(1);
  assert.equal(frameWrites.length, 65); // address-window command + 1024-byte framebuffer in 16-byte chunks
  assert.deepEqual(frameWrites[0].bytes, Buffer.from([0x00, 0x21, 0x00, 0x7f, 0x22, 0x00, 0x07]));
  assert.ok(frameWrites.slice(1).every(({ address, bytes }) => address === 0x3d && bytes.length === 17 && bytes[0] === 0x40));
  assert.equal(frameWrites.slice(1).reduce((size, { bytes }) => size + bytes.length - 1, 0), 128 * 64 / 8);
  assert.ok(frameWrites.slice(1).some(({ bytes }) => bytes.subarray(1).some((byte) => byte !== 0)));

  await display.close();
  assert.equal(bus.closed, true);
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
