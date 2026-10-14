/**
 * Pet demo on the real display: walks across the screen, pauses, blinks,
 * walks back mirrored, then falls asleep. Runs against the live service.
 *
 *   node tools/pet-demo.ts
 */
import { loadPbmFrame } from "../src/assets.ts";
import { DisplayClient } from "../src/client.ts";
import { defaultSocketPath } from "../src/service.ts";
import type { DisplayFrame } from "../src/display.ts";

const SCREEN = { width: 128, height: 64 };
const GROUND_Y = 34; // pet top position so it stands near the bottom

const client = await DisplayClient.connect(defaultSocketPath());
const pet = Object.fromEntries(
  await Promise.all(
    ["walk0", "walk1", "idle", "blink", "sleep"].map(async (name) => [
      name,
      await loadPbmFrame(new URL(`../assets/pet/${name}.pbm`, import.meta.url)),
    ]),
  ),
) as Record<string, DisplayFrame>;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function blank(): DisplayFrame {
  return { width: SCREEN.width, height: SCREEN.height, pixels: new Uint8Array(SCREEN.width * SCREEN.height) };
}

/** Draw src onto dst at (x, y); flip mirrors it horizontally. */
function blit(dst: DisplayFrame, src: DisplayFrame, x: number, y: number, flip = false): void {
  for (let sy = 0; sy < src.height; sy++) {
    for (let sx = 0; sx < src.width; sx++) {
      if (!src.pixels[sy * src.width + sx]) continue;
      const dx = x + (flip ? src.width - 1 - sx : sx);
      const dy = y + sy;
      if (dx >= 0 && dy >= 0 && dx < SCREEN.width && dy < SCREEN.height) dst.pixels[dy * SCREEN.width + dx] = 1;
    }
  }
}

async function show(frame: DisplayFrame): Promise<void> {
  await client.showFrame(frame);
}

try {
  // Walk in from the left...
  let step = 0;
  for (let x = -pet.walk0.width; x <= SCREEN.width - pet.walk0.width; x += 4) {
    const frame = blank();
    blit(frame, pet[step++ % 2 === 0 ? "walk0" : "walk1"], x, GROUND_Y);
    await show(frame);
    await delay(220);
  }

  // ...pause, look around, blink.
  await show(blank());
  await delay(400);
  for (const pose of ["idle", "blink", "idle", "blink", "idle"] as const) {
    const frame = blank();
    blit(frame, pet[pose], SCREEN.width - pet.idle.width - 2, GROUND_Y);
    await show(frame);
    await delay(500);
  }

  // ...and walk back (mirrored).
  step = 0;
  for (let x = SCREEN.width - pet.walk0.width; x >= -pet.walk0.width; x -= 4) {
    const frame = blank();
    blit(frame, pet[step++ % 2 === 0 ? "walk0" : "walk1"], x, GROUND_Y, true);
    await show(frame);
    await delay(220);
  }

  // Nap in the middle (this frame stays until something else draws).
  const nap = blank();
  blit(nap, pet.sleep, Math.floor((SCREEN.width - pet.sleep.width) / 2), GROUND_Y + 6);
  await show(nap);
  console.log("demo done — the pet is napping on screen");
} finally {
  await client.close().catch(() => undefined);
}
