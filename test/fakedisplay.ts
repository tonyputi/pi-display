import type { DisplayDriver, DisplayFrame } from "../src/display.ts";

/** DisplayDriver double that records rendered frames instead of touching hardware. */
export class FakeDisplay implements DisplayDriver {
  readonly width = 128;
  readonly height = 64;
  readonly frames: DisplayFrame[] = [];
  failRender = false;

  async render(frame: DisplayFrame): Promise<void> {
    if (this.failRender) throw new Error("render failed");
    this.frames.push(frame);
  }

  async close(): Promise<void> {}

  /** The most recently rendered frame. */
  get last(): DisplayFrame {
    return this.frames[this.frames.length - 1]!;
  }
}
