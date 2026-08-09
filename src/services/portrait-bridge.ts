/**
 * GM-side bridge to **Ginzzzu's Portraits & NPC Dock** (`ginzzzu-portraits`).
 *
 * Ported from the same integration in `foundry-story-deck`, which worked out the
 * awkward parts:
 *
 * - `GinzzzuPortraits.togglePortrait(actor)` is GM-only and works by writing an
 *   actor flag, which Foundry replicates to every client.
 * - It is a *toggle*, so the current state must be read first — firing blindly
 *   would hide a portrait that is already up.
 * - We track what we raised and only ever lower that, so a portrait the GM
 *   pinned by hand is never closed out from under them.
 *
 * Everything degrades to a no-op when the module is absent, disabled, or we
 * aren't the GM — this is an enhancement, never a dependency.
 */
import {
  LOG_PREFIX,
  MODULE_ID,
  PORTRAITS_MODULE_ID,
  PORTRAIT_SHOWN_FLAG,
  SETTINGS,
} from "../constants.js";

interface PortraitsApi {
  togglePortrait(actorOrId: unknown): Promise<void>;
}

/**
 * Portraits this module raised. GM-client only and intentionally not persisted —
 * a reload simply leaves whatever is on screen alone.
 */
const raisedByUs = new Set<string>();

/** Pending "drop this portrait" timers, keyed by world actor id. */
const lingerTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * How long to hold a portrait after targeting when the action deals damage or
 * healing but hasn't applied it yet. Damage is a separate, player-driven chat-card
 * step, so this must comfortably outlast "read the card, roll damage, apply it."
 * It's only the fallback for when the effect never lands (a miss, or the player
 * walks away); a real hit re-arms the short linger the moment damage applies.
 */
const EFFECT_GRACE_MS = 45_000;

/** The portraits API, or `null` when it isn't available to us. */
function api(): PortraitsApi | null {
  if (!game.user?.isGM) return null;
  if (!game.modules.get(PORTRAITS_MODULE_ID)?.active) return null;
  const found = (globalThis as { GinzzzuPortraits?: PortraitsApi }).GinzzzuPortraits;
  return typeof found?.togglePortrait === "function" ? found : null;
}

function enabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.portraitIntegration) !== false;
}

function lingerMs(): number {
  const raw = Number(game.settings.get(MODULE_ID, SETTINGS.portraitLingerSeconds));
  const seconds = Number.isFinite(raw) && raw >= 0 ? raw : 2;
  return seconds * 1000;
}

function getActor(actorId: string): AnyObject | undefined {
  return (game.actors as { get?: (id: string) => AnyObject | undefined } | undefined)?.get?.(
    actorId,
  );
}

function isShown(actor: AnyObject): boolean {
  return Boolean(foundry.utils.getProperty(actor, PORTRAIT_SHOWN_FLAG));
}

/** Raise or lower one portrait, but only when it isn't already in that state. */
async function setShown(portraits: PortraitsApi, actorId: string, shown: boolean): Promise<void> {
  const actor = getActor(actorId);
  if (!actor) return;
  if (isShown(actor) === shown) return;
  await portraits.togglePortrait(actor);
}

function clearLinger(actorId: string): void {
  const handle = lingerTimers.get(actorId);
  if (handle === undefined) return;
  clearTimeout(handle);
  lingerTimers.delete(actorId);
}

/**
 * (Re)start the countdown to lowering a portrait. Called again on every damage
 * or healing hit, so the portrait drops N seconds after the *last* thing that
 * happened to that actor rather than N seconds after it was first targeted.
 *
 * @param ms Countdown length; defaults to the configured linger.
 */
export function armLinger(actorId: string, ms: number = lingerMs()): void {
  if (!api() || !enabled()) return;
  clearLinger(actorId);
  const handle = setTimeout(() => {
    lingerTimers.delete(actorId);
    void lowerIfOurs(actorId);
  }, ms);
  lingerTimers.set(actorId, handle);
}

/**
 * Cut short the hold on portraits raised for an action that never happened.
 *
 * Re-arms the *short* linger rather than lowering on the spot: the portrait may
 * have appeared a fraction of a second ago, and yanking it mid-animation reads
 * as a glitch. This mostly matters for attacks, which take the 45-second
 * `EFFECT_GRACE_MS` hold — without this an abandoned attack parks the target on
 * screen for the better part of a minute.
 *
 * Portraits the GM raised by hand are unaffected: `lowerIfOurs` only touches
 * what we put up.
 */
export function releaseTargets(actorIds: string[]): void {
  for (const actorId of actorIds) armLinger(actorId);
}

/** Lower a portrait, but only if we were the ones who raised it. */
async function lowerIfOurs(actorId: string): Promise<void> {
  const portraits = api();
  if (!portraits) {
    raisedByUs.delete(actorId);
    return;
  }
  // Raised by hand before we got involved — leave it up.
  if (!raisedByUs.has(actorId)) return;

  try {
    await setShown(portraits, actorId, false);
  } catch (error) {
    console.warn(`${LOG_PREFIX} Could not lower a target portrait.`, error);
  } finally {
    raisedByUs.delete(actorId);
  }
}

/**
 * Raise the portraits of everything just targeted, and start their countdowns.
 *
 * Portraits that were already up are left registered for the linger timer but
 * not recorded as ours, so they animate and then stay put.
 *
 * @param expectsEffect When the action deals damage/healing, hold on the longer
 *   safety window rather than the short linger — the effect lands later, in a
 *   separate step, and will re-arm the short linger when it does.
 */
export async function raiseTargets(actorIds: string[], expectsEffect: boolean): Promise<void> {
  const portraits = api();
  if (!portraits || !enabled()) return;

  const holdMs = expectsEffect ? EFFECT_GRACE_MS : lingerMs();

  for (const actorId of actorIds) {
    try {
      const actor = getActor(actorId);
      if (!actor) continue;

      if (!isShown(actor)) {
        await setShown(portraits, actorId, true);
        raisedByUs.add(actorId);
      }
      armLinger(actorId, holdMs);
    } catch (error) {
      // Never let a cosmetic integration interrupt play.
      console.warn(`${LOG_PREFIX} Could not raise a target portrait.`, error);
    }
  }
}
