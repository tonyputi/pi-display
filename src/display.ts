/** A monochrome image using one byte per pixel in row-major order (0 = off, non-zero = on). */
export interface DisplayFrame {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

/** Common surface for display backends. Opening/initialization is handled by each driver. */
export interface DisplayDriver {
  readonly width: number;
  readonly height: number;
  render(frame: DisplayFrame): Promise<void>;
  close(): Promise<void>;
}
