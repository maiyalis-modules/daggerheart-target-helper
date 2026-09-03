/**
 * Finding, and reading the orientation of, Ginzzzu's live portrait nodes.
 *
 * Shared by everything that draws on a portrait (`portrait-fx`) and everything
 * that turns one (`portrait-facing`), because both need the same two answers:
 * *where is this actor's wrapper* and *is it currently mirrored*. Read-only —
 * nothing here writes to the DOM.
 */
import { PORTRAIT_WRAPPER_SELECTOR } from "../constants.js";

/** How long to wait for a portrait that is still on its way up. */
const WAIT_TIMEOUT_MS = 1500;
const WAIT_INTERVAL_MS = 100;

/**
 * The custom property Ginzzzu's wrapper transform ends on
 * (`… scaleX(var(--ginzzzu-flip-scale-x, 1))`). Registered by them through
 * `@property` with `syntax: "<number>"`, so the *computed* value is always a
 * plain number however it was set — which is what makes it readable as the one
 * answer to "which way is this portrait facing", whether it was flipped by the
 * GM's right-click class or by us.
 */
export const FLIP_VAR = "--ginzzzu-flip-scale-x" as const;

/**
 * Class Ginzzzu puts on a wrapper the GM flipped by hand. It is backed by an
 * actor flag, so it is the actor's *baseline* orientation — the thing a transient
 * turn-to-face composes with rather than replaces.
 */
export const PORTRAIT_FLIPPED_CLASS = "ginzzzu-portrait-flipped" as const;

export function findWrapper(actorId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `${PORTRAIT_WRAPPER_SELECTOR}[data-actor-id="${CSS.escape(actorId)}"]`,
  );
}

/**
 * A targeting animation usually arrives before the portrait exists: the GM's
 * flag write has to replicate before Ginzzzu builds the node. Poll briefly
 * rather than dropping the effect.
 */
export async function waitForWrapper(actorId: string): Promise<HTMLElement | null> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  for (;;) {
    const found = findWrapper(actorId);
    if (found) return found;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, WAIT_INTERVAL_MS));
  }
}

/** Every portrait currently on screen, in dock order. */
export function portraitActorIds(): string[] {
  return [...document.querySelectorAll<HTMLElement>(`${PORTRAIT_WRAPPER_SELECTOR}[data-actor-id]`)]
    .map((wrapper) => wrapper.dataset["actorId"])
    .filter((id): id is string => Boolean(id));
}

/** Where a portrait sits horizontally, in viewport coordinates. */
export function wrapperCentreX(wrapper: HTMLElement): number {
  const rect = wrapper.getBoundingClientRect();
  return rect.left + rect.width / 2;
}

/**
 * Whether the portrait is mirrored on screen right now, from *any* cause — the
 * GM's own flip or our turn-to-face.
 *
 * Read from the computed property rather than the class, so one call covers both.
 * Anything drawn inside the wrapper is mirrored along with it, so a directional
 * effect has to know.
 */
export function wrapperMirrored(wrapper: HTMLElement): boolean {
  const raw = getComputedStyle(wrapper).getPropertyValue(FLIP_VAR).trim();
  return Number.parseFloat(raw) < 0;
}
