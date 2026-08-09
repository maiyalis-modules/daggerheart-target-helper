/**
 * The Theatre of the Mind targeting guard.
 *
 * When a player uses an action that needs a target but has none selected, this
 * cancels the action *before any dice are rolled or resources spent*, shows a
 * picker of valid scene targets, applies the choice, and replays the action.
 *
 * Why `daggerheart.preUseAction` and not `preCreateChatMessage`: hooks are
 * synchronous and their return is tested with `=== false`, so an async handler
 * returns a truthy Promise and cancels nothing. And by the time a chat message
 * is created the workflow has already run — Hope/Fear and Stress are spent.
 * `preUseAction` fires ahead of all of it (daggerheart.js:16884).
 *
 * The guard owns the targets it sets: if the replayed action doesn't commit, the
 * player's target state is put back exactly as it was.
 */
import {
  ACTION_ABANDONED_HOOK,
  LOG_PREFIX,
  MODULE_ID,
  PRE_USE_ACTION_HOOK,
  SETTINGS,
} from "../constants.js";
import { TargetPickerApp } from "../ui/target-picker-app.js";
import { collectCandidates, type TargetCandidate } from "./candidates.js";

/**
 * Actions currently being replayed by the guard. An entry means "let the next
 * `preUseAction` for this action through untouched" — so a replay can never
 * re-enter the picker and loop.
 */
const replaying = new Set<string>();

function actionKey(action: DhAction): string {
  return `${action.item?.uuid ?? "?"}:${action._id}`;
}

/** The action's declared target cap; `Infinity` when it declares none. */
function targetCap(action: DhAction): number {
  const amount = action.target?.amount;
  return typeof amount === "number" && amount > 0 ? amount : Number.POSITIVE_INFINITY;
}

/** The acting user's live target ids. Targets are per-user, so this is ours. */
function currentTargetIds(): string[] {
  return Array.from(game.user?.targets ?? [], (token) => token.id);
}

/**
 * Put targets back the way they were before the picker touched them.
 *
 * Deliberately a no-op if the live targets no longer match what we applied: the
 * canvas stays interactive while the roll dialog is open, so the player may have
 * re-targeted by hand, and their choice outranks our bookkeeping.
 */
function restoreTargets(applied: string[], previous: string[]): void {
  try {
    const current = currentTargetIds();
    if (current.length !== applied.length) return;
    if (!current.every((id) => applied.includes(id))) return;

    canvas.tokens?.setTargets(previous, { mode: "replace" });
  } catch (error) {
    console.warn(`${LOG_PREFIX} Could not restore targets after an abandoned action.`, error);
  }
}

export function registerTargetGuard(): void {
  Hooks.on(PRE_USE_ACTION_HOOK, onPreUseAction);
}

/**
 * Synchronous hook handler. Returning `false` aborts the action; the picker is
 * driven from a deliberately un-awaited async continuation.
 *
 * No `userId` check is needed here (unlike a chat-message hook): `use()` only
 * ever runs on the client that triggered it.
 */
function onPreUseAction(action: DhAction, config: DhActionConfig): boolean | void {
  const key = actionKey(action);

  // Our own replay — consume the pass and let the action run.
  if (replaying.has(key)) {
    replaying.delete(key);
    return;
  }

  if (game.settings.get(MODULE_ID, SETTINGS.enabled) !== true) return;

  // Not a targeted action.
  if (!config.hasTarget) return;

  // The action forces its own target and ignores user targets.
  if (config.targetUuid) return;

  // Self-targeted actions resolve to the caster; there is nothing to pick.
  const type = action.target?.type ?? null;
  if (!type || type === "self") return;

  // Already targeted — the normal path.
  if ((config.targets?.length ?? 0) > 0) return;

  const candidates = collectCandidates(action);
  if (candidates.length === 0) {
    ui.notifications?.warn(game.i18n.localize("DHTH.Notify.NoCandidates"));
    return false;
  }

  void promptAndReplay(action, config, candidates, key);
  return false;
}

/** Show the picker, apply the selection, and replay the action. */
async function promptAndReplay(
  action: DhAction,
  config: DhActionConfig,
  candidates: TargetCandidate[],
  key: string,
): Promise<void> {
  // Snapshot before the picker can change anything. Note this is *not* always
  // empty: the guard fires on `config.targets` being empty, and the system's
  // `TargetField.prepareConfig` (daggerheart.js:33035) drops user targets that
  // fail the disposition filter and blanks the list wholesale when it overflows
  // `target.amount`. So the player can reach the picker still holding targets
  // this action rejected — a blind clear would silently discard them.
  const previous = currentTargetIds();

  const picked = await TargetPickerApp.prompt(candidates, {
    max: targetCap(action),
    title: config.title ?? action.name,
  });

  // Cancelled or dismissed: the action stays aborted, with nothing spent.
  if (picked === null) return;

  /** The targets we applied, or null when we left the player's alone. */
  let applied: string[] | null = null;

  if (picked === "none") {
    // "Attack Without a Target": proceed untargeted (terrain, an object, …).
    // Leave user targets alone — the guard only fires when there are none.
  } else if (picked.length === 0) {
    return;
  } else {
    // Synchronous, and broadcasts to other clients so the GM sees the reticle.
    // (`game.user.updateTokenTargets()` does not exist in v14; the only
    // `User`-level equivalent is @internal and does not broadcast.)
    canvas.tokens?.setTargets(picked, { mode: "replace" });
    applied = picked;
  }

  /**
   * Whether the replay went all the way through. `use()` returns its config only
   * after the workflow, the resource spend, and `postUseAction` have all passed;
   * every bail-out (`prepareConfig` falsy, `preUseAction` false, the roll dialog
   * dismissed, a workflow part returning false) returns `undefined`.
   *
   * A miss still counts as committed, which is what we want — the roll happened.
   * Miss feedback returns false from `preDamageAction`, which only makes
   * `executeWorkflow` return `undefined`, and `use()` bails on `=== false`, so it
   * falls through and returns the config as normal.
   */
  let committed = false;

  replaying.add(key);
  try {
    // Replayed with the original event only. Any `configOptions` from the first
    // call aren't exposed on the hook, which is correct for the normal
    // sheet-button path since that passes none.
    committed = Boolean(await action.use(config.event ?? null));
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to replay action after targeting.`, error);
    ui.notifications?.warn(game.i18n.localize("DHTH.Notify.ReplayFailed"));
  } finally {
    // Clear in case `use()` bailed before reaching the hook (e.g. prepareConfig
    // returned false), so the guard is always re-armed for the next attempt.
    replaying.delete(key);

    // Abandoned (roll dialog dismissed, or the replay threw): the guard owns the
    // targets it set, so hand the player back exactly the state they were in.
    // Without this they keep an invisible target — fatal in Theatre of the Mind,
    // where no token shows the reticle and the guard, armed by the *absence* of
    // targets, would skip the picker on the next action entirely.
    if (!committed && applied) {
      restoreTargets(applied, previous);
      // The replay's own `preUseAction` already raised the target portraits.
      // Announce the abandon so that side of the module can drop them; the guard
      // itself stays out of the portrait business.
      Hooks.callAll(ACTION_ABANDONED_HOOK, action, applied);
    }
  }
}
