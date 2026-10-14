# pi-display

A [Pi](https://pi.dev) extension that drives I²C displays. The first implementation targets a 128×64 SSD1306 OLED and currently shows the Pi.dev logo. The project is intentionally focused on reliable display and extension lifecycle foundations before adding notification content or more display backends.

## Current scope

- Pi extension entry point: `extensions/index.ts`
- Shared display contract: `src/display.ts` (`DisplayDriver` + a monochrome `DisplayFrame`)
- Hardware backends: `src/drivers/ssd1306.ts`
- Reusable bitmap asset loader: `src/assets.ts`; the Pi logo is a separate PBM asset in `assets/pi-logo.pbm`
- Tested setup: I²C bus 1 (`/dev/i2c-1`), address `0x3C`
- At session start, initialize the display and render the logo asset; at shutdown, release the I²C handle and leave the image on screen.
- No session notifications, polling, configuration UI, or alternate controllers yet.

Drivers share a small interface: they expose their dimensions, render a row-major monochrome frame (one byte per pixel: zero is off, non-zero is on), and close their resources. Each backend owns its hardware initialization and pixel encoding. The SSD1306 driver defaults to bus 1 and address `0x3C`. Tests use a fake I²C device and do not require display hardware.

## Requirements and run

`i2c-bus` is a native Node.js module. Installing it from source requires Node.js headers and a C++ build toolchain (`python3`, `make`, and `g++`); on Debian-based systems these are provided by `build-essential` and `python3`.

```sh
npm install
pi --extension ./extensions/index.ts
```

Pi needs read/write access to `/dev/i2c-1`; on the tested host this is provided by membership in the `i2c` group. The `i2c-dev` kernel module must be loaded so the `/dev/i2c-*` device node exists.

## Tests

```sh
npm test
```

These hardware-free tests cover the shared frame contract, SSD1306 initialization and pixel packing, PBM asset loading, address selection, and cleanup after initialization errors.

## Direction

Keep the shared driver contract small and controller-agnostic. Add notification behavior and additional backends as separate, validated steps; avoid committing to a notification design before the display foundations are dependable.
