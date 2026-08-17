/**
 * Band colours for the picker's distance chip, matching **Daggerheart: Distances**
 * (`daggerheart-distances`) so a chip reads the same as the ring the player just
 * saw on the canvas.
 *
 * An *optional* alignment, never a dependency: without that module — or if its
 * palette setting can't be read — the traffic-light default is used, which is
 * also its own default. Nothing here degrades to a missing chip.
 *
 * ## Why the table is copied rather than imported
 *
 * Its palettes live in `scripts/constants.js` as a plain export, so a dynamic
 * `import()` of `modules/daggerheart-distances/scripts/constants.js` would work
 * — but only asynchronously, and this is read while rendering a row. Four
 * frozen hex triples are not worth an await, a cache, and a failure mode.
 *
 * **Verified against daggerheart-distances v0.2.6.** If the chips stop matching
 * the rings after an update, re-read that file and fix the table HERE. Its
 * `ring1`–`ring4` are melee/veryClose/close/far in that order (`DEFAULTS.ranges`).
 */
import type { DistanceBand } from "../targeting/range.js";

/** Its module id — only ever used to ask for its palette setting. */
const DISTANCES_MODULE_ID = "daggerheart-distances";

/** Its setting key holding the chosen palette (`registration.js:120`). */
const PALETTE_SETTING = "colorPalette";

/** Palette key it falls back to, and so do we. */
const DEFAULT_PALETTE = "default";

/** Its four palettes, keyed the way its setting stores them. */
const PALETTES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  // "Traffic Light" — close is dangerous, far is safe.
  default: { melee: "#ff0000", veryClose: "#ffa500", close: "#ffff00", far: "#90ee90" },
  // "Inverse Traffic Light".
  option2: { melee: "#90ee90", veryClose: "#ffff00", close: "#ffa500", far: "#ff0000" },
  // "Synthwave".
  option3: { melee: "#ff00ff", veryClose: "#bd00ff", close: "#00aaff", far: "#00ffff" },
  // "True Fire".
  option4: { melee: "#ff0000", veryClose: "#ff4500", close: "#ffa500", far: "#ffcc00" },
};

/** Whichever palette the table is using on the canvas right now. */
function activePalette(): Readonly<Record<string, string>> {
  const fallback = PALETTES[DEFAULT_PALETTE]!;
  if (game.modules.get(DISTANCES_MODULE_ID)?.active !== true) return fallback;

  try {
    const key = String(game.settings.get(DISTANCES_MODULE_ID, PALETTE_SETTING) ?? "");
    return PALETTES[key] ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * The band's colour as space-separated RGB channels (`"255 165 0"`), ready to
 * drop into a CSS custom property and compose with alpha — `rgb(var(--x) / 20%)`
 * — the way the rest of `styles/module.css` tints things.
 *
 * Null for `veryFar` and for anything unresolvable, which is the stylesheet's cue
 * to use its own neutral. Returning channels rather than the hex also means the
 * value written into the markup can only ever be three numbers.
 */
export function bandColorChannels(band: DistanceBand | null): string | null {
  if (!band || band === "veryFar") return null;

  const hex = activePalette()[band];
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return null;

  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r} ${g} ${b}`;
}
