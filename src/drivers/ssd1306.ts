import i2cBus from "i2c-bus";
import type { DisplayDriver, DisplayFrame } from "../display.ts";

const WIDTH = 128;
const HEIGHT = 64;
export const SSD1306_DEFAULT_ADDRESS = 0x3c;

interface I2cDevice {
  i2cWrite(address: number, length: number, buffer: Buffer): Promise<{ bytesWritten: number }>;
  close(): Promise<void>;
}

export class Ssd1306Display implements DisplayDriver {
  readonly width = WIDTH;
  readonly height = HEIGHT;

  private readonly bus: I2cDevice;
  private readonly address: number;

  private constructor(bus: I2cDevice, address: number) {
    this.bus = bus;
    this.address = address;
  }

  static async open(busNumber = 1, address = SSD1306_DEFAULT_ADDRESS): Promise<Ssd1306Display> {
    const bus = await i2cBus.openPromisified(busNumber) as I2cDevice;
    return Ssd1306Display.initialize(bus, address);
  }

  /** Initialize an already-open I2C device (also useful for hardware-free tests). */
  static async initialize(bus: I2cDevice, address = SSD1306_DEFAULT_ADDRESS): Promise<Ssd1306Display> {
    const display = new Ssd1306Display(bus, address);
    try {
      await display.command(
        0xae, 0xd5, 0x80, 0xa8, 0x3f, 0xd3, 0x00, 0x40,
        0x8d, 0x14, 0x20, 0x00, 0xa1, 0xc8, 0xda, 0x12,
        0x81, 0x7f, 0xd9, 0xf1, 0xdb, 0x40, 0xa4, 0xa6, 0xaf,
      );
      return display;
    } catch (error) {
      await bus.close();
      throw error;
    }
  }

  async render(frame: DisplayFrame): Promise<void> {
    if (frame.width !== this.width || frame.height !== this.height) {
      throw new Error(`SSD1306 expects a ${this.width}x${this.height} frame; got ${frame.width}x${frame.height}`);
    }
    if (frame.pixels.length !== this.width * this.height) {
      throw new Error(`Frame must contain ${this.width * this.height} pixels; got ${frame.pixels.length}`);
    }

    await this.command(0x21, 0, WIDTH - 1, 0x22, 0, HEIGHT / 8 - 1);
    const packed = Buffer.alloc(WIDTH * HEIGHT / 8);
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        if (frame.pixels[y * WIDTH + x]) {
          packed[Math.floor(y / 8) * WIDTH + x] |= 1 << (y % 8);
        }
      }
    }

    for (let offset = 0; offset < packed.length; offset += 16) {
      const chunk = Buffer.alloc(17);
      chunk[0] = 0x40; // SSD1306 data control byte
      packed.copy(chunk, 1, offset, offset + 16);
      await this.bus.i2cWrite(this.address, chunk.length, chunk);
    }
  }

  async close(): Promise<void> {
    // Leave the last rendered frame visible after Pi exits; only release the I2C handle.
    await this.bus.close();
  }

  private async command(...commands: number[]): Promise<void> {
    const data = Buffer.from([0x00, ...commands]);
    await this.bus.i2cWrite(this.address, data.length, data);
  }
}
