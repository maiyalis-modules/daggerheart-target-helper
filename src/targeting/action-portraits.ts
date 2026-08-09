/**
 * Wires targeted actions to the Ginzzzu portrait integration.
 *
 * Hooks used:
 * - `daggerheart.preUseAction` — `config.targets` is already resolved here, so a
 *   single hook covers targets chosen by our picker *and* targets the player
 *   clicked manually. Registered *after* the target guard, so a guarded action
 *   with no targets is cancelled before we ever see it (`Hooks.call` stops at
 *   the first handler returning `false`); the guard's replay then reaches us
 *   with targets in hand.
 * - `<module>.actionAbandoned` — ours, fired by the target guard when a replayed
 *   action is backed out of. The portraits were already raised by the replay's
 *   `preUseAction`, so this is what stops them lingering for an action that never
 *   happened.
 * - `daggerheart.postTakeDamage` / `postTakeHealing` — fire on the affected
 *   actor, which is all the correlation the flashes need. Used for the animation
 *   *only*; the resources on that actor are still pre-update, so anything that
 *   depends on the new values (the killed-target veil, the floating numbers)
 *   lives in `resource-feedback.ts` and hangs off the document update instead.
 *
 * Every handler is wrapped: this is cosmetic, and must never break an action.
 */
import {
  ACTION_ABANDONED_HOOK,
  LOG_PREFIX,
  MODULE_ID,
  POST_TAKE_DAMAGE_HOOK,
  POST_TAKE_HEALING_HOOK,
  POST_USE_ACTION_HOOK,
  PRE_USE_ACTION_HOOK,
  SETTINGS,
} from "../constants.js";
import { worldActorId, worldActorIdFromUuid } from "../services/actor-ids.js";
import { armLinger, raiseTargets, releaseTargets } from "../services/portrait-bridge.js";
import { playFx } from "../services/portrait-fx.js";
import {
  emitPortraitFx,
  emitTargetsEngaged,
  emitTargetsReleased,
  registerSocket,
  type PortraitFxKind,
  type TargetsEngagedPayload,
} from "../services/socket.js";

export function registerActionPortraits(): void {
  registerSocket({
    onTargetsEngaged: handleTargetsEngaged,
    onTargetsReleased: releaseTargets,
    onPortraitFx: handlePortraitFx,
  });

  Hooks.on(PRE_USE_ACTION_HOOK, onPreUseAction);
  Hooks.on(POST_USE_ACTION_HOOK, onPostUseAction);
  Hooks.on(ACTION_ABANDONED_HOOK, onActionAbandoned);
  Hooks.on(POST_TAKE_DAMAGE_HOOK, (actor: AnyObject) => onEffectApplied(actor, "damage"));
  Hooks.on(POST_TAKE_HEALING_HOOK, (actor: AnyObject) => onEffectApplied(actor, "heal"));
}

/** Announce who is being targeted. Returns nothing, so the action proceeds. */
function onPreUseAction(action: DhAction, config: DhActionConfig): void {
  try {
    const targets = config.targets ?? [];
    if (targets.length === 0) return;

    const actingUuid = action.actor?.uuid ?? null;
    const actorIds: string[] = [];
    const selfActorIds: string[] = [];

    for (const target of targets) {
      const id = worldActorIdFromUuid(target.actorId);
      if (!id) continue;
      // Self-targets animate but are never raised or lowered — the acting
      // actor's portrait belongs to the spotlight system.
      if (actingUuid && target.actorId === actingUuid) selfActorIds.push(id);
      else actorIds.push(id);
    }

    if (actorIds.length === 0 && selfActorIds.length === 0) return;
    const expectsEffect = Boolean(config.hasDamage || config.hasHealing);
    emitTargetsEngaged({ actorIds, selfActorIds, expectsEffect });
  } catch (error) {
    console.warn(`${LOG_PREFIX} Could not announce targets for portraits.`, error);
  }
}

/**
 * The guard replayed an action, its `preUseAction` raised the target portraits,
 * and then the player backed out — so nothing is coming. Cut the hold short.
 *
 * Only the guard's own path is covered: it is the one place we can tell an
 * abandon from a completion. An action targeted by hand and then abandoned still
 * rides out the full grace window.
 *
 * @param tokenIds The token ids the guard applied. The acting actor can't be
 *   among them — `collectCandidates` never offers it — so there is no self-target
 *   to exclude here, unlike `onPreUseAction`.
 */
function onActionAbandoned(_action: DhAction, tokenIds: string[]): void {
  try {
    const actorIds: string[] = [];
    for (const tokenId of tokenIds) {
      const id = worldActorId(canvas.tokens?.get(tokenId)?.actor?.id);
      if (id) actorIds.push(id);
    }

    if (actorIds.length === 0) return;
    emitTargetsReleased(actorIds);
  } catch (error) {
    console.warn(`${LOG_PREFIX} Could not release portraits for an abandoned action.`, error);
  }
}

/**
 * Release the acting user's targets once the action's `use()` completes. Runs on
 * the acting client (targets are per-user). Damage is unaffected: the chat card
 * captured its targets at roll time (`hitTargets`) and never reads live targets.
 */
function onPostUseAction(_action: DhAction, config: DhActionConfig): void {
  try {
    if (game.settings.get(MODULE_ID, SETTINGS.clearTargetsAfterAction) !== true) return;
    if ((config.targets?.length ?? 0) === 0) return;
    if (!game.user?.targets?.size) return;
    canvas.tokens?.setTargets([], { mode: "replace" });
  } catch (error) {
    console.warn(`${LOG_PREFIX} Could not clear targets after action.`, error);
  }
}

/**
 * Flash the portrait for damage or healing.
 *
 * Only the animation: whether the blow *killed* them is decided from the actual
 * actor update in `resource-feedback.ts`, because the resources on the actor these
 * hooks pass are still pre-update (see `POST_TAKE_DAMAGE_HOOK` in constants.ts).
 * Reading them here is what made a fresh kill fail to grey out.
 */
function onEffectApplied(actor: AnyObject, kind: PortraitFxKind): void {
  try {
    const id = worldActorId(actor?.["id"] as string | undefined);
    if (!id) return;
    emitPortraitFx(id, kind);
  } catch (error) {
    console.warn(`${LOG_PREFIX} Could not announce a portrait effect.`, error);
  }
}

/** Runs on every client; the raise is GM-only and no-ops elsewhere. */
function handleTargetsEngaged(payload: TargetsEngagedPayload): void {
  for (const actorId of [...payload.actorIds, ...payload.selfActorIds]) {
    void playFx(actorId, "targeted");
  }
  void raiseTargets(payload.actorIds, payload.expectsEffect);
}

function handlePortraitFx(actorId: string, kind: PortraitFxKind): void {
  void playFx(actorId, kind);
  // Keep the portrait up a little longer now that something has landed on it.
  armLinger(actorId);
}
