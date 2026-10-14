import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadPbmFrame } from "../src/assets.ts";
import type { DisplayDriver } from "../src/display.ts";
import { Ssd1306Display } from "../src/drivers/ssd1306.ts";

export default function (pi: ExtensionAPI) {
  let display: DisplayDriver | undefined;

  pi.on("session_start", async () => {
    try {
      display = await Ssd1306Display.open();
      const logo = await loadPbmFrame(new URL("../assets/pi-logo.pbm", import.meta.url));
      await display.render(logo);
      console.info("pi-display: Pi.dev logo shown on SSD1306 at I2C 0x3C");
    } catch (error) {
      console.error("pi-display: failed to initialize SSD1306", error);
      if (display) {
        await display.close().catch(() => undefined);
        display = undefined;
      }
    }
  });

  pi.on("session_shutdown", async () => {
    if (!display) return;
    const activeDisplay = display;
    display = undefined;
    await activeDisplay.close();
  });
}
