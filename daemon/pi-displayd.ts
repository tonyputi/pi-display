/** pi-displayd owns the display hardware and serves requests from Pi extensions over a Unix socket. */
import { loadPbmFrame } from "../src/assets.ts";
import { Ssd1306Display } from "../src/drivers/ssd1306.ts";
import { DisplayService } from "../src/service.ts";

const service = await DisplayService.create();
try {
  const display = await Ssd1306Display.open();
  service.setDisplay(display);
  await display.render(await loadPbmFrame(new URL("../assets/pi.pbm", import.meta.url)));
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
