import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadPbmFrame } from "../src/assets.ts";
import { DisplayClient } from "../src/client.ts";
import { defaultSocketPath } from "../src/service.ts";

const logoUrl = new URL("../assets/pi.pbm", import.meta.url);
const daemonPath = fileURLToPath(new URL("../daemon/pi-displayd.ts", import.meta.url));

export default function (pi: ExtensionAPI) {
  let client: DisplayClient | undefined;
  let warned = false;

  /** Connect to the service, starting the daemon first when it is not running. */
  async function connectToService(): Promise<DisplayClient> {
    try {
      return await DisplayClient.connect(defaultSocketPath());
    } catch {
      startDaemon();
      await waitForSocket(defaultSocketPath(), 5000);
      return DisplayClient.connect(defaultSocketPath());
    }
  }

  /** Detached daemon: outlives Pi processes, keeps the last frame on screen. The socket is the single-instance lock. */
  function startDaemon(): void {
    spawn(process.execPath, [daemonPath], { detached: true, stdio: "ignore" }).unref();
  }

  async function waitForSocket(socketPath: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const probe = await DisplayClient.connect(socketPath, 200);
        await probe.close();
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    throw new Error(`the pi-display daemon did not start — run it manually to see the error: ${process.execPath} ${daemonPath}`);
  }

  async function connectAndShowLogo(ctx: ExtensionCommandContext): Promise<void> {
    try {
      client = await connectToService();
      await client.showFrame(await loadPbmFrame(logoUrl));
      warned = false;
    } catch (error) {
      client = undefined;
      if (!warned && ctx.hasUI) {
        warned = true;
        ctx.ui.notify(`pi-display: ${error.message}`, "warning");
      }
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    // Skip machines without the expected I2C device (CI, laptops, non-Linux).
    if (process.platform !== "linux" || !existsSync("/dev/i2c-1")) return;
    await connectAndShowLogo(ctx);
  });

  pi.on("session_shutdown", async () => {
    const active = client;
    client = undefined;
    await active?.close().catch(() => undefined);
  });

  pi.registerCommand("display", {
    description: "pi-display: show service status or start the daemon",
    handler: async (args, ctx) => {
      const subcommand = (args ?? "").trim().split(/\s+/)[0] || "status";
      if (subcommand === "status") return commandStatus(ctx);
      if (subcommand === "start") return commandStart(ctx);
      ctx.ui.notify("Usage: /display status | /display start", "info");
    },
  });

  async function commandStatus(ctx: ExtensionCommandContext): Promise<void> {
    try {
      const probe = await DisplayClient.connect(defaultSocketPath());
      await probe.close();
      ctx.ui.notify("pi-display: daemon is running", "info");
    } catch (error) {
      ctx.ui.notify(`pi-display: ${error.message}`, "warning");
    }
  }

  async function commandStart(ctx: ExtensionCommandContext): Promise<void> {
    try {
      const active = await connectToService();
      await active.showFrame(await loadPbmFrame(logoUrl));
      client = active;
      ctx.ui.notify("pi-display: daemon is running — the display shows the logo", "info");
    } catch (error) {
      ctx.ui.notify(`pi-display: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }
}
