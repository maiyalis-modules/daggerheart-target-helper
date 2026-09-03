/**
 * Turning a target's portrait to face whoever is acting on it.
 *
 * Purely transient and purely local, like the flashes in `portrait-fx`: it writes
 * one inline custom property on the wrapper and nothing else. No actor writes, so
 * the GM's own right-click flip — which *is* an actor flag — is never touched, and
 * a portrait lowered and raised again comes back on its baseline orientation
 * because Ginzzzu removes the node (`wrapper.remove()`) and builds a fresh one.
 *
 * Three things make this composable rather than a fight with Ginzzzu:
 *
 * - **Never a transform.** Their wrapper transform is one long chain of custom
 *   properties ending in `scaleX(var(--ginzzzu-flip-scale-x, 1))`. We set that
 *   variable inline, which beats their class rule by specificity and leaves the
 *   drag offsets, breathing scale and emotion tilt in the chain untouched.
 * - **The GM's flip is the baseline, not a competitor.** `ginzzzu-portrait-flipped`
 *   stays on the wrapper and keeps meaning what it meant; we read it, multiply,
 *   and write the product. Removing our inline value hands control straight back.
 * - **Only ever the target.** The acting character's portrait belongs to the
 *   spotlight system, for the same reason `onPreUseAction` refuses to raise or
 *   lower it.
 *
 * Which way *unflipped* art faces is the one thing that cannot be worked out from
 * the DOM, so it is the setting: `portraitFacing` is the whole feature's switch
 * and its answer at once. Per-actor exceptions need no setting at all — the GM's
 * existing right-click flip already is one, because it moves that actor's baseline.
 */
import { LOG_PREFIX, MODULE_ID, SETTINGS } from "../constants.js";
import {
  FLIP_VAR,
  PORTRAIT_FLIPPED_CLASS,
  findWrapper,
  waitForWrapper,
  wrapperCentreX,
} from "./portrait-dom.js";

/** Which way a portrait's art looks when nothing has been flipped. */
export type Facing = "left" | "right";

/** `"off"` disables the feature; the others name the baseline direction. */
export type FacingSetting = Facing | "off";

/**
 * Portraits we are currently holding turned. Tracked so a release only ever
 * clears our own inline value — a wrapper we never touched is left exactly as the
 * GM left it, and an actor whose portrait has since been lowered simply drops out.
 */
const turned = new Set<string>();

function facingSetting(): FacingSetting {
  const raw = game.settings.get(MODULE_ID, SETTINGS.portraitFacing);
  return raw === "left" || raw === "right" ? raw : "off";
}

/** The direction this portrait's subject is looking, baseline flip included. */
function currentFacing(wrapper: HTMLElement, baseline: Facing): Facing {
  const flipped = wrapper.classList.contains(PORTRAIT_FLIPPED_CLASS);
  if (!flipped) return baseline;
  return baseline === "right" ? "left" : "right";
}

/**
 * Turn one portrait toward a point on screen.
 *
 * Writes the *product* of the baseline flip and the turn, so the two compose:
 * a portrait the GM flipped by hand and that also needs turning ends up back at
 * `1`, which is correct, rather than at `-1` twice over.
 */
function face(wrapper: HTMLElement, towardsX: number, baseline: Facing): void {
  const centreX = wrapperCentreX(wrapper);
  // Dead level: nothing to turn towards, and picking a side would only produce a
  // flicker as the two portraits drift past each other.
  if (towardsX === centreX) return;

  const wanted: Facing = towardsX < centreX ? "left" : "right";
  const turn = currentFacing(wrapper, baseline) === wanted ? 1 : -1;
  const base = wrapper.classList.contains(PORTRAIT_FLIPPED_CLASS) ? -1 : 1;
  wrapper.style.setProperty(FLIP_VAR, String(base * turn));
}

/**
 * Turn every target's portrait to face the acting character's.
 *
 * Both sides have to be on screen: without the caster there is nothing to face,
 * and turning towards a portrait that isn't there would be a guess. Both are
 * waited for, because this runs while the action is still raising them and the
 * GM's flag write has to replicate before Ginzzzu builds the node — including the
 * caster, whose portrait the spotlight system may be putting up at the same
 * moment. A side that never appears simply costs the wait and then declines.
 *
 * Targets are turned in parallel, since they are all being raised at once and one
 * absentee should not hold up the rest behind its full timeout.
 *
 * Never throws — a portrait that fails to turn is not a reason to interrupt play.
 */
export async function faceTargets(
  casterActorId: string | null,
  targetActorIds: string[],
): Promise<void> {
  try {
    const baseline = facingSetting();
    if (baseline === "off" || !casterActorId) return;
    if (game.settings.get(MODULE_ID, SETTINGS.portraitIntegration) === false) return;

    const caster = await waitForWrapper(casterActorId);
    if (!caster) return;

    await Promise.all(
      targetActorIds
        .filter((actorId) => actorId !== casterActorId)
        .map(async (actorId) => {
          const wrapper = await waitForWrapper(actorId);
          if (!wrapper) return;
          // The caster's position is read here rather than once up front: the
          // portraits are still settling into the dock, and a stale x could turn
          // a late arrival against the ones already placed.
          face(wrapper, wrapperCentreX(caster), baseline);
          turned.add(actorId);
        }),
    );
  } catch (error) {
    console.warn(`${LOG_PREFIX} Could not turn a target portrait.`, error);
  }
}

/**
 * Hand these portraits back to their baseline orientation.
 *
 * Removing the property rather than writing `1` into it is what makes this a
 * release: the class rule underneath takes over again, so a portrait the GM
 * flipped by hand returns to *their* flip rather than to unflipped.
 */
export function releaseFacing(actorIds: string[]): void {
  for (const actorId of actorIds) {
    if (!turned.delete(actorId)) continue;
    findWrapper(actorId)?.style.removeProperty(FLIP_VAR);
  }
}
