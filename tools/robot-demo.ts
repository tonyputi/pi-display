/**
 * Robot demo on the real display: idles (blinking), thinks (book), works
 * (laptop), then falls asleep. Runs against the live service.
 *
 *   node tools/robot-demo.ts
 */
import { loadPbmFrame } from "../src/assets.ts";
import { DisplayClient } from "../src/client.ts";
import { defaultSocketPath } from "../src/service.ts";
import type { DisplayFrame } from "../src/display.ts";

const X = (128 - 56) / 2; // always centered
const Y = (64 - 62) / 2;

const client = await DisplayClient.connect(defaultSocketPath());
const robot = Object.fromEntries(
  await Promise.all(
    ["idle0", "idle1", "think0", "think1", "work0", "work1", "sleep"].map(async (name) => [
      name,
      await loadPbmFrame(new URL(`../assets/robot/${name}.pbm`, import.meta.url)),
    ]),
  ),
) as Record<string, DisplayFrame>;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function screen(pose: DisplayFrame): DisplayFrame {
  const frame: DisplayFrame = { width: 128, height: 64, pixels: new Uint8Array(128 * 64) };
  for (let y = 0; y < pose.height; y++) {
    for (let x = 0; x < pose.width; x++) {
      if (pose.pixels[y * pose.width + x]) frame.pixels[(Y + y) * 128 + X + x] = 1;
    }
  }
  return frame;
}

async function play(poses: [string, number][], loop = 1): Promise<void> {
  for (let i = 0; i < loop; i++) {
    for (const [pose, ms] of poses) {
      await client.showFrame(screen(robot[pose]!));
      await delay(ms);
    }
  }
}

try {
  await play([["idle0", 900], ["idle1", 300], ["idle0", 900], ["idle1", 300]], 2); // idle: breathing and blinking
  await play([["think0", 700], ["think1", 350], ["think0", 900], ["think1", 350]], 2); // thinking: page flips
  await play([["work0", 240], ["work1", 240]], 8); // working: fast typing
  await play([["idle0", 900], ["idle1", 300]], 1);
  await client.showFrame(screen(robot.sleep!)); // nap (this frame stays on screen)
  console.log("demo done — the robot is sleeping");
} finally {
  await client.close().catch(() => undefined);
}
