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
 * - `daggerheart.postRollAction` — the roll part of the workflow has finished and
 *   the damage part has not started. This is where an attack is *depicted*, so the
 *   swing reads on the roll rather than on top of the damage flash. Deliberately
 *   not `postUseAction`: damage is a workflow part of the same action, so `use()`
 *   only resolves once damage has already been applied.
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
  POST_ROLL_ACTION_HOOK,
  POST_USE_ACTION_HOOK,
  PRE_USE_ACTION_HOOK,
  SETTINGS,
} from "../constants.js";
import { worldActorId, worldActorIdFromUuid } from "../services/actor-ids.js";
import { armLinger, raiseTargets, releaseTargets } from "../services/portrait-bridge.js";
import { faceTargets, releaseFacing } from "../services/portrait-facing.js";
import {
  clampVfxSpeed,
  expectVfx,
  linkVfxRelease,
  onVfxHoldChange,
  playFx,
  playPortraitVfx,
  playSpanVfx,
  probeVideoDuration,
  releaseVfx,
  runVfxSequence,
} from "../services/portrait-fx.js";
import {
  emitActionVfx,
  emitVfxExpected,
  emitVfxRelease,
  emitPortraitFx,
  emitTargetsEngaged,
  emitTargetsReleased,
  registerSocket,
  type ActionVfxPayload,
  type ResolvedVfxStep,
  type PortraitFxKind,
  type TargetsEngagedPayload,
} from "../services/socket.js";
import {
  resolveActionVfx,
  resolveVfxPath,
  type VfxTarget,
} from "../services/vfx-resolver.js";
import {
  vfxChainFlash,
  vfxEnabled,
  vfxTiming,
  type VfxTiming,
} from "../services/vfx-settings.js";


/**
 * How long to hold a portrait that has feedback waiting on an animation.
 *
 * Only ever an upper bound: the moment the animation finishes and the held
 * feedback plays, the normal short linger is re-armed. It has to outlast the
 * announcement backstop in `portrait-fx`, or the portrait could be lowered while
 * a flash is still queued for it.
 */
const VFX_HOLD_LINGER_MS = 15_000;

export function registerActionPortraits(): void {
  // Keep a portrait on screen while something is waiting on its animation, then
  // hand it back to the ordinary linger once that feedback has played.
  onVfxHoldChange((actorId, held) => {
    armLinger(actorId, held ? VFX_HOLD_LINGER_MS : undefined);
  });

  registerSocket({
    onTargetsEngaged: handleTargetsEngaged,
    onTargetsReleased: handleTargetsReleased,
    onPortraitFx: handlePortraitFx,
    onActionVfx: (payload) => void handleActionVfx(payload),
    onVfxExpected: handleVfxExpected,
    onVfxRelease: handleVfxRelease,
  });

  Hooks.on(PRE_USE_ACTION_HOOK, onPreUseAction);
  Hooks.on(PRE_USE_ACTION_HOOK, onActionAnnounce);
  Hooks.on(POST_USE_ACTION_HOOK, onPostUseAction);
  Hooks.on(POST_ROLL_ACTION_HOOK, (action: DhAction, config: DhActionConfig) =>
    onActionDepiction(action, config, "roll"),
  );
  Hooks.on(POST_USE_ACTION_HOOK, (action: DhAction, config: DhActionConfig) =>
    onActionDepiction(action, config, "action"),
  );
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
    const casterActorId = actingUuid ? worldActorIdFromUuid(actingUuid) : null;
    emitTargetsEngaged({ casterActorId, actorIds, selfActorIds, expectsEffect });
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
 * @param tokenIds The token ids the guard applied. The acting actor *can* be
 *   among them — the picker offers a Self group — and is skipped for the same
 *   reason `onPreUseAction` sorts it out: its portrait was never raised by us,
 *   it belongs to the spotlight system, and releasing it would pull down a
 *   portrait we don't own.
 */
function onActionAbandoned(action: DhAction, tokenIds: string[]): void {
  try {
    const actingUuid = action?.actor?.uuid ?? null;
    const actorIds: string[] = [];
    for (const tokenId of tokenIds) {
      const token = canvas.tokens?.get(tokenId);
      if (actingUuid && token?.actor?.uuid === actingUuid) continue;
      const id = worldActorId(token?.actor?.id);
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

/** Every portrait among an action's targets, before any `playOn` filtering. */
function allTargetActorIds(config: DhActionConfig): string[] {
  const ids: string[] = [];
  for (const target of config.targets ?? []) {
    const id = worldActorIdFromUuid(target.actorId);
    if (id) ids.push(id);
  }
  return ids;
}

/** Which portraits a config draws on, given the targets it ends up with. */
function drawnOn(on: VfxTarget, casterActorId: string, targetActorIds: string[]): string[] {
  if (on === "caster") return [casterActorId];
  const ids = [...targetActorIds];
  if (on === "both") ids.push(casterActorId);
  return ids;
}

/**
 * Every portrait this action's feedback can land on — its targets, plus the
 * acting character for anything self-directed.
 *
 * Wider than the set that *animates* on purpose. With a caster-only animation the
 * damage still lands on the target, and that flash should follow the swing rather
 * than pre-empt it, so the target has to be announced even though nothing will
 * ever be drawn on it.
 */
function involvedActorIds(config: DhActionConfig, casterActorId: string): string[] {
  const ids = allTargetActorIds(config);
  if (!ids.includes(casterActorId)) ids.push(casterActorId);
  return ids;
}

/**
 * Announce, before anything else happens, that an animation is coming for these
 * portraits — so outcome feedback arriving in the meantime waits for it.
 *
 * On `preUseAction` rather than the roll, because that is the only hook every
 * action reaches. A rollless action (a Hope-spent heal) has no roll part at all,
 * and its healing is applied inside the workflow — so announcing at the roll
 * would miss exactly the case where the flash most needs holding.
 *
 * Registered after the target guard, so an action the guard cancels is never
 * announced.
 */
function onActionAnnounce(action: DhAction, config: DhActionConfig): void {
  try {
    if (!vfxEnabled() || !vfxChainFlash()) return;

    const vfx = resolveActionVfx(action);
    if (!vfx) return;

    const casterUuid = action.actor?.uuid;
    if (!casterUuid) return;
    const casterActorId = worldActorIdFromUuid(casterUuid);
    if (!casterActorId) return;

    const announced = involvedActorIds(config, casterActorId);
    if (announced.length > 0) emitVfxExpected(announced);
  } catch (error) {
    console.warn(`${LOG_PREFIX} Could not announce an animation.`, error);
  }
}

/**
 * Depict the attack itself, as distinct from its outcome.
 *
 * Runs on `postRollAction`: the roll part of the workflow is done and the damage
 * part has not begun, so the swing lands on the roll and the damage flash arrives
 * later on its own. See `POST_ROLL_ACTION_HOOK` for why `postUseAction` is the
 * wrong beat despite sounding like the right one.
 *
 * Fires for missed targets as well as hit ones. A miss is still a swing, and this
 * is a depiction of what happened rather than a report of how it went; the
 * existing damage and blocked flashes are what carry the outcome. Filtering on
 * `target.hit` here is a one-line change if that turns out to read badly.
 *
 * Actions with no per-action config and no auto-recognition match animate nothing
 * at all — see `resolveActionVfx`.
 */
function onActionDepiction(action: DhAction, config: DhActionConfig, phase: VfxTiming): void {
  try {
    if (!vfxEnabled()) return;

    /**
     * Whether this action makes a roll at all. Plenty do not — a Hope-spent heal,
     * a utility feature, anything resolved by spending rather than rolling — and
     * those never reach `postRollAction`, because there is no roll part in their
     * workflow to emit it. `postUseAction` is the only beat available to them, so
     * they play there whatever the configured timing says.
     */
    const rolled = config.hasRoll === true;
    const playPhase: VfxTiming = rolled ? vfxTiming() : "action";

    const vfx = resolveActionVfx(action);
    if (!vfx) return;

    const casterUuid = action.actor?.uuid;
    if (!casterUuid) return;
    const casterActorId = worldActorIdFromUuid(casterUuid);
    if (!casterActorId) return;

    /**
     * Announced portraits that turn out to have nothing coming for them.
     *
     * `onActionAnnounce` runs before any of this is known, so every bail from
     * here on has to say so — otherwise held feedback waits out the whole backstop
     * for an animation that was never going to play.
     */
    const abandon = (): void => emitVfxRelease(involvedActorIds(config, casterActorId));

    // Resolve every step's asset. A step whose key resolves to nothing is dropped
    // rather than taking the whole action down with it — a four-step sequence with
    // one typo should still show the other three.
    const steps: ResolvedVfxStep[] = [];
    for (const step of vfx.steps) {
      const path = resolveVfxPath(step.key);
      if (!path) {
        // A key that resolves to nothing is a configuration mistake worth saying
        // out loud — silently doing nothing looks identical to a broken feature.
        console.warn(`${LOG_PREFIX} No file found for animation key "${step.key}".`);
        continue;
      }
      steps.push({
        on: step.on,
        path,
        placement: step.placement,
        flip: step.flip,
        delayMs: step.delayMs,
        speed: step.speed,
        reach: step.reach,
      });
    }

    if (steps.length === 0) {
      abandon();
      return;
    }

    // Filtering here rather than on the receiving clients keeps every client
    // playing exactly what it is sent, with no second opinion about the roll.
    // A rollless action has no hit/miss to filter on — its targets carry no `hit`
    // — so it always plays, whatever `playOn` happens to say.
    const targetActorIds: string[] = [];
    for (const target of config.targets ?? []) {
      if (rolled && vfx.playOn === "hit" && target.hit !== true) continue;
      if (rolled && vfx.playOn === "miss" && target.hit === true) continue;
      const id = worldActorIdFromUuid(target.actorId);
      if (id) targetActorIds.push(id);
    }

    // Steps that draw on the caster stand on their own; anything aimed at targets
    // has nothing left to draw on once they have been filtered away.
    const needsTargets = steps.some((step) => step.on !== "caster");
    const casterOnly = steps.every((step) => step.on === "caster");
    if (needsTargets && targetActorIds.length === 0 && !casterOnly) {
      abandon();
      return;
    }

    // Every portrait any step draws on, and everything else this action touches.
    // The latter still waits — see `involvedActorIds`.
    const animated = new Set<string>();
    for (const step of steps) {
      for (const id of drawnOn(step.on, casterActorId, targetActorIds)) animated.add(id);
    }
    const followerActorIds = involvedActorIds(config, casterActorId).filter(
      (id) => !animated.has(id),
    );

    if (phase !== playPhase) return;

    emitActionVfx({
      casterActorId,
      targetActorIds,
      sequence: vfx.sequence,
      steps,
      followerActorIds,
    });
  } catch (error) {
    console.warn(`${LOG_PREFIX} Could not depict an action.`, error);
  }
}

/** Runs on every client; the raise is GM-only and no-ops elsewhere. */
function handleTargetsEngaged(payload: TargetsEngagedPayload): void {
  for (const actorId of [...payload.actorIds, ...payload.selfActorIds]) {
    void playFx(actorId, "targeted");
  }
  void raiseTargets(payload.actorIds, payload.expectsEffect);
  // Runs everywhere, unlike the raise: turning a portrait is DOM-only, and each
  // client has to decide from its *own* layout because the dock is draggable.
  // Started without waiting — it polls for portraits this raise is still putting
  // up, and nothing above depends on it. Self-targets are left out: there is no
  // one for them to turn towards.
  void faceTargets(payload.casterActorId, payload.actorIds);
}

/**
 * The action those targets were engaged for never happened. Hands the portraits
 * back their own orientation on every client, and their linger on the GM's.
 */
function handleTargetsReleased(actorIds: string[]): void {
  releaseFacing(actorIds);
  releaseTargets(actorIds);
}

function handlePortraitFx(actorId: string, kind: PortraitFxKind): void {
  // Armed *before* the flash, not after: `playFx` decides synchronously whether
  // to hold this flash for an animation, and holding re-arms a much longer window
  // through `onVfxHoldChange`. Doing it the other way round would overwrite that
  // long hold with the short linger and drop the portrait mid-wait.
  armLinger(actorId);
  void playFx(actorId, kind);
}

/**
 * Play one step, resolving when everything it drew has finished.
 *
 * A `"spanning"` step goes to its own renderer — it is drawn between two
 * portraits on an overlay rather than inside one, so it shares none of the
 * placement machinery the others use.
 */
async function playStep(
  step: ResolvedVfxStep,
  casterActorId: string,
  targetActorIds: string[],
  delayMs = step.delayMs,
): Promise<void> {
  const shared = {
    path: step.path,
    placement: step.placement,
    flip: step.flip,
    delayMs: Math.max(0, delayMs),
    speed: step.speed,
  };
  const jobs: Promise<void>[] = [];

  if (step.on === "spanning") {
    // One shot per target, all from the acting character.
    for (const targetActorId of targetActorIds) {
      jobs.push(
        playSpanVfx({
          fromActorId: casterActorId,
          toActorId: targetActorId,
          path: step.path,
          placement: step.placement,
          delayMs: Math.max(0, delayMs),
          speed: step.speed,
          reach: step.reach,
        }),
      );
    }
    await Promise.all(jobs);
    return;
  }

  if (step.on === "caster" || step.on === "both") {
    jobs.push(
      playPortraitVfx({
        actorId: casterActorId,
        referenceActorId: targetActorIds[0] ?? null,
        ...shared,
      }),
    );
  }

  if (step.on === "target" || step.on === "both") {
    for (const targetActorId of targetActorIds) {
      jobs.push(
        playPortraitVfx({ actorId: targetActorId, referenceActorId: casterActorId, ...shared }),
      );
    }
  }

  await Promise.all(jobs);
}

/**
 * How long a step will run on screen, in milliseconds.
 *
 * Only ever needed for a negative gap. Everywhere else the sequence waits on the
 * video's own `ended`, which needs no arithmetic and cannot drift — but "start
 * 200ms *before* the previous one finishes" cannot be expressed that way, because
 * by the time `ended` fires the moment has passed.
 */
async function stepRuntimeMs(step: ResolvedVfxStep): Promise<number> {
  const seconds = await probeVideoDuration(step.path);
  if (seconds === null) return 0;
  return (seconds * 1000) / clampVfxSpeed(step.speed);
}

/** Runs on every client; mirroring is worked out locally from the live portraits. */
async function handleActionVfx(payload: ActionVfxPayload): Promise<void> {
  const { casterActorId, targetActorIds, sequence, steps } = payload;

  // Whatever animates drives the release; everything else this action touches
  // waits for all of it to finish.
  const drivers = new Set<string>();
  for (const step of steps) {
    if (step.on === "caster" || step.on === "both") drivers.add(casterActorId);
    if (step.on !== "caster") for (const id of targetActorIds) drivers.add(id);
  }
  linkVfxRelease([...drivers], payload.followerActorIds);

  await runVfxSequence(steps, sequence, {
    delayOf: (step) => step.delayMs,
    runtimeOf: stepRuntimeMs,
    start: (step, delayMs) => playStep(step, casterActorId, targetActorIds, delayMs),
  });
}

/** Runs on every client. An announced animation that is never going to play. */
function handleVfxRelease(actorIds: string[]): void {
  for (const actorId of actorIds) releaseVfx(actorId);
}

/** Runs on every client. Marks portraits so a damage flash waits for the swing. */
function handleVfxExpected(actorIds: string[]): void {
  for (const actorId of actorIds) expectVfx(actorId);
}
