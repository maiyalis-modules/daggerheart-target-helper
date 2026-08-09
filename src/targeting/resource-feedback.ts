/**
 * Portrait feedback driven by the *actual* actor update rather than the system's
 * action hooks: floating resource numbers, and the killed-target greyscale.
 *
 * Why not `daggerheart.postTakeDamage`: it fires before the write it just
 * dispatched has landed (see `POST_TAKE_DAMAGE_HOOK` in constants.ts), so any
 * resource read there is one blow out of date — which is exactly why a fresh kill
 * never greyed out while an already-dead target did.
 *
 * `preUpdateActor` runs only on the client that initiates the update, and for a
 * player attacking an adversary that's the GM's client. `updateActor` runs
 * everywhere. Options set in the pre hook travel with the update, so that's where
 * the deltas are stashed — the same trick the system uses to ship its own
 * `scrollingTextData` to other clients (daggerheart.js:30346).
 *
 * Nothing here needs a socket, and nothing here may interrupt play.
 */
import {
  LOG_PREFIX,
  MODULE_ID,
  PRE_UPDATE_ACTOR_HOOK,
  SETTINGS,
  UPDATE_ACTOR_HOOK,
} from "../constants.js";
import { worldActorId } from "../services/actor-ids.js";
import { hitPointsFull } from "../services/actor-state.js";
import { floatText, setDead, type FloatTone } from "../services/portrait-fx.js";

/** One resource that moved, ready to render. */
interface ResourceDelta {
  /** Localized and signed, e.g. `"Hit Points +2"`. */
  text: string;
  tone: FloatTone;
}

/** Resource key the system uses for stress, which gets a tone of its own. */
const STRESS_KEY = "stress";

/** Our slice of the update options, replicated to every client. */
interface FeedbackOptions {
  deltas: ResourceDelta[];
}

/**
 * Gap between floats so a hit that marks HP *and* Stress doesn't overlap itself.
 * Comfortably shorter than the animation — they're meant to read as one event,
 * just not stacked on the same pixels.
 */
const STAGGER_MS = 450;

export function registerResourceFeedback(): void {
  Hooks.on(PRE_UPDATE_ACTOR_HOOK, onPreUpdateActor);
  Hooks.on(UPDATE_ACTOR_HOOK, onUpdateActor);
}

function portraitsEnabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.portraitIntegration) !== false;
}

/**
 * Format one resource change.
 *
 * Which direction counts as harm differs per resource — hit points and stress
 * count *up* as they're marked, hope counts down as it's spent — so this reads
 * the resource's own `isReversed` flag, the same one the system's
 * `getScrollTextData` uses to pick its colours (daggerheart.js:7426).
 * `reverse: true` for hitPoints/stress/armor, `false` for hope
 * (daggerheart.js:2238).
 */
function toDelta(resource: AnyObject, key: string, previous: number, next: number): ResourceDelta {
  const delta = next - previous;
  const label = game.i18n.localize((resource["label"] as string | undefined) ?? key);
  const sign = delta > 0 ? "+" : "-";
  const harmful = resource["isReversed"] !== false ? delta > 0 : delta < 0;

  // Stress reads as its own thing rather than more red: it lands alongside hit
  // point damage constantly, and the two need telling apart at a glance.
  let tone: FloatTone = "help";
  if (harmful) tone = key === STRESS_KEY ? "stress" : "harm";

  return { text: `${label} ${sign}${Math.abs(delta)}`, tone };
}

/**
 * Capture what changed, while the pre-update values are still readable.
 *
 * Deliberately computes its own deltas instead of reusing the system's
 * `options.scrollingTextData`: that is gated behind the `resourceScrollTexts`
 * automation setting, which a GM may well have switched off *because* it was
 * drawing on invisible tokens.
 */
function onPreUpdateActor(doc: AnyObject, changes: AnyObject, options: AnyObject): void {
  try {
    if (!portraitsEnabled()) return;
    if (game.settings.get(MODULE_ID, SETTINGS.damageNumbers) !== true) return;

    const changed = changes?.["system"]?.["resources"] as Record<string, AnyObject> | undefined;
    if (!changed) return;

    const current = doc["system"]?.["resources"] as Record<string, AnyObject> | undefined;
    if (!current) return;

    const deltas: ResourceDelta[] = [];
    for (const [key, change] of Object.entries(changed)) {
      const next = change?.["value"] as unknown;
      const resource = current[key];
      if (!resource) continue;

      const previous = resource["value"] as unknown;
      if (typeof next !== "number" || typeof previous !== "number") continue;
      if (next === previous) continue;

      deltas.push(toDelta(resource, key, previous, next));
    }

    if (deltas.length > 0) options[MODULE_ID] = { deltas } satisfies FeedbackOptions;
  } catch (error) {
    console.warn(`${LOG_PREFIX} Could not read a resource change.`, error);
  }
}

/**
 * Render on every client, against post-update values.
 *
 * @param doc The actor, already carrying the new values — unlike anything the
 *   system's damage hooks hand us.
 */
function onUpdateActor(doc: AnyObject, changes: AnyObject, options: AnyObject): void {
  try {
    if (!portraitsEnabled()) return;

    // No dock entry for an unlinked token actor, so nothing to draw on.
    const actorId = worldActorId(doc["id"] as string | undefined);
    if (!actorId) return;

    const deltas = (options[MODULE_ID] as FeedbackOptions | undefined)?.deltas ?? [];
    deltas.forEach((delta, index) => {
      setTimeout(() => void floatText(actorId, delta.text, delta.tone), index * STAGGER_MS);
    });

    // Only weigh in when hit points actually moved: an unrelated update must not
    // re-assert the veil, and `setDead` is not free (it polls for the portrait).
    const hitPoints = changes?.["system"]?.["resources"]?.["hitPoints"] as AnyObject | undefined;
    if (typeof hitPoints?.["value"] !== "number") return;

    void setDead(actorId, hitPointsFull(doc));
  } catch (error) {
    console.warn(`${LOG_PREFIX} Could not update portrait feedback.`, error);
  }
}
