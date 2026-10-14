import type { DisplayFrame } from "./display.ts";
import { drawRect, fillRect, setPixel } from "./pixels.ts";
import { drawText, GLYPH_ADVANCE, GLYPH_HEIGHT, textWidth, truncateToWidth, type BitmapFont } from "./font.ts";
import type { SessionData } from "./protocol.ts";

export const SCREEN_WIDTH = 128;
export const SCREEN_HEIGHT = 64;
const BAR_Y = 44;
const BAR_HEIGHT = 12;
const TOKENS_Y = 10;
const COST_Y = 18;
const FOOTER_Y = 56;
const FOOTER_HEIGHT = 8;
const SPLASH_SECONDS = 5;
const ROTATION_SECONDS = 4;

export interface CompositorOptions {
  /** Font used for all text rendering. */
  font: BitmapFont;
  /** Frame shown at startup (the logo). Also downscaled for the idle screen. */
  splash?: DisplayFrame;
  splashSeconds?: number;
}

/**
 * Decides what is on screen: splash at startup, one page per session
 * (header / context bar / numbers+cost / inverted status footer), an idle
 * screen when no sessions are registered, and rotation across sessions.
 */
export class Compositor {
  private readonly font: BitmapFont;
  private readonly splash?: DisplayFrame;
  private splashLeft: number;
  private readonly sessions = new Map<string, SessionData>();
  private rotationIndex = 0;
  private rotationCountdown = ROTATION_SECONDS;

  constructor(options: CompositorOptions) {
    this.font = options.font;
    this.splash = options.splash;
    this.splashLeft = options.splash ? (options.splashSeconds ?? SPLASH_SECONDS) : 0;
  }

  get pageCount(): number {
    return this.sessions.size;
  }

  /** True while the splash is on screen. */
  get showingSplash(): boolean {
    return this.splashLeft > 0;
  }

  /** Upsert one session page. Keeps the rotation position stable across updates. */
  setSession(data: SessionData): void {
    this.sessions.set(data.id, { ...data });
    this.clampRotation();
  }

  endSession(id: string): void {
    this.sessions.delete(id);
    this.clampRotation();
  }

  /** Advance splash/rotation timers; returns true when the screen must be redrawn. */
  tick(): boolean {
    if (this.splashLeft > 0) {
      this.splashLeft -= 1;
      return this.splashLeft === 0;
    }
    if (this.sessions.size > 1 && --this.rotationCountdown === 0) {
      this.rotationCountdown = ROTATION_SECONDS;
      this.rotationIndex = (this.rotationIndex + 1) % this.sessions.size;
      return true;
    }
    return false;
  }

  /** Build the frame for the current state. Pure: does not advance timers. */
  buildFrame(): DisplayFrame {
    if (this.showingSplash && this.splash) return this.splash;
    if (this.sessions.size === 0) return this.idleFrame();
    const pages = [...this.sessions.values()].sort((a, b) => a.name.localeCompare(b.name));
    return this.sessionFrame(pages[this.rotationIndex % pages.length]!, this.rotationIndex + 1, pages.length);
  }

  private clampRotation(): void {
    if (this.rotationIndex >= this.sessions.size) this.rotationIndex = 0;
    this.rotationCountdown = ROTATION_SECONDS;
  }

  private sessionFrame(page: SessionData, position: number, total: number): DisplayFrame {
    const frame = this.newFrame();
    const show = new Set(page.show);
    const indicator = total > 1 ? `${position}/${total}` : "";
    const nameWidth = SCREEN_WIDTH - 2 - (indicator ? textWidth(indicator) + 2 * GLYPH_ADVANCE : 0);
    drawText(frame, this.font, truncateToWidth(page.name || "session", nameWidth), 1, 0);
    if (indicator) {
      drawText(frame, this.font, indicator, SCREEN_WIDTH - 1 - textWidth(indicator), 0);
    }

    if (show.has("bar")) this.drawContextBar(frame, page);
    if (show.has("tokens") && page.ctxTokens !== null && page.ctxWindow !== null) {
      drawText(frame, this.font, truncateToWidth(`${formatTokens(page.ctxTokens)}/${formatTokens(page.ctxWindow)}`, SCREEN_WIDTH - 2), 1, TOKENS_Y);
    }
    if (show.has("cost") && page.cost !== null) {
      drawText(frame, this.font, `$${page.cost.toFixed(2)}`, 1, COST_Y);
    }
    if (show.has("state") || (show.has("model") && page.model)) this.drawFooter(frame, page, show);
    return frame;
  }

  private drawContextBar(frame: DisplayFrame, page: SessionData): void {
    drawRect(frame, 0, BAR_Y, SCREEN_WIDTH, BAR_HEIGHT);
    const innerWidth = SCREEN_WIDTH - 2;
    let filled = 0;
    if (page.ctxPercent === null) {
      // Unknown usage (e.g. right after compaction): hatched fill.
      for (let x = 1; x <= innerWidth; x += 4) fillRect(frame, x, BAR_Y + 1, 1, BAR_HEIGHT - 2);
    } else {
      const clamped = Math.min(100, Math.max(0, page.ctxPercent));
      filled = Math.round((innerWidth * clamped) / 100);
      fillRect(frame, 1, BAR_Y + 1, filled, BAR_HEIGHT - 2);
    }
    // Percentage inside the bar, XOR-drawn so it stays readable over fill and emptiness.
    const label = page.ctxPercent === null ? "--%" : `${Math.round(page.ctxPercent)}%`;
    drawText(frame, this.font, label, Math.floor((SCREEN_WIDTH - textWidth(label)) / 2), BAR_Y + Math.floor((BAR_HEIGHT - GLYPH_HEIGHT) / 2), "xor");
  }

  private drawFooter(frame: DisplayFrame, page: SessionData, show: Set<string>): void {
    fillRect(frame, 0, FOOTER_Y, SCREEN_WIDTH, FOOTER_HEIGHT);
    if (show.has("state")) {
      // Working: right-pointing triangle (play). Idle: pause bars.
      if (page.state === "working") {
        for (let r = 0; r < 7; r++) fillRect(frame, 2, FOOTER_Y + 1 + r, 1 + Math.min(r, 6 - r), 1, 0);
      } else {
        fillRect(frame, 2, FOOTER_Y + 2, 2, 5, 0);
        fillRect(frame, 5, FOOTER_Y + 2, 2, 5, 0);
      }
    }
    if (show.has("model") && page.model) {
      const model = truncateToWidth(page.model, SCREEN_WIDTH - 2 - 8);
      if (model) drawText(frame, this.font, model, SCREEN_WIDTH - 1 - textWidth(model), FOOTER_Y + 1, 0);
    }
  }

  private idleFrame(): DisplayFrame {
    const frame = this.newFrame();
    if (this.splash) {
      // Centered half-scale logo above the footer.
      const width = Math.floor(this.splash.width / 2);
      const height = Math.floor(this.splash.height / 2);
      const x = Math.floor((SCREEN_WIDTH - width) / 2);
      const y = Math.floor((FOOTER_Y - height) / 2);
      for (let dy = 0; dy < height; dy++) {
        for (let dx = 0; dx < width; dx++) {
          const value = this.splash.pixels[dy * 2 * this.splash.width + dx * 2] ? 1 : 0;
          setPixel(frame, x + dx, y + dy, value);
        }
      }
    }
    fillRect(frame, 0, FOOTER_Y, SCREEN_WIDTH, FOOTER_HEIGHT);
    const label = "NO SESSIONS";
    drawText(frame, this.font, label, Math.floor((SCREEN_WIDTH - textWidth(label)) / 2), FOOTER_Y + 1, 0);
    return frame;
  }

  private newFrame(): DisplayFrame {
    return { width: SCREEN_WIDTH, height: SCREEN_HEIGHT, pixels: new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT) };
  }
}

function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : `${tokens}`;
}
