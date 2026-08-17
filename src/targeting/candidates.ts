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

/** Which side of the fight a candidate is on, relative to the acting actor. */
export type TargetGroup = "enemy" | "neutral" | "ally";

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
 */
function groupFor(
  actor: DhActor | null,
  token: Token,
  targetField: DhTargetFieldStatics | null,
): TargetGroup {
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
  /** The token distances are measured from; null when the actor has none placed. */
  actingToken: Token | null;
  /** Disposition filter. `null` or `"any"` offers everyone. */
  targetType: string | null;
  /** Range band to gate on. `null` gates nothing, which is survey mode's case. */
  range: string | null;
}

/**
 * The shared list build. Both callers want the same rows measured the same way;
 * they differ only in whether a disposition filter and a range gate apply.
 */
function buildCandidates(options: CandidateOptions): TargetCandidate[] {
  const { actor, actingToken, targetType: type, range } = options;
  const tokens = canvas.tokens?.placeables ?? [];
  const targetField = getTargetField();

  const candidates = tokens.filter((token) => {
    if (!token.actor) return false;

    // GM-hidden tokens are not fair game.
    if (token.document.hidden) return false;

    // Never offer the acting actor its own token. Comparing uuids covers both
    // linked world actors and unlinked scene actors.
    if (actor && token.actor.uuid === actor.uuid) return false;

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
    actingToken: findActingToken(actor),
    targetType: action.target?.type ?? null,
    range: action.range ?? null,
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
 * makes the list scannable.
 *
 * @param source The token to measure from — one the viewer owns.
 */
export function surveyCandidates(source: Token): TargetCandidate[] {
  return buildCandidates({
    actor: (source.actor as DhActor | null | undefined) ?? null,
    actingToken: source,
    targetType: null,
    range: null,
  });
}
