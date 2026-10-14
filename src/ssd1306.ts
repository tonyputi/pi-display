import i2cBus from "i2c-bus";

const WIDTH = 128;
const HEIGHT = 64;
export const SSD1306_DEFAULT_ADDRESS = 0x3c;
const LOGO_SIZE = 56;
const LOGO_ORIGIN_X = Math.floor((WIDTH - LOGO_SIZE) / 2);
const LOGO_ORIGIN_Y = Math.floor((HEIGHT - LOGO_SIZE) / 2);

interface I2cDevice {
  i2cWrite(address: number, length: number, buffer: Buffer): Promise<{ bytesWritten: number }>;
  close(): Promise<void>;
}

function insidePolygon(x: number, y: number, polygon: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const crosses = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function makePiLogo(): Buffer {
  // Official pi.dev favicon mark. Its three SVG paths are rendered in white;
  // an SSD1306 is monochrome, so the brand colors cannot be represented.
  const paths: Array<Array<[number, number]>> = [
    [[420, 280], [280, 280], [280, 140], [0, 140], [0, 0], [420, 0]],
    [[560, 280], [560, 560], [420, 560], [420, 280]],
    [[140, 560], [0, 560], [0, 140], [140, 140], [140, 280], [280, 280], [280, 420], [140, 420]],
  ];
  const frame = Buffer.alloc(WIDTH * HEIGHT / 8);

  for (let y = 0; y < LOGO_SIZE; y++) {
    for (let x = 0; x < LOGO_SIZE; x++) {
      const sourceX = (x + 0.5) * 560 / LOGO_SIZE;
      const sourceY = (y + 0.5) * 560 / LOGO_SIZE;
      if (!paths.some((path) => insidePolygon(sourceX, sourceY, path))) continue;

      const screenX = LOGO_ORIGIN_X + x;
      const screenY = LOGO_ORIGIN_Y + y;
      const index = Math.floor(screenY / 8) * WIDTH + screenX;
      frame[index] |= 1 << (screenY % 8);
    }
  }
  return frame;
}

export class Ssd1306Display {
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

  async showPiLogo(): Promise<void> {
    await this.command(0x21, 0, WIDTH - 1, 0x22, 0, HEIGHT / 8 - 1);
    const frame = makePiLogo();
    for (let offset = 0; offset < frame.length; offset += 16) {
      const chunk = Buffer.alloc(17);
      chunk[0] = 0x40; // SSD1306 data control byte
      frame.copy(chunk, 1, offset, Math.min(offset + 16, frame.length));
      const length = Math.min(16, frame.length - offset) + 1;
      await this.bus.i2cWrite(this.address, length, chunk);
    }
  }

  async close(): Promise<void> {
    // Leave the logo visible after Pi exits; only release the I2C handle.
    await this.bus.close();
  }

  private async command(...commands: number[]): Promise<void> {
    const data = Buffer.from([0x00, ...commands]);
    await this.bus.i2cWrite(this.address, data.length, data);
  }
}
