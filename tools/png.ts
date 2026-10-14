/** Minimal PNG decoder (8-bit, non-interlaced, color types 0/2/3/6) using node:zlib. */
import { inflateSync } from "node:zlib";

export interface RgbaImage {
  width: number;
  height: number;
  rgba: Uint8Array; // 4 bytes per pixel
}

export function decodePng(buffer: Buffer): RgbaImage {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG file");
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let bitDepth = 0;
  let palette: Buffer | undefined;
  let transparency: Buffer | undefined;
  const idat: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
      if (data[12] !== 0) throw new Error("interlaced PNG not supported");
    } else if (type === "PLTE") {
      palette = Buffer.from(data);
    } else if (type === "tRNS") {
      transparency = Buffer.from(data);
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }

  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(width * height * channels);
  let previous = new Uint8Array(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const current = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? current[x - channels]! : 0;
      const b = previous[x]!;
      const c = x >= channels ? previous[x - channels]! : 0;
      let value = line[x]!;
      if (filter === 1) value = (value + a) & 0xff;
      else if (filter === 2) value = (value + b) & 0xff;
      else if (filter === 3) value = (value + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value = (value + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      current[x] = value;
    }
    pixels.set(current, y * stride);
    previous = current;
  }

  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    if (colorType === 6) {
      rgba.set(pixels.subarray(i * 4, i * 4 + 4), i * 4);
    } else if (colorType === 2) {
      rgba.set([pixels[i * 3]!, pixels[i * 3 + 1]!, pixels[i * 3 + 2]!, 255], i * 4);
    } else if (colorType === 3) {
      const index = pixels[i]!;
      const alpha = transparency?.[index] ?? 255;
      rgba.set([palette![index * 3]!, palette![index * 3 + 1]!, palette![index * 3 + 2]!, alpha], i * 4);
    } else if (colorType === 4) {
      rgba.set([pixels[i * 2]!, pixels[i * 2]!, pixels[i * 2]!, pixels[i * 2 + 1]!], i * 4);
    } else {
      rgba.set([pixels[i]!, pixels[i]!, pixels[i]!, 255], i * 4);
    }
  }
  return { width, height, rgba };
}
