/**
 * Range-band gating for the target picker.
 *
 * Reuses the system's own range vocabulary rather than depending on any
 * distance-visualizing module: an action's `range` field (melee/veryClose/
 * close/far/veryFar, from `RangeField` — daggerheart.js:35174, part of every
 * action's schema via `DHBaseAction.extraSchemas` at daggerheart.js:17425) and
 * `Token#distanceTo`, the same core method the system itself uses to gate
 * range-dependent active effects (`updateActorsRangeDependentEffects`,
 * daggerheart.js:43289).
 *
 * The foot thresholds for the first four bands live in the world's
 * `VariantRules` setting (daggerheart.js:22435-22456, defaults 5/15/30/60).
 * `veryFar` and a blank range have no upper threshold in that setting — they
 * mean "no restriction" here too.
 */
import { DAGGERHEART_ID } from "../constants.js";

/** World setting key holding variant-rule data, including range thresholds (daggerheart.js:3892). */
const VARIANT_RULES_SETTING = "VariantRules";

type RangeBand = "melee" | "veryClose" | "close" | "far";

const GATED_BANDS: readonly RangeBand[] = ["melee", "veryClose", "close", "far"];

function isGatedBand(range: string): range is RangeBand {
  return (GATED_BANDS as readonly string[]).includes(range);
}

/** Foot thresholds for the gated bands, or null if the setting isn't readable. */
function rangeThresholds(): Record<RangeBand, number> | null {
  try {
    const variantRules = game.settings.get(DAGGERHEART_ID, VARIANT_RULES_SETTING) as AnyObject;
    const measurement = variantRules?.["rangeMeasurement"] as AnyObject | undefined;
    if (!measurement) return null;

    const thresholds = {
      melee: Number(measurement["melee"]),
      veryClose: Number(measurement["veryClose"]),
      close: Number(measurement["close"]),
      far: Number(measurement["far"]),
    };
    return Object.values(thresholds).every(Number.isFinite) ? thresholds : null;
  } catch {
    return null;
  }
}

/** The placed token for an actor on the active scene, if any. */
export function findActingToken(actor: DhActor | null): Token | null {
  if (!actor) return null;
  const tokens = canvas.tokens?.placeables ?? [];
  return tokens.find((token) => token.actor?.uuid === actor.uuid) ?? null;
}

/**
 * Whether `target` is within `range` of `source`.
 *
 * Defaults to `true` (no gating) whenever the answer can't be determined: no
 * source token on the scene, no declared range, or a band with no defined cap
 * (`self`, `veryFar`). A system update that moves the setting should degrade
 * to "everyone's a valid target" rather than locking the picker up.
 */
export function isWithinRange(
  source: Token | null,
  target: Token,
  range: string | null | undefined,
): boolean {
  if (!source || !range || !isGatedBand(range)) return true;

  const thresholds = rangeThresholds();
  if (!thresholds) return true;

  return source.distanceTo(target) <= thresholds[range];
}
