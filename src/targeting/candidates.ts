/**
 * Builds the list of tokens a player may pick from when an action needs a target.
 *
 * Everything here is deliberately aligned with the system's own `TargetField`
 * (daggerheart.js:33005) so the candidates we offer are exactly the ones the
 * action workflow will accept once they're targeted.
 */
import { activeConditions, defeatedBadge, type ConditionBadge } from "../services/actor-state.js";
import {
  bandFor,
  distanceBetween,
  findActingToken,
  isWithinRange,
  type DistanceBand,
} from "./range.js";
import { resolveRangeOrigin } from "./range-origin.js";

/**
 * Which side of the fight a candidate is on, relative to the acting actor.
 *
 * `self` is not a side — it's the acting actor's own token, pulled out of the
 * disposition grouping it would otherwise land in (always `ally`, since a token
 * shares its own disposition) so that targeting yourself is a deliberate,
 * clearly-labelled choice rather than a name buried among your allies.
 */
export type TargetGroup = "enemy" | "neutral" | "ally" | "self";

/** A formatted target plus everything the picker shows around it. */
export interface TargetCandidate extends DhFormattedTarget {
  group: TargetGroup;
  /** Set when the target is down; carries *how* (Dead, Unconscious, …). */
  defeated: ConditionBadge | null;
  /** Conditions other than defeat, sorted by name. */
  conditions: ConditionBadge[];
  /** Whether the target is within the action's declared range band of the actor's token. */
  inRange: boolean;
  /**
   * Measured distance from the acting token, in scene grid units. `null` when
   * there's nothing to measure from — the actor has no token on this scene —
   * which is exactly when {@link inRange} defaults to true.
   */
  distance: number | null;
  /** The band {@link distance} falls in. `null` whenever the distance is. */
  band: DistanceBand | null;
}

/**
 * Reach the system's TargetField statics. Available from the system's `init`
 * (daggerheart.js:41348), so always present by the time an action is used.
 * Returns null defensively — a system update that moves this should degrade to
 * an unfiltered list rather than throwing mid-action.
 */
function getTargetField(): DhTargetFieldStatics | null {
  const api = (game.system as AnyObject)["api"] as AnyObject | undefined;
  const fields = api?.["fields"] as AnyObject | undefined;
  const actionFields = fields?.["ActionFields"] as AnyObject | undefined;
  return (actionFields?.["TargetField"] as DhTargetFieldStatics | undefined) ?? null;
}

/** Stand-in for `TargetField.formatTarget` if the system API ever moves. */
function fallbackFormat(token: Token): DhFormattedTarget {
  const system = (token.actor?.["system"] ?? {}) as AnyObject;
  return {
    id: token.id,
    actorId: token.actor?.uuid ?? "",
    name: token.name,
    img: token.actor?.img ?? "",
    difficulty: (system["difficulty"] as number | null | undefined) ?? null,
    evasion: (system["evasion"] as number | null | undefined) ?? null,
  };
}

/**
 * Is this token the acting actor's own?
 *
 * By actor uuid, which covers both linked world actors and unlinked scene
 * actors — and deliberately matches *every* token of the acting actor, not just
 * the one being measured from. Two tokens sharing an actor share a sheet, so
 * damage or healing aimed at either lands on you; they are all "yourself", and
 * the distance chip is what tells them apart.
 */
function isSelfToken(actor: DhActor | null, token: Token): boolean {
  return Boolean(actor) && token.actor?.uuid === actor?.uuid;
}

/** An actor's own disposition, for the grouping fallback below. */
function dispositionOf(actor: DhActor | null): number | null {
  const disposition = (actor?.token ?? actor?.prototypeToken)?.disposition;
  return typeof disposition === "number" ? disposition : null;
}

/**
 * Which side a token is on, relative to the acting actor.
 *
 * Uses the system's own comparison so the grouping the player sees agrees with
 * the filtering the workflow applies. The fallback mirrors `isTargetFriendly`
 * (daggerheart.js:33069): same disposition is an ally, dispositions cancelling
 * to zero are enemies, anything else is neutral.
 *
 * Self is checked first and short-circuits, because it can't be reached by
 * disposition: a token always matches its own, so the acting actor would be
 * filed under Allies every single time.
 */
function groupFor(
  actor: DhActor | null,
  token: Token,
  targetField: DhTargetFieldStatics | null,
): TargetGroup {
  if (isSelfToken(actor, token)) return "self";
  if (!actor) return "neutral";

  if (targetField) {
    if (targetField.isTargetFriendly(actor, token, "friendly")) return "ally";
    if (targetField.isTargetFriendly(actor, token, "hostile")) return "enemy";
    return "neutral";
  }

  const mine = dispositionOf(actor);
  const theirs = token.document.disposition;
  if (mine === null) return "neutral";
  if (mine === theirs) return "ally";
  if (mine + theirs === 0) return "enemy";
  return "neutral";
}

/** What the list is being built for. See the two wrappers below. */
interface CandidateOptions {
  /** The acting actor: drives grouping and the system's disposition filter. */
  actor: DhActor | null;
  /**
   * The token distances are measured from; null when the actor has none placed.
   *
   * Usually the acting actor's own token, but not always — see
   * `range-origin.ts`, where a module can declare that an action reaches from
   * somewhere else. Grouping and the disposition filter deliberately stay with
   * {@link actor}: a companion's claws start at the companion, but who counts as
   * an enemy is still the commanding character's question.
   */
  actingToken: Token | null;
  /** Disposition filter. `null` or `"any"` offers everyone. */
  targetType: string | null;
  /** Range band to gate on. `null` gates nothing, which is survey mode's case. */
  range: string | null;
  /**
   * Whether the acting actor's own tokens are offered, in their own `self`
   * group. True for a real pick — an action that reaches other people can
   * usually reach you, and there was previously no way to say so. False for the
   * survey, which is asking what's *around* you and would only list you at zero
   * feet.
   *
   * Note this only lets self reach {@link CandidateOptions.targetType}; it does
   * not exempt it. A `hostile` action still won't offer you to yourself, because
   * the system's `TargetField.prepareConfig` would drop that target on the way
   * back in and leave the action swinging at nothing.
   */
  includeSelf: boolean;
}

/**
 * The shared list build. Both callers want the same rows measured the same way;
 * they differ only in whether a disposition filter and a range gate apply, and
 * whether the acting actor is in the list at all.
 */
function buildCandidates(options: CandidateOptions): TargetCandidate[] {
  const { actor, actingToken, targetType: type, range, includeSelf } = options;
  const tokens = canvas.tokens?.placeables ?? [];
  const targetField = getTargetField();

  const candidates = tokens.filter((token) => {
    if (!token.actor) return false;

    // GM-hidden tokens are not fair game.
    if (token.document.hidden) return false;

    // The acting actor's own tokens. Offered when the caller asks for them, and
    // then only on the same terms as everyone else — they still have to survive
    // the disposition filter below, so `self` is a group, not an exemption.
    const self = isSelfToken(actor, token);
    if (self && !includeSelf) return false;

    // The token the action is measured *from*, when that is someone else — a
    // companion acting for its partner is no more a target of its own claws than
    // the partner would be. Compared by token rather than by actor: an origin is
    // a specific placeable, and two tokens of one actor are two creatures as far
    // as the range origin is concerned. Skipped for self, since in the ordinary
    // case the origin *is* the acting actor's token and this would take back
    // what `includeSelf` just allowed.
    if (!self && token === actingToken) return false;

    // NOTE: we deliberately do NOT filter on `token.visible`. Core's own
    // `targetObjects()` does, but Theatre of the Mind tokens are routinely
    // off-screen or at 0 opacity — excluding them would defeat the purpose.

    // `any` (and a missing type) means the system applies no disposition filter,
    // so neither do we.
    if (!type || type === "any") return true;
    if (!targetField || !actor) return true;

    return targetField.isTargetFriendly(actor, token, type);
  });

  const formatted = candidates.map((token) => {
    const distance = distanceBetween(actingToken, token);
    return {
      ...(targetField ? targetField.formatTarget(token) : fallbackFormat(token)),
      group: groupFor(actor, token, targetField),
      defeated: defeatedBadge(token.actor),
      conditions: activeConditions(token.actor),
      inRange: isWithinRange(distance, range),
      distance,
      band: bandFor(distance),
    };
  });

  // Downed targets sink to the bottom of their section: still pickable (finishing
  // a blow, or healing someone up), just never the first thing under the cursor.
  formatted.sort((a, b) => {
    if (Boolean(a.defeated) !== Boolean(b.defeated)) return a.defeated ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
  return formatted;
}

/**
 * Collect valid, pickable targets in the active scene for a given action.
 *
 * @param action The action being used, whose `target.type` drives disposition filtering.
 * @returns Candidates sorted by name, the downed ones last. Empty if nothing valid is present.
 */
export function collectCandidates(action: DhAction): TargetCandidate[] {
  const actor = action.actor ?? null;
  return buildCandidates({
    actor,
    // A declared origin wins, and falling back rather than failing is
    // deliberate: a companion who isn't on the battle map should leave the
    // ranger measuring from where they stand, not leave the picker unable to
    // measure at all.
    actingToken: resolveRangeOrigin(action) ?? findActingToken(actor),
    targetType: action.target?.type ?? null,
    range: action.range ?? null,
    // Actions whose target type is literally `self` never reach the picker (the
    // guard returns early — the system resolves them to the caster on its own).
    // This is the other case: an action that can be aimed at anyone, aimed at
    // you. Drinking your own potion, patching yourself up, standing in your own
    // blast. The disposition filter still has the final say.
    includeSelf: true,
  });
}

/**
 * Collect everything on the scene as seen *from* one token — the read-only list
 * behind the range survey, where nothing is being targeted and so nothing is
 * filtered out or gated.
 *
 * Deliberately passes no `targetType` and no `range`: a survey is asking "what's
 * around me and how far", so every token is offered and none is greyed as out of
 * reach. The grouping into enemies/neutral/allies is kept, since that's what
 * makes the list scannable — but not the Self group, which a survey has no use
 * for and which would only ever read "you, zero feet away".
 *
 * @param source The token to measure from — one the viewer owns.
 */
export function surveyCandidates(source: Token): TargetCandidate[] {
  return buildCandidates({
    actor: (source.actor as DhActor | null | undefined) ?? null,
    actingToken: source,
    targetType: null,
    range: null,
    // A survey asks what's *around* the source token; listing the source itself
    // at zero feet answers nothing.
    includeSelf: false,
  });
}
