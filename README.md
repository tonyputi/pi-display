# pi-display

A [Pi](https://pi.dev) extension that drives I²C displays. The first implementation targets a 128×64 SSD1306 OLED and currently shows the Pi.dev logo. The project is intentionally focused on reliable display and extension lifecycle foundations before adding notification content or more display backends.

## Current scope

- Pi extension entry point: `extensions/index.ts`
- SSD1306 driver: `src/ssd1306.ts`
- Tested setup: I²C bus 1 (`/dev/i2c-1`), address `0x3C`
- At session start, initialize the display and draw the logo; at shutdown, release the I²C handle and leave the image on screen.
- No session notifications, polling, configuration UI, or alternate controllers yet.

The SSD1306 driver accepts a bus and I²C address, while `open()` uses bus 1 and address `0x3C` by default. The driver tests use a fake I²C device, so they do not require display hardware.

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

These hardware-free tests cover SSD1306 initialization, framebuffer transfer, address selection, and cleanup after initialization errors.

## Direction

Keep the extension and display boundary small and controller-agnostic. Add notification behavior and additional display drivers as separate, validated steps; avoid committing to a notification design before the display foundations are dependable.
