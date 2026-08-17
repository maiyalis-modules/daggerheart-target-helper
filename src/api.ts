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
  (module as AnyObject)["api"] = { openRangeSurvey } satisfies TargetHelperApi;
}
