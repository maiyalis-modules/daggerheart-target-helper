/**
 * Reads the bits of an actor's state the target picker puts on screen: whether
 * they're down, and what conditions they're carrying.
 *
 * Conditions are plain Foundry status effects — the system registers its own on
 * `CONFIG.statusEffects` during `setup` (daggerheart.js:41506), so `actor.statuses`
 * is the single source of truth for both system and core conditions.
 *
 * Everything here is display-only and defensive: a system update that moves any
 * of this should cost the picker a badge, never throw mid-action.
 */
import { LOG_PREFIX } from "../constants.js";

/** A condition to show next to a target. */
export interface ConditionBadge {
  id: string;
  /** Localized, ready to display. */
  name: string;
  img: string;
}

/**
 * The system's defeat family (daggerheart.js:213). Which one an actor gets is a
 * GM automation setting — characters and adversaries have separate defaults — so
 * treat any of them as "down".
 */
const DEFEATED_FALLBACK = ["deathMove", "defeated", "unconscious", "dead"] as const;

/**
 * Read the defeat ids from the system config, falling back to the known set.
 * Deliberately uses `defeatedConditionChoices` (a plain object) rather than
 * `conditions()`, which reads a game setting to resolve icons — we only want ids.
 */
function defeatedIds(): readonly string[] {
  const choices = CONFIG?.["DH"]?.["GENERAL"]?.["defeatedConditionChoices"] as
    | Record<string, { id?: string }>
    | undefined;
  if (!choices) return DEFEATED_FALLBACK;

  const ids = Object.values(choices)
    .map((choice) => choice?.id)
    .filter((id): id is string => typeof id === "string");
  return ids.length > 0 ? ids : DEFEATED_FALLBACK;
}

/** Status ids currently on the actor. Empty when there's nothing to read. */
function statusesOf(actor: AnyObject | null | undefined): Set<string> {
  const statuses = actor?.["statuses"] as Set<string> | undefined;
  return statuses instanceof Set ? statuses : new Set<string>();
}

/** The registered status effect for an id, for its localized name and icon. */
function statusEffect(id: string): ConditionBadge | null {
  const entries = (CONFIG?.["statusEffects"] ?? []) as { id?: string; name?: string; img?: string }[];
  const found = entries.find((entry) => entry.id === id);
  if (!found) return null;

  return {
    id,
    // System conditions arrive pre-localized; core ones as keys. `localize`
    // returns anything that isn't a key unchanged, so this is safe either way.
    name: game.i18n.localize(found.name ?? id),
    img: found.img ?? "",
  };
}

/**
 * Whether hit points are fully marked (value ≥ max, max > 0).
 *
 * The raw damage signal, independent of any status: the system's defeat
 * automation is a setting the GM can switch off, and it applies *after* damage
 * lands. Callers that run at the moment of damage want this one.
 */
export function hitPointsFull(actor: AnyObject | null | undefined): boolean {
  const hp = actor?.["system"]?.["resources"]?.["hitPoints"] as
    | { value?: number; max?: number }
    | undefined;
  return Boolean(hp && (hp.max ?? 0) > 0 && (hp.value ?? 0) >= (hp.max ?? 0));
}

/**
 * The actor's defeat badge, or `null` if they're up.
 *
 * Prefers the actual condition, so the picker can say *how* they're down
 * ("Unconscious" reads very differently from "Dead" when you're choosing whom to
 * hit). Falls back to fully-marked hit points, which covers tables running with
 * defeat automation disabled.
 */
export function defeatedBadge(actor: AnyObject | null | undefined): ConditionBadge | null {
  try {
    const statuses = statusesOf(actor);
    for (const id of defeatedIds()) {
      if (!statuses.has(id)) continue;
      return statusEffect(id) ?? { id, name: game.i18n.localize("DHTH.Picker.Defeated"), img: "" };
    }

    if (!hitPointsFull(actor)) return null;
    return { id: "defeated", name: game.i18n.localize("DHTH.Picker.Defeated"), img: "" };
  } catch (error) {
    console.warn(`${LOG_PREFIX} Could not read an actor's defeat state.`, error);
    return null;
  }
}

/**
 * Conditions worth showing alongside a target, defeat excluded — that gets its
 * own treatment on the row rather than competing with Vulnerable or Hidden.
 */
export function activeConditions(actor: AnyObject | null | undefined): ConditionBadge[] {
  try {
    const excluded = new Set(defeatedIds());
    const badges: ConditionBadge[] = [];

    for (const id of statusesOf(actor)) {
      if (excluded.has(id)) continue;
      const badge = statusEffect(id);
      if (badge) badges.push(badge);
    }

    badges.sort((a, b) => a.name.localeCompare(b.name));
    return badges;
  } catch (error) {
    console.warn(`${LOG_PREFIX} Could not read an actor's conditions.`, error);
    return [];
  }
}
