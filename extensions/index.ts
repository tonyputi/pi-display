import { userInfo } from "node:os";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadPbmFrame } from "../src/assets.ts";
import { DisplayClient } from "../src/client.ts";
import { DEFAULT_SOCKET_PATH, defaultSocketPath } from "../src/service.ts";

const logoUrl = new URL("../assets/pi.pbm", import.meta.url);
const daemonPath = fileURLToPath(new URL("../daemon/pi-displayd.ts", import.meta.url));

export default function (pi: ExtensionAPI) {
  let client: DisplayClient | undefined;
  let warned = false;

  pi.on("session_start", async (_event, ctx) => {
    try {
      client = await DisplayClient.connect(defaultSocketPath());
      await client.showFrame(await loadPbmFrame(logoUrl));
      warned = false;
    } catch (error) {
      client = undefined;
      if (!warned && ctx.hasUI) {
        warned = true;
        ctx.ui.notify(`pi-display: ${error.message} — run /display setup`, "warning");
      }
    }
  });

  pi.on("session_shutdown", async () => {
    const active = client;
    client = undefined;
    await active?.close().catch(() => undefined);
  });

  pi.registerCommand("display", {
    description: "pi-display: show service status or print the service installation commands",
    handler: async (args, ctx) => {
      const subcommand = (args ?? "").trim().split(/\s+/)[0] || "status";
      if (subcommand === "status") return commandStatus(ctx);
      if (subcommand === "setup") return commandSetup(ctx);
      ctx.ui.notify("Usage: /display status | /display setup", "info");
    },
  });

  async function commandStatus(ctx: ExtensionCommandContext): Promise<void> {
    try {
      const probe = await DisplayClient.connect(defaultSocketPath());
      await probe.close();
      ctx.ui.notify("pi-display: service is running", "info");
    } catch (error) {
      ctx.ui.notify(`pi-display: ${error.message} — run /display setup`, "warning");
    }
  }

  /** Print the unit and the commands; installing a system service needs sudo, run by the user. */
  function commandSetup(ctx: ExtensionCommandContext): void {
    const unit = [
      "[Unit]",
      "Description=pi-display daemon (owns the I2C display)",
      "",
      "[Service]",
      `User=${userInfo().username}`,
      "RuntimeDirectory=pi-display",
      "RuntimeDirectoryMode=0750",
      `ExecStart=${JSON.stringify(process.execPath)} ${JSON.stringify(daemonPath)}`,
      "Restart=on-failure",
      "RestartSec=2",
      "",
      "[Install]",
      "WantedBy=multi-user.target",
      "",
    ].join("\n");

    console.info(
      `pi-display: save this unit to /etc/systemd/system/pi-display.service, then run the two systemctl commands:\n\n` +
        `${unit}\n` +
        `sudo systemctl daemon-reload\nsudo systemctl enable --now pi-display\n\n` +
        `The display shows the logo when the service starts. Socket: ${DEFAULT_SOCKET_PATH}`,
    );
    ctx.ui.notify("pi-display: setup commands printed — run them in your terminal", "info");
  }
}
