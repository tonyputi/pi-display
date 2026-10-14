# pi-display design

What the OLED shows, and how the pieces produce it. Grounded in what pi's
extension API actually exposes (verified against pi 1.2.0 types).

## Goal

The display is a **status wall for pi sessions**: at a glance, for each
running pi session, see what it is, how full its context window is, and what
it costs — plus the pi logo so the device always identifies itself.

## Data available from a pi session (extension side)

| Data | Source (pi 1.2.0) | Notes |
|---|---|---|
| Session name | `ctx.sessionManager.getSessionName()` | may be undefined; changes fire `session_info_changed` |
| Context % | `ctx.getContextUsage()` → `{ tokens, contextWindow, percent }` | `percent` is `null` right after compaction, before the next model reply |
| Cost | `sessionManager.getEntries()` → per-message `usage { input, output, cacheRead, cacheWrite }` × `ctx.model.cost` rates | approximation: current model rates applied to the whole session; recompute on `turn_end` |
| Busy / idle | `agent_start` / `agent_settled` | same state machine the herdr extension uses |
| Current tool | `tool_execution_start` / `tool_execution_end` | phase 2 (state icon) |
| Model name | `ctx.model` | optional line, phase 2+ |

Refresh triggers (throttled, no per-token churn): `session_start`,
`session_info_changed`, `agent_start`, `agent_settled`, `turn_end`,
`session_shutdown`.

## Architecture: sensor / compositor

```
pi session A ─┐
pi session B ─┼─ JSONL socket ──► pi-displayd ──► pages ──► SSD1306
pi session C ─┘   (data only)      compositor    (text+bar)
```

- **Extension = sensor.** Sends only structured session data to the service.
  It never renders and never touches the display. One process per session.
- **Daemon = compositor.** Owns the page map (`sessionId → page data`),
  decides what is on screen (rotation, splash, idle screen), renders text and
  bars into `DisplayFrame`s, writes to the hardware.

This keeps the display contention-free and makes phase 2 (state icons) a
one-field protocol addition plus one glyph in the daemon.

## Protocol (v2, still JSONL on the same socket)

| Message | Meaning |
|---|---|
| `{ type: "session", id, name, ctxPercent, cost, state }` | upsert a session page (`ctxPercent`/`cost` may be `null`) |
| `{ type: "session_end", id }` | remove a session page |
| `{ type: "show", frame: { width, height, pixels } }` | unchanged: one-shot full-frame override (logo etc.) |
| responses | unchanged: `{"type":"ok"}` / `{"type":"error",message}` |

`id`: stable per pi session (`ctx.sessionManager.getSessionId()`).

## Screen layout (128×64, 5×7 bitmap font, 21 cols × 8 rows)

The screen is divided into **fixed zones** — the eye learns where to look, the
compositor never reflows, and future icons drop into an existing slot:

```
y=0   ┌────────────────────────┐
      │ my-session       1/3   │  header: session name left, page indicator right
y=16  │ ██████████▒42%▒░░░░░   │  body: context bar, 128×12, % XOR-drawn inside
y=32  │ 84k/200k               │  body: tokens (only when show includes "tokens")
      │ $1.23                  │  body: cost (hidden when null or not shown)
y=56  │ ▓▓ ● WORK    gpt-6 ▓▓▓ │  footer (inverted): state left, model right
      └────────────────────────┘
```

- **Header** (row 0, 8 px): session name, truncated; page indicator (`1/3`) on
  the right while rotating.
- **Context bar** (y=16, 12 px tall): the visual anchor. Percentage drawn
  inside with XOR so it stays readable over fill and emptiness; hatched fill
  when usage is unknown.
- **Tokens / cost** (y=32/40): optional lines; everything not in `show` simply
  isn't drawn, and the page never reflows (positions are fixed).
- **Footer** (y=56, inverted strip): left slot = state glyph (8×8) + `WORK` /
  `IDLE`; right slot = model name. Phase-2 sprites replace the glyph in place.

Splash — shown by the daemon **at service start** (logo, ~5 s), so the logo is
always seen at least once per boot:

```
┌────────────────────────┐
│                        │
│        [ pi logo ]     │
│                        │
└────────────────────────┘
```

Idle screen — zero sessions: small logo centered + inverted footer reading
`NO SESSIONS` (same zones, never a blank screen).

- **1 session** → its page, static.
- **N sessions** → rotate alphabetically by name, ~4 s per page, redrawn
  immediately when data changes.
- Compositor ticks at 1 Hz (rotation + future animations); data updates render
  immediately.

## Assets and rendering

- Font: classic 5×7 bitmap font (public domain, the SSD1306 ecosystem
  standard) as a **binary asset file** loaded like the PBM — no code, no deps.
- Bars and glyphs are plain pixel operations in the daemon (fill-rect, hline).
- Text truncates to 21 chars; no scrolling in v1.

## Configuration

**Page content** lives in pi settings (read by the extension, so it can differ
per project): the `pi-display` key in `~/.pi/agent/settings.json` (agent-wide)
and `<project>/.pi/settings.json` (project wins). `show` selects page elements:

```json
{ "pi-display": { "show": ["bar", "cost", "model", "state", "tokens"] } }
```

Options: `bar`, `cost`, `model`, `state`, `tokens`. Default: everything except
`tokens` (bar, cost, model, state). Invalid or missing entries fall back to
the defaults; a broken project file falls back to the agent-wide value.

**Device behavior** (splash duration, rotation speed, idle animation) belongs
to the daemon and will live in `~/.config/pi-display/config.json` when the
mascot lands. Defaults until then: splash 5 s, rotation 4 s.

## The mascot (phase 2)

The mascot owns **idle time**; data owns **busy time**. No conflict for the
full screen:

- No sessions → full-screen procedural blob (breathing, blinking, drawn with
  fills — no sprite assets), 2–4 fps from the compositor tick.
- Sessions active → the same character shrinks to an 8×8 sprite in the
  footer's state slot (2 frames: blink).
- Attention needed → full-screen inversion pulse.

## Phases

1. **v1 — pages**: protocol v2, font asset, compositor with splash/idle/rotation,
   session page (name, context bar with XOR percentage, cost, state, model,
   optional tokens), `pi-display.show` configuration, extension pushes data on
   the events above.
2. **v2 — state icons**: animated glyph in the footer's left slot; attention
   flash takes over the whole frame (full inversion pulses) when input is
   needed.
3. **Later**: model name line, multiple status lines, maybe themes (inverted
   screensaver after long idle).

## Open questions

- Cost rounding on-screen: `$1.23` vs `$1.2345`? (propose: `$` + 2 decimals,
  `$0.xx` for small values)
- Cost accuracy across model switches mid-session: acceptable as approximation?
- Rotation order: alphabetical by name vs most-recently-active first?
- Should `/display` gain a `next` subcommand to force the next page?
- Blob proportions: rounder/bigger? Eye size and blink rate?
