/** pi-displayd owns the display hardware and serves requests from Pi extensions over a Unix socket. */
import { loadPbmFrame } from "../src/assets.ts";
import { Compositor } from "../src/compositor.ts";
import { Ssd1306Display } from "../src/drivers/ssd1306.ts";
import { loadFont } from "../src/font.ts";
import { createRenderQueue } from "../src/render-queue.ts";
import { DisplayService } from "../src/service.ts";

const font = loadFont(new URL("../assets/font5x7.bin", import.meta.url));
const splash = await loadPbmFrame(new URL("../assets/pi.pbm", import.meta.url));

const compositor = new Compositor({ font, splash });

let display: Ssd1306Display | undefined;

/** Redraw the screen from the compositor state; coalesced so concurrent requests never tear the frame. */
const render = createRenderQueue(async () => {
  if (!display) return;
  try {
    await display.render(compositor.buildFrame());
  } catch (error) {
    console.error("pi-display: render failed", error);
  }
});

const service = await DisplayService.create(undefined, {
  onSession: (session) => {
    compositor.setSession(session);
    void render();
  },
  onSessionEnd: (id) => {
    compositor.endSession(id);
    void render();
  },
});

try {
  display = await Ssd1306Display.open();
  service.setDisplay(display);
  render(); // splash (logo)
  const timer = setInterval(() => {
    if (compositor.tick()) void render(display);
  }, 1000);
  timer.unref();
  console.info(`pi-display: service listening on ${service.socketPath}`);
} catch (error) {
  await service.close().catch(() => undefined);
  console.error("pi-display: failed to initialize the display", error);
  process.exit(1);
}

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  // Keep the last frame on screen; close() only releases the I2C handle.
  await service.close().catch(() => undefined);
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
