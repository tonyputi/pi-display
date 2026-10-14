import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SHOW, SHOW_OPTIONS } from "./protocol.ts";

export interface DisplayConfig {
  /** Page elements to show; defaults to DEFAULT_SHOW. */
  show: string[];
}

const CONFIG_KEY = "pi-display";

function agentDir(): string {
  return process.env.PI_AGENT_DIR ?? join(process.env.HOME ?? "", ".pi", "agent");
}

/**
 * Read the "pi-display" key from pi settings: the agent-wide settings.json and
 * the project's .pi/settings.json (project wins). Unknown or invalid entries
 * fall back to the defaults.
 */
export function loadDisplayConfig(projectDir: string): DisplayConfig {
  const global = readSettingsFile(join(agentDir(), "settings.json"));
  const project = readSettingsFile(join(projectDir, ".pi", "settings.json"));
  const raw = { ...global[CONFIG_KEY], ...project[CONFIG_KEY] } as Record<string, unknown>;
  return { show: normalizeShow(raw.show) };
}

function readSettingsFile(path: string): Record<string, unknown> {
  try {
    if (!existsSync(path)) return {};
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function normalizeShow(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_SHOW];
  const show = value.filter((s): s is string => typeof s === "string" && (SHOW_OPTIONS as readonly string[]).includes(s));
  return show.length > 0 ? [...new Set(show)] : [...DEFAULT_SHOW];
}
