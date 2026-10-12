// Tiny PNG encoder (RGBA, no filtering) for icons generated from pixel art.
import { deflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  return Buffer.concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** Expands palette-indexed pixels to RGBA, scaling each pixel to `scale`x`scale`. */
export function indexedToRgba(pixels: Uint8Array, width: number, palette: string[], scale = 1): Uint8Array {
  const height = pixels.length / width;
  const out = new Uint8Array(width * scale * height * scale * 4);
  const rgb = palette.map((hex) => (hex ? [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)] : null));
  for (let y = 0; y < height * scale; y++) {
    for (let x = 0; x < width * scale; x++) {
      const color = rgb[pixels[Math.floor(y / scale) * width + Math.floor(x / scale)]];
      if (!color) continue;
      const i = (y * width * scale + x) * 4;
      out[i] = color[0];
      out[i + 1] = color[1];
      out[i + 2] = color[2];
      out[i + 3] = 255;
    }
  }
  return out;
}
