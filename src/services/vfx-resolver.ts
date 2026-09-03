/**
 * Decides which animations depict an action, and where each one goes.
 *
 * Resolution order, most specific first:
 *
 *   1. a per-action config stored on the item
 *   2. the auto-recognition table below
 *   3. nothing
 *
 * Step 1 is the point of the whole design. Daggerheart actions are not documents
 * — they are entries in `item.system.actionsList`, each with a stable `_id` — so
 * the config lives in an item flag keyed by that id rather than on the action
 * itself. That is what keeps a Grimoire's three actions independently mappable
 * instead of collapsing to one animation for the whole item.
 *
 * A config is a *list* of steps rather than a single animation. One action often
 * wants more than one: a cast on the caster and an impact on the target are two
 * different assets, and a projectile between them will be a third. Keeping the
 * list as the shape means adding that third is a renderer change rather than
 * another migration of everything a campaign has saved.
 */
import { MODULE_ID } from "../constants.js";
import { AUTOREC } from "./vfx-autorec.js";
import { DEFAULT_PLACEMENT, type VfxFlip, type VfxPlacement } from "./portrait-fx.js";

/** Which portrait (or portraits) a step is drawn on. */
export type VfxTarget = "target" | "caster" | "both" | "spanning";

/** Which roll outcomes an action's animations play for. */
export type VfxPlayOn = "always" | "hit" | "miss";

/**
 * How an action's steps are timed against each other.
 *
 * `"after"` waits for a step's video to actually finish rather than guessing at a
 * delay, so it stays correct whatever the asset's length or its `speed`.
 */
export type VfxSequence = "together" | "after";

/** One animation within an action. */
export interface VfxStep {
  on: VfxTarget;
  /** A Sequencer database key, or a literal `modules/...` path. */
  key: string;
  placement: VfxPlacement;
  flip: VfxFlip;
  /** Offset before this step starts — from the action, or from the previous
   * step finishing when the sequence is `"after"`. */
  delayMs: number;
  /**
   * Playback rate. 1 is the asset as authored; below 1 slows it, above speeds it
   * up. JB2A pitches its timing at a combat pace on a battle map, which is not
   * always the pace a portrait wants.
   */
  speed: number;
  /**
   * Spanning steps only: how far past the two portrait centres to draw.
   *
   * 1 runs exactly centre to centre. JB2A's ranged assets carry transparent
   * lead-in and lead-out inside the strip, so at 1 the *visible* projectile starts
   * inside the caster's half and stops short of the target — pushing this above 1
   * extends the strip symmetrically until the visible part reaches both centres.
   * How much padding an asset has varies, so this is per step rather than a fixed
   * fudge factor.
   */
  reach: number;
}

/** One action's animation settings — the shape stored in the item flag. */
export interface ActionVfx {
  enabled: boolean;
  playOn: VfxPlayOn;
  sequence: VfxSequence;
  steps: VfxStep[];
}

const STEP_DEFAULTS: Omit<VfxStep, "key"> = {
  on: "target",
  placement: DEFAULT_PLACEMENT,
  flip: "auto",
  delayMs: 0,
  speed: 1,
  reach: 1,
};

export function blankVfxStep(): VfxStep {
  return { ...STEP_DEFAULTS, placement: { ...DEFAULT_PLACEMENT }, key: "" };
}

export function blankActionVfx(): ActionVfx {
  return { enabled: true, playOn: "always", sequence: "together", steps: [blankVfxStep()] };
}

/** Fill in whatever a stored or matched step left out. */
function stepWithDefaults(partial: Partial<VfxStep> & { key: string }): VfxStep {
  return {
    ...STEP_DEFAULTS,
    ...partial,
    placement: { ...DEFAULT_PLACEMENT, ...(partial.placement ?? {}) },
  };
}


/** Where one action's config lives inside the module's flag namespace. */
export function vfxFlagKey(actionId: string): string {
  return `vfx.${actionId}`;
}

/**
 * Normalise whatever is on the item into the current shape.
 *
 * Configs saved before animations became a list are a single flat animation —
 * `key`, `on`, `placement` and friends directly on the object. Those are read as
 * a one-step list rather than migrated in place: a campaign's saved flags keep
 * working untouched, and they are only rewritten if someone opens the form and
 * saves. An `on: "both"` from that era stays one step drawn on both portraits,
 * which is exactly what it used to do.
 */
function normalize(stored: unknown): ActionVfx | null {
  if (!stored || typeof stored !== "object") return null;
  const raw = stored as { steps?: unknown } & Partial<ActionVfx> & Partial<VfxStep>;

  const hasKey = (step: unknown): step is Partial<VfxStep> & { key: string } =>
    Boolean(step) && typeof (step as { key?: unknown }).key === "string";

  const steps: VfxStep[] = Array.isArray(raw.steps)
    ? raw.steps.filter(hasKey).map(stepWithDefaults)
    : hasKey(raw)
      ? [stepWithDefaults(raw)]
      : [];

  if (steps.length === 0) return null;

  return {
    enabled: raw.enabled ?? true,
    playOn: raw.playOn ?? "always",
    sequence: raw.sequence ?? "together",
    steps,
  };
}

/**
 * Read one action's stored config straight off an item, without falling back to
 * auto-recognition.
 *
 * The config form needs to know whether *this action* has been configured, which
 * is a different question from what would play if it were used — a form that
 * silently showed an inherited autorec match would invite someone to "save" it
 * and pin down a value they never chose.
 */
export function readStoredVfx(item: DhItem | null | undefined, actionId: string): ActionVfx | null {
  return normalize(item?.getFlag?.(MODULE_ID, vfxFlagKey(actionId)));
}

export async function writeStoredVfx(
  item: DhItem,
  actionId: string,
  config: ActionVfx,
): Promise<void> {
  await item.setFlag?.(MODULE_ID, vfxFlagKey(actionId), config);
}

export async function clearStoredVfx(item: DhItem, actionId: string): Promise<void> {
  await item.unsetFlag?.(MODULE_ID, vfxFlagKey(actionId));
}

/**
 * Key suggestions for the config form's autocomplete.
 *
 * `searchFor` pops a UI notification when handed an empty string, so the guard
 * here is not just tidiness. Returns an empty list whenever Sequencer is absent,
 * which leaves the field a plain text input rather than breaking it.
 */
export function suggestVfxKeys(query: string, limit = 40): string[] {
  try {
    const trimmed = query.trim();
    if (trimmed.length < 3) return [];

    const database = (globalThis as { Sequencer?: { Database?: DhSequencerDatabase } }).Sequencer
      ?.Database;
    const found = database?.searchFor?.(trimmed);
    if (!Array.isArray(found)) return [];

    return found.filter((entry): entry is string => typeof entry === "string").slice(0, limit);
  } catch {
    return [];
  }
}

/** The auto-recognition match, or null when nothing in the table applies. */
function fromAutorec(action: DhAction): ActionVfx | null {
  const names = [action.name, action.item?.name];
  for (const raw of names) {
    const name = (raw ?? "").toLowerCase();
    if (!name) continue;
    for (const [needle, partial] of AUTOREC) {
      if (name.includes(needle)) {
        return {
          enabled: true,
          playOn: "always",
          sequence: "together",
          steps: [stepWithDefaults(partial)],
        };
      }
    }
  }
  return null;
}

export function resolveActionVfx(action: DhAction): ActionVfx | null {
  const config = readStoredVfx(action.item, action._id) ?? fromAutorec(action);
  if (!config || !config.enabled) return null;
  const steps = config.steps.filter((step) => step.key.trim() !== "");
  if (steps.length === 0) return null;
  return { ...config, steps };
}

/**
 * Turn a stored key into a file the browser can play.
 *
 * Sequencer indexes every JB2A asset under dotted keys, and keys survive library
 * updates in a way raw paths do not — so they are the preferred form. Literal
 * `modules/...` paths are still accepted, both because they are what the hardcoded
 * entries above use and because Sequencer is an optional install here.
 *
 * A key resolving to several files (colour and variant siblings) picks the first
 * rather than a random one: the acting client resolves this once and broadcasts
 * the result, so an unstable choice would only make the same key look different
 * between sessions for no gain.
 */
export function resolveVfxPath(key: string): string | null {
  try {
    if (key.startsWith("modules/")) return key;

    const database = (globalThis as { Sequencer?: { Database?: DhSequencerDatabase } }).Sequencer
      ?.Database;
    if (!database?.getEntry) return null;

    const entry = database.getEntry(key, { softFail: true });
    if (!entry) return null;

    const candidates = Array.isArray(entry) ? entry : [entry];
    for (const candidate of candidates) {
      const files = candidate?.getAllFiles?.() ?? [];
      const found = files.find((file) => typeof file === "string");
      if (found) return found;
    }
    return null;
  } catch {
    // A bad key is a configuration mistake, not a reason to break the action.
    return null;
  }
}
