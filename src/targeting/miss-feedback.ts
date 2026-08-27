/**
 * Miss handling for targeted attacks.
 *
 * When an attack is rolled against one or more targets and hits *none* of them,
 * the system still offers a "Roll Damage" button (it always does). Here we:
 *   - strip that button from the chat card, so a whiff doesn't invite damage, and
 *   - flash a shield-deflect on each missed target's portrait, then let the
 *     normal short linger drop it.
 *
 * This keys off `renderChatMessageHTML`, which fires on every client and on every
 * re-render — so each client plays its own flash (no socket needed) and the work
 * is made idempotent (button removal) or deduped (the flash) accordingly.
 *
 * A *no-target* action (terrain, an object) has an empty `targets` list, so it
 * never matches here and keeps its damage button — which is the intended split.
 *
 * **Hits are read from the system, never from the message's own target rows.**
 * `config.targets[].hit` exists during the workflow (daggerheart.js:40922) but
 * `DHActorRoll`'s schema (daggerheart.js:17130) keeps only id/actorId/name/img/
 * difficulty/evasion — `hit` is stripped on the way into the document. Testing it
 * there reads `undefined`, i.e. "missed", for every target of every attack, which
 * is what used to pull a hit target's portrait down on the miss linger before the
 * damage step had happened. The card itself derives hits at render time, and
 * `system.currentHitTargets` (daggerheart.js:17211) is that same derivation.
 */
import {
  DAMAGE_ROLL_BUTTON_SELECTOR,
  LOG_PREFIX,
  MODULE_ID,
  PRE_DAMAGE_ACTION_HOOK,
  RENDER_CHAT_MESSAGE_HOOK,
  SETTINGS,
} from "../constants.js";
import { worldActorIdFromUuid } from "../services/actor-ids.js";
import { armLinger } from "../services/portrait-bridge.js";
import { playFx } from "../services/portrait-fx.js";

/** A row of `system.targets`. Note there is no `hit` — see the note above. */
interface MessageTarget {
  id: string;
  actorId: string;
}

interface AttackMessageSystem {
  hasRoll?: boolean;
  hasTarget?: boolean;
  hasDamage?: boolean;
  hasHealing?: boolean;
  targets?: MessageTarget[];
  /**
   * Which tab of the card's target section is showing. Set in the constructor
   * (daggerheart.js:17114) and flipped when the GM switches to "selected tokens",
   * where `currentHitTargets` reports the controlled tokens instead and its ids
   * no longer line up with `targets`.
   */
  targeting?: { usingSelect?: boolean };
  /** The targets the roll actually beat (daggerheart.js:17211). */
  currentHitTargets?: { id?: string }[];
}

interface ChatMessageLike {
  id?: string;
  system?: AttackMessageSystem;
}

/** Messages whose block flash has already fired, so re-renders don't repeat it. */
const flashed = new Set<string>();

/**
 * A missed target's portrait lingers a touch longer than the normal (hit) case,
 * so the block/deflect reads before it drops. Deliberately fixed rather than the
 * configurable linger — this is the "nothing landed" beat, not the post-damage one.
 */
const MISS_LINGER_MS = 3000;

export function registerMissFeedback(): void {
  Hooks.on(RENDER_CHAT_MESSAGE_HOOK, onRenderChatMessage);
  Hooks.on(PRE_DAMAGE_ACTION_HOOK, onPreDamageAction);
}

/**
 * Skip the inline (automation-driven) damage roll when an attack hit nothing.
 * Runs on the acting client, before the damage workflow part. Returning `false`
 * aborts the remaining workflow — correct on a miss, where there is nothing to
 * damage — while the attack roll (already done) and its chat card are untouched.
 *
 * Scoped to damaging attacks with targets that all missed. A no-target attack
 * (empty `targets`) is deliberately let through so it can still roll damage.
 *
 * So is an action with **no attack roll**, and that one is not an edge case: a
 * `damage` action ("strike a target of your choice", and every card that simply
 * deals damage) never rolls against anybody, so `TargetField.formatTarget` gives
 * its targets no `hit` at all. Without the `hasRoll` guard below, `some(t => t.hit)`
 * is false for every one of them and this reads a miss into an attack that was
 * never made — silently, because a `false` from a workflow hook hits
 * `executeWorkflow`'s bare `return`, which is `undefined` rather than `false`. The
 * action's own chat card still posts, so nothing looks wrong; the damage simply
 * never rolls, and every workflow part ordered after damage (cost at 150, uses at
 * 160) is skipped too, so the resource is not even spent.
 *
 * There is no miss to respect here: this rule exists to skip targets an attack
 * failed to hit, and an action that never rolled cannot have failed to hit.
 * `isTargetedAttack` below already opens with `hasRoll` for the same reason.
 */
function onPreDamageAction(_action: DhAction, config: DhActionConfig): boolean | void {
  try {
    if (game.settings.get(MODULE_ID, SETTINGS.missFeedback) !== true) return;
    if (config.hasHealing) return;
    if (!config.hasRoll) return;
    const targets = config.targets ?? [];
    if (targets.length === 0) return;
    if (targets.some((t) => t.hit)) return;
    return false;
  } catch (error) {
    console.warn(`${LOG_PREFIX} Miss damage-skip failed.`, error);
    return;
  }
}

/** True when this is a damaging attack that was rolled against chosen targets. */
function isTargetedAttack(system: AttackMessageSystem | undefined): system is AttackMessageSystem {
  return Boolean(
    system?.hasRoll &&
      system.hasTarget &&
      system.hasDamage &&
      !system.hasHealing &&
      (system.targets?.length ?? 0) > 0,
  );
}

/**
 * The targets this attack missed, or `null` when the system can't tell us.
 *
 * Bailing on `null` is deliberate: without a trustworthy hit list the safe move
 * is to leave the card and the portraits exactly as they are — a missing block
 * flash costs nothing, whereas guessing "missed" strips a live damage button and
 * drops a portrait mid-attack.
 */
function missedTargets(system: AttackMessageSystem): MessageTarget[] | null {
  // The GM is looking at the "selected tokens" tab, where the system reports the
  // controlled tokens rather than the rolled-against ones. Their ids don't line
  // up with `targets`, so we have nothing to compare and stay out of it.
  if (system.targeting?.usingSelect) return null;

  const hits = system.currentHitTargets;
  if (!Array.isArray(hits)) return null;

  const hitIds = new Set(hits.map((target) => target.id));
  return (system.targets ?? []).filter((target) => !hitIds.has(target.id));
}

function onRenderChatMessage(message: ChatMessageLike, element: HTMLElement): void {
  try {
    if (game.settings.get(MODULE_ID, SETTINGS.missFeedback) !== true) return;
    if (!isTargetedAttack(message.system)) return;

    const missed = missedTargets(message.system);
    if (missed === null) return;

    // Only a total whiff loses the damage prompt: with anything still standing
    // there is damage to roll. Idempotent, because the system re-adds the button
    // on each render — so strip it every time rather than trusting a one-shot.
    if (missed.length === (message.system.targets?.length ?? 0)) {
      element
        .querySelectorAll(DAMAGE_ROLL_BUTTON_SELECTOR)
        .forEach((button) => button.remove());
    }

    if (missed.length === 0) return;

    // Flash once per message, even though render fires repeatedly.
    const id = message.id;
    if (!id || flashed.has(id)) return;
    flashed.add(id);

    const isGM = game.user?.isGM === true;
    for (const target of missed) {
      const actorId = worldActorIdFromUuid(target.actorId);
      if (!actorId) continue;
      void playFx(actorId, "blocked");
      // Nothing is coming for this one, so the 45s window armed at targeting can
      // hand over to the miss linger. Targets that *were* hit keep that window
      // and drop on the short linger once damage lands, which is the whole point
      // of splitting this per target. GM-only — the raise is GM-authoritative.
      if (isGM) armLinger(actorId, MISS_LINGER_MS);
    }
  } catch (error) {
    // Cosmetic — never let this disrupt the chat log.
    console.warn(`${LOG_PREFIX} Miss feedback failed.`, error);
  }
}
