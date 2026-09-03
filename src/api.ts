/**
 * The module's public API, published on its own module entry as
 * `game.modules.get("daggerheart-target-helper").api` — Foundry's convention for
 * one module offering another a way in.
 *
 * Kept deliberately small and stable: it is the contract the **Tokens on Scene**
 * bar in `eryndor-essentials` calls to open a range survey, and that module is
 * written to no-op when this one is absent. Adding to it is cheap; changing the
 * shape of what's here means editing the other module too.
 */
import { LOG_PREFIX, MODULE_ID } from "./constants.js";
import { registerRangeOrigin, type RangeOriginResolver } from "./targeting/range-origin.js";
import { ActionVfxConfigApp } from "./ui/action-vfx-config-app.js";
import { TargetPickerApp } from "./ui/target-picker-app.js";

/** What callers get. Documented here rather than inline so the contract is one thing. */
export interface TargetHelperApi {
  /**
   * Open the read-only **range survey**: everything on the current scene, how
   * far it is from `source`, and nothing else. Nothing is targeted, nothing is
   * spent, and no action is involved.
   *
   * Accepts a `Token` or a token id — a caller working from a DOM dataset has
   * the id, and resolving it here keeps that lookup (and its failure) in one
   * place. Returns whether the window opened; `false` means the token isn't on
   * the current scene.
   */
  openRangeSurvey(source: Token | string): boolean;

  /**
   * Declare where an action's **range is measured from**, for the case where the
   * creature performing an action is not the creature rolling it — a Beastbound
   * ranger's animal companion being the one this was written for.
   *
   * The resolver is called with each action that reaches the target picker and
   * answers with a `Token`, a token id, a token uuid, or `null` to decline.
   * Declining (and naming a token that isn't on the current scene) falls back to
   * the acting actor's own token, so a companion left off the map costs nothing.
   *
   * Register once, at `init` or later; resolvers accumulate and the first
   * non-null answer wins. Only the *distance* moves — who counts as an enemy,
   * and which targets the action will accept, stay with the acting actor.
   */
  registerRangeOrigin(resolver: RangeOriginResolver): void;

  /**
   * Open the **per-action animation config** for an item, optionally on a
   * particular action.
   *
   * Accepts an Item or its uuid. Items with several actions get a picker at the
   * top of the window, so one Grimoire's three actions stay independently
   * configurable — which is the point of storing the config per action rather
   * than per item.
   *
   * Returns whether a window opened; `false` means the uuid resolved to nothing,
   * or the item has no actions to configure.
   */
  openActionVfxConfig(item: DhItem | string, actionId?: string): boolean;
}

export type { RangeOriginResolver };


function openActionVfxConfig(item: DhItem | string, actionId?: string): boolean {
  try {
    const resolved = typeof item === "string" ? (fromUuidSync(item) as DhItem | null) : item;
    if (!resolved) return false;
    return ActionVfxConfigApp.open(resolved, actionId) !== null;
  } catch (error) {
    console.error(`${LOG_PREFIX} Could not open the animation config.`, error);
    return false;
  }
}

function openRangeSurvey(source: Token | string): boolean {
  const token = typeof source === "string" ? (canvas.tokens?.get(source) ?? null) : source;
  if (!token) return false;

  try {
    TargetPickerApp.survey(token);
    return true;
  } catch (error) {
    // Never throw into a caller from another module: they asked for a window,
    // and not getting one should not break whatever they were doing.
    console.error(`${LOG_PREFIX} Could not open the range survey.`, error);
    return false;
  }
}

/**
 * Publish the API. Called during `init`, so a module whose own `init` runs later
 * — or anything at `setup`/`ready` — can already see it.
 */
export function registerApi(): void {
  const module = game.modules.get(MODULE_ID);
  if (!module) {
    console.warn(`${LOG_PREFIX} Could not publish the API: module entry not found.`);
    return;
  }
  (module as AnyObject)["api"] = {
    openRangeSurvey,
    registerRangeOrigin,
    openActionVfxConfig,
  } satisfies TargetHelperApi;
}
