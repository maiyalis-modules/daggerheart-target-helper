/**
 * Range measurement for the target picker: how far away a candidate is, which
 * band that falls in, and whether the action can reach it.
 *
 * Reuses the system's own range vocabulary rather than depending on any
 * distance-visualizing module: an action's `range` field (melee/veryClose/
 * close/far/veryFar, from `RangeField` — daggerheart.js:35174, part of every
 * action's schema via `DHBaseAction.extraSchemas` at daggerheart.js:17425) and
 * `Token#distanceTo`, the same core method the system itself uses to gate
 * range-dependent active effects (`updateActorsRangeDependentEffects`,
 * daggerheart.js:43289).
 *
 * Two settings decide what a distance *means* in a given world, and both are
 * mirrored here so the picker never disagrees with the ruler:
 * - The world's `VariantRules.rangeMeasurement` (daggerheart.js:22435-22456)
 *   holds the foot thresholds for the first four bands (defaults 5/15/30/60)
 *   and an `enabled` flag — **on by default** — which makes the system print
 *   band *names* instead of numbers everywhere it shows a distance.
 * - A scene may override that (`scene.flags.daggerheart.rangeMeasurement`,
 *   daggerheart.js:37731): `custom` supplies its own thresholds, `disable` puts
 *   plain numbers back on this scene only. `DhMeasuredTemplate.getRangeLabels`
 *   (daggerheart.js:40206) is the routine being mirrored.
 *
 * `veryFar` and a blank range have no upper threshold in any of that — they
 * mean "no restriction" for gating, and "further than Far" for display.
 */
import { DAGGERHEART_ID } from "../constants.js";

/** World setting key holding variant-rule data, including range thresholds (daggerheart.js:3892). */
const VARIANT_RULES_SETTING = "VariantRules";

/** Scene flag holding this scene's override (daggerheart.js:37731). */
const SCENE_RANGE_FLAG = "rangeMeasurement";

/** Ids from `CONFIG.DH.GENERAL.sceneRangeMeasurementSetting` (daggerheart.js:993). */
const SCENE_CUSTOM = "custom";
const SCENE_DISABLE = "disable";

/** Bands with a defined upper threshold — the only ones that can gate anything. */
type RangeBand = "melee" | "veryClose" | "close" | "far";

/** A band a measured distance can fall in. `veryFar` is "past the last threshold". */
export type DistanceBand = RangeBand | "veryFar";

/** Ascending, which is what makes the `find` below pick the tightest match. */
const GATED_BANDS: readonly RangeBand[] = ["melee", "veryClose", "close", "far"];

function isGatedBand(range: string): range is RangeBand {
  return (GATED_BANDS as readonly string[]).includes(range);
}

/** The world's range variant rule, or null if the setting isn't readable. */
function worldRangeMeasurement(): AnyObject | null {
  try {
    const variantRules = game.settings.get(DAGGERHEART_ID, VARIANT_RULES_SETTING) as AnyObject;
    return (variantRules?.["rangeMeasurement"] as AnyObject | undefined) ?? null;
  } catch {
    return null;
  }
}

/** This scene's override of that rule, if it has set one. */
function sceneRangeMeasurement(): AnyObject | null {
  const flags = canvas.scene?.flags as AnyObject | undefined;
  return (flags?.[DAGGERHEART_ID]?.[SCENE_RANGE_FLAG] as AnyObject | undefined) ?? null;
}

/** Read the four thresholds off a settings-shaped object, or null if any is unusable. */
function readThresholds(source: AnyObject | null): Record<RangeBand, number> | null {
  if (!source) return null;

  const thresholds = {
    melee: Number(source["melee"]),
    veryClose: Number(source["veryClose"]),
    close: Number(source["close"]),
    far: Number(source["far"]),
  };
  // `custom` scene fields have no schema initial, so an unfilled one arrives as
  // null — which `Number()` would happily turn into a threshold of 0.
  return Object.values(thresholds).every((value) => Number.isFinite(value) && value > 0)
    ? thresholds
    : null;
}

/**
 * The foot thresholds in force here: the scene's when it declares `custom` ones,
 * the world's otherwise. Null if neither can be read, which every caller treats
 * as "don't gate, don't label" rather than guessing.
 *
 * Note `disable` is deliberately *not* handled here — it only changes how a
 * distance is displayed on this scene, not how far Melee reaches.
 */
function activeThresholds(): Record<RangeBand, number> | null {
  const scene = sceneRangeMeasurement();
  if (scene?.["setting"] === SCENE_CUSTOM) {
    const custom = readThresholds(scene);
    if (custom) return custom;
  }
  return readThresholds(worldRangeMeasurement());
}

/**
 * Does this world show distances as numbers rather than band names?
 *
 * The variant rule is **on by default**, so most worlds read "Close" where
 * Foundry would say "30 ft" — and the picker should say the same thing the
 * ruler and the token hover do.
 */
function showsNumericDistance(): boolean {
  if (worldRangeMeasurement()?.["enabled"] !== true) return true;
  return sceneRangeMeasurement()?.["setting"] === SCENE_DISABLE;
}

/** The placed token for an actor on the active scene, if any. */
export function findActingToken(actor: DhActor | null): Token | null {
  if (!actor) return null;
  const tokens = canvas.tokens?.placeables ?? [];
  return tokens.find((token) => token.actor?.uuid === actor.uuid) ?? null;
}

/**
 * Measured distance from `source` to `target` in scene grid units.
 *
 * Null whenever there's nothing to measure from — no acting token on the scene,
 * which is routine in Theatre of the Mind play — so callers can tell "zero feet
 * away" apart from "unknown".
 */
export function distanceBetween(source: Token | null, target: Token): number | null {
  if (!source) return null;
  try {
    const distance = source.distanceTo(target);
    return Number.isFinite(distance) ? distance : null;
  } catch {
    return null;
  }
}

/**
 * Which band a measured distance falls in, or null if the thresholds can't be
 * read. Mirrors the system's own `ranges[r] >= distanceValue` comparison, so a
 * target sitting exactly on a threshold is *inside* that band.
 */
export function bandFor(distance: number | null): DistanceBand | null {
  if (distance === null) return null;

  const thresholds = activeThresholds();
  if (!thresholds) return null;

  return GATED_BANDS.find((band) => distance <= thresholds[band]) ?? "veryFar";
}

/**
 * How this world would write that distance: the band's name where the system
 * prints names, otherwise the number plus the scene's units.
 *
 * Falls back to the number whenever the band is unknown — a label is better
 * missing its name than missing entirely.
 */
export function formatDistance(distance: number | null, band: DistanceBand | null): string | null {
  if (distance === null) return null;

  if (!showsNumericDistance() && band) {
    return game.i18n.localize(`DAGGERHEART.CONFIG.Range.${band}.name`);
  }

  // Whole numbers are the common case on a square grid; a diagonal isn't, and
  // three decimal places of "37.417 ft" helps nobody.
  const rounded = Number.isInteger(distance) ? String(distance) : distance.toFixed(1);
  const units = String((canvas.scene?.grid as AnyObject | undefined)?.["units"] ?? "").trim();
  return units ? `${rounded} ${units}` : rounded;
}

/**
 * Whether an already-measured distance is inside `range`.
 *
 * Takes the distance rather than the two tokens so the gate and the chip beside
 * it can never come from two different measurements — and so a `distanceTo` that
 * throws takes the *chip* out (as a null distance) instead of the whole picker.
 *
 * Defaults to `true` (no gating) whenever the answer can't be determined: no
 * measurable distance, no declared range, or a band with no defined cap
 * (`self`, `veryFar`). A system update that moves the setting should degrade to
 * "everyone's a valid target" rather than locking the picker up.
 */
export function isWithinRange(distance: number | null, range: string | null | undefined): boolean {
  if (distance === null || !range || !isGatedBand(range)) return true;

  const thresholds = activeThresholds();
  if (!thresholds) return true;

  return distance <= thresholds[range];
}
