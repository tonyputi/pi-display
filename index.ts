import { basename } from "node:path";
import { userInfo } from "node:os";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadDisplayConfig } from "./src/config.ts";
import { DisplayClient } from "./src/client.ts";
import { DEFAULT_SOCKET_PATH, defaultSocketPath } from "./src/service.ts";
import type { SessionData } from "./src/protocol.ts";

const daemonPath = fileURLToPath(new URL("./daemon/pi-displayd.ts", import.meta.url));

/** Sensor extension: reports session data to the pi-display service, which composes the pages. */
export default function (pi: ExtensionAPI) {
  let client: DisplayClient | undefined;
  let warned = false;

  function sessionData(ctx: {
    cwd: string;
    sessionManager: any;
    model?: any;
    isIdle?: () => boolean;
    getContextUsage?: () => { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
  }): SessionData {
    const config = loadDisplayConfig(ctx.cwd);
    const show = new Set(config.show);
    const usage = ctx.getContextUsage?.();
    return {
      id: ctx.sessionManager.getSessionId(),
      name: ctx.sessionManager.getSessionName() ?? basename(ctx.cwd) ?? "session",
      model: show.has("model") ? ctx.model?.name ?? ctx.model?.id ?? null : null,
      ctxPercent: show.has("bar") ? usage?.percent ?? null : null,
      ctxTokens: show.has("tokens") ? usage?.tokens ?? null : null,
      ctxWindow: show.has("tokens") ? usage?.contextWindow ?? null : null,
      cost: show.has("cost") ? estimateCost(ctx) : null,
      state: ctx.isIdle?.() === false ? "working" : "idle",
      show: config.show,
    };
  }

  /** Sum per-message usage × the current model's per-million rates (approximation across model switches). */
  function estimateCost(ctx: { sessionManager: any; model?: any }): number | null {
    const rates = ctx.model?.cost;
    if (!rates) return null;
    let cost = 0;
    for (const entry of ctx.sessionManager.getEntries()) {
      const message = entry?.type === "message" ? entry.message : undefined;
      const usage = message?.role === "assistant" ? message.usage : undefined;
      if (!usage) continue;
      cost +=
        ((usage.input ?? 0) * (rates.input ?? 0) +
          (usage.output ?? 0) * (rates.output ?? 0) +
          (usage.cacheRead ?? 0) * (rates.cacheRead ?? 0) +
          (usage.cacheWrite ?? 0) * (rates.cacheWrite ?? 0)) /
        1e6;
    }
    return cost;
  }

  /** Best-effort push: silently skips when the service is down (warns once at session start). */
  async function pushSession(ctx: any): Promise<void> {
    try {
      client ??= await DisplayClient.connect(defaultSocketPath());
      await client.pushSession(sessionData(ctx));
      warned = false;
    } catch (error) {
      client = undefined;
      if (warned || !ctx.hasUI) return;
      warned = true;
      ctx.ui.notify(`pi-display: ${error.message} — run /display setup`, "warning");
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    if (process.platform !== "linux") return;
    await pushSession(ctx);
  });
  pi.on("session_info_changed", async (_event, ctx) => pushSession(ctx));
  pi.on("agent_start", async (_event, ctx) => pushSession(ctx));
  pi.on("agent_settled", async (_event, ctx) => pushSession(ctx));
  pi.on("turn_end", async (_event, ctx) => pushSession(ctx));

  pi.on("session_shutdown", async (_event, ctx) => {
    const active = client;
    client = undefined;
    if (!active) return;
    try {
      await active.endSession(ctx.sessionManager.getSessionId());
    } catch {
      // The service may already be gone; nothing to do.
    }
    await active.close().catch(() => undefined);
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
