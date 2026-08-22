/**
 * **Range origin** — letting another module say "measure this action from *that*
 * token", when the token acting is not the token rolling.
 *
 * Everywhere else in this module the two are the same thing, and
 * {@link findActingToken} finding the acting actor's token is the whole answer.
 * One case breaks that: an action a character rolls but a **different creature
 * performs**. A Beastbound ranger commanding their animal companion is the
 * motivating one — the ranger makes the Spellcast Roll, so the roll, the Hope,
 * and every bonus are the ranger's, but the claws that arrive are the
 * companion's and reach only as far as the companion is standing. Measuring that
 * attack from the ranger would offer targets the companion cannot touch and hide
 * ones it can.
 *
 * ## Why a registry and not a property on the action
 *
 * A caller could stamp a token uuid onto the action object and have us read it,
 * and that would be less code here. It would also be an undocumented convention
 * living in two repositories with nothing tying them together, and the system's
 * Actions are `DataModel`s — a stray property on one is invisible to its schema,
 * survives no round trip, and is exactly the kind of thing a system update
 * silently starts sealing away. A registered function is a contract: it appears
 * in {@link TargetHelperApi}, it is called with the action and answers or
 * declines, and when it throws it takes only itself out.
 *
 * ## What a resolver is allowed to return
 *
 * A `Token`, a token id, a token uuid, or `null` to decline. Ids and uuids are
 * accepted because the caller frequently has one rather than the placeable — and
 * resolving them here keeps that lookup, and its failure, in one place. Anything
 * that doesn't resolve to a token **on the current scene** is treated as a
 * decline rather than as "no origin", so a companion left off the battle map
 * falls back to measuring from its partner instead of measuring from nowhere.
 */
import { LOG_PREFIX } from "../constants.js";

/**
 * Answers "where is this action measured from?", or `null` to leave it to the
 * acting actor's own token.
 */
export type RangeOriginResolver = (action: DhAction) => Token | string | null;

/**
 * Registered in call order; the first non-null answer wins.
 *
 * An array rather than a single slot because two modules asking the same
 * question about different actions is a normal thing to want, and the failure
 * mode of one slot — the second registration silently replacing the first — is
 * the worst one available.
 */
const resolvers: RangeOriginResolver[] = [];

/** Add a resolver. See {@link TargetHelperApi.registerRangeOrigin}. */
export function registerRangeOrigin(resolver: RangeOriginResolver): void {
  if (typeof resolver !== "function") {
    console.warn(`${LOG_PREFIX} Ignoring a range-origin resolver that is not a function.`);
    return;
  }
  resolvers.push(resolver);
}

/** Turn whatever a resolver answered into a placed token, or null. */
function asToken(answer: Token | string | null): Token | null {
  if (!answer) return null;
  if (typeof answer !== "string") return answer;

  const byId = canvas.tokens?.get(answer) ?? null;
  if (byId) return byId;

  // A uuid is the other thing a caller reasonably holds. `fromUuidSync` returns
  // the TokenDocument, whose `object` is the placeable — null when the token is
  // on some other scene, which is the decline we want.
  const document = fromUuidSync(answer) as AnyObject | null;
  const object = document?.["object"] as Token | null | undefined;
  return object ?? null;
}

/**
 * The token this action should be measured from, or `null` when nobody claims
 * it and the ordinary acting-token rule applies.
 *
 * Every resolver is guarded individually: another module's mistake should cost
 * that module its override, not take the target picker down with it.
 */
export function resolveRangeOrigin(action: DhAction): Token | null {
  for (const resolver of resolvers) {
    let token: Token | null = null;
    try {
      token = asToken(resolver(action));
    } catch (error) {
      console.warn(`${LOG_PREFIX} A range-origin resolver threw; ignoring it.`, error);
      continue;
    }

    // Only a token actually on this canvas counts — see the header.
    if (token && canvas.tokens?.placeables.includes(token)) return token;
  }
  return null;
}
