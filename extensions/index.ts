import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadPbmFrame } from "../src/assets.ts";
import { DisplayClient } from "../src/client.ts";
import { defaultRuntimeDir, defaultSocketPath } from "../src/service.ts";

const execFileAsync = promisify(execFile);
const logoUrl = new URL("../assets/pi.pbm", import.meta.url);
const daemonPath = fileURLToPath(new URL("../daemon/pi-displayd.ts", import.meta.url));
const unitPath = join(homedir(), ".config", "systemd", "user", "pi-display.service");

/** Environment for systemctl/loginctl: the host process may run without a logind session, so set what systemd expects. */
function systemdEnv(): Record<string, string> {
  const runtimeDir = defaultRuntimeDir();
  return { ...process.env, XDG_RUNTIME_DIR: runtimeDir, DBUS_SESSION_BUS_ADDRESS: `unix:path=${runtimeDir}/bus` } as Record<string, string>;
}

async function userManagerRunning(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("systemctl", ["--user", "is-system-running"], { env: systemdEnv() });
    return /running|degraded|starting/.test(stdout.trim());
  } catch (error) {
    return /running|degraded|starting/.test((error as { stdout?: string }).stdout ?? "");
  }
}

/** Bring up the systemd user manager when the host has no active logind session (typical on headless boards). */
async function ensureUserManager(): Promise<void> {
  if (await userManagerRunning()) return;
  try {
    await execFileAsync("loginctl", ["enable-linger"], { env: systemdEnv() });
  } catch {
    try {
      await execFileAsync("sudo", ["-n", "loginctl", "enable-linger"], { env: systemdEnv() });
    } catch {
      throw new Error(`the systemd user manager is not running — run once: sudo loginctl enable-linger $(whoami)`);
    }
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await userManagerRunning()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!existsSync("/usr/lib/security/pam_systemd.so")) {
    throw new Error(`the systemd user manager did not start — install libpam-systemd, then: sudo systemctl restart user@$(id -u)`);
  }
  throw new Error(`the systemd user manager did not start — check journalctl --user -u user@$(id -u)`);
}

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
    description: "pi-display: show service status or set the service up",
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

  async function commandSetup(ctx: ExtensionCommandContext): Promise<void> {
    try {
      const probe = await DisplayClient.connect(defaultSocketPath());
      await probe.close();
      ctx.ui.notify("pi-display: service is already running", "info");
      return;
    } catch {
      // Not running — continue with the installation.
    }

    try {
      await ensureUserManager();
      const unit = [
        "[Unit]",
        "Description=pi-display service (owns the I2C display)",
        "",
        "[Service]",
        `ExecStart=${JSON.stringify(process.execPath)} ${JSON.stringify(daemonPath)}`,
        "Restart=on-failure",
        "RestartSec=2",
        "",
        "[Install]",
        "WantedBy=default.target",
        "",
      ].join("\n");
      await mkdirSync(join(homedir(), ".config", "systemd", "user"), { recursive: true });
      await writeFile(unitPath, unit);
      await execFileAsync("systemctl", ["--user", "daemon-reload"], { env: systemdEnv() });
      await execFileAsync("systemctl", ["--user", "enable", "--now", "pi-display.service"], { env: systemdEnv() });

      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          const probe = await DisplayClient.connect(defaultSocketPath(), 300);
          await probe.close();
          ctx.ui.notify("pi-display: service installed and started — the display shows the logo", "info");
          return;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      ctx.ui.notify("pi-display: the service did not come up — check journalctl --user -u pi-display", "error");
    } catch (error) {
      ctx.ui.notify(`pi-display: setup failed — ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }
}
