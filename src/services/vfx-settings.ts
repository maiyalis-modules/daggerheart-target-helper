/**
 * Reads the animation options. A tiny module of its own so both the renderer
 * (`portrait-fx`) and the resolver can consult them without importing each other
 * — those two already point one way and a cycle between them would be fragile.
 *
 * Every accessor is defensive: settings are registered at `init`, but these are
 * read from hook handlers and DOM callbacks that can in principle run first, and
 * a cosmetic layer must never throw into an action.
 */
import { MODULE_ID, SETTINGS } from "../constants.js";

/**
 * When an action's animation plays.
 *
 * - `"roll"` — the moment the attack roll resolves (`postRollAction`), before the
 *   damage step. The swing reads on the roll and the damage flash arrives later
 *   on its own.
 * - `"action"` — once the whole action finishes (`postUseAction`), which is after
 *   damage has been applied. Pairs with `chainFlash`, and fires whether or not
 *   damage was ever dealt, so a miss is still depicted.
 */
export type VfxTiming = "roll" | "action";

function read<T>(key: string, fallback: T): T {
  try {
    const value = game.settings?.get?.(MODULE_ID, key);
    return (value ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function vfxEnabled(): boolean {
  return read<boolean>(SETTINGS.vfxEnabled, true) !== false;
}

export function vfxTiming(): VfxTiming {
  const value = read<string>(SETTINGS.vfxTiming, "roll");
  return value === "action" ? "action" : "roll";
}

/**
 * Whether a damage flash waits for the animation on that portrait to finish.
 *
 * Only useful alongside `"action"` timing, where the two would otherwise land on
 * top of each other — damage is applied *inside* the action's workflow, so the
 * flash always arrives before an animation timed to the action's completion.
 */
export function vfxChainFlash(): boolean {
  return read<boolean>(SETTINGS.vfxChainFlash, false) === true;
}
