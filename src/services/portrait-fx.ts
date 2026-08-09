/**
 * Transient portrait animations. Runs on every client and touches nothing but
 * the DOM — no actor writes, no permissions, and no interference with an emotion
 * the GM set by hand.
 */
import { LOG_PREFIX, PORTRAIT_WRAPPER_SELECTOR } from "../constants.js";
import type { PortraitFxKind } from "./socket.js";

/**
 * All animations we can play. `"blocked"` is render-local (fired from the chat
 * card on a miss) and never travels over the socket, so it lives here rather
 * than in the socket's `PortraitFxKind`.
 */
export type FxKind = PortraitFxKind | "blocked";

const FX_CLASS: Record<FxKind, string> = {
  targeted: "dhth-fx-targeted",
  damage: "dhth-fx-damage",
  heal: "dhth-fx-heal",
  blocked: "dhth-fx-blocked",
};

/** Persistent (non-animated) class marking a killed target's portrait. */
const DEAD_CLASS = "dhth-dead";

/** Class on a floating resource-change number. */
const FLOAT_CLASS = "dhth-float";

/**
 * How a floating number reads. Both the colour and the travel direction come
 * from this: harm and stress rise, relief sinks — so the three stay tellable
 * apart without relying on hue alone.
 */
export type FloatTone = "harm" | "stress" | "help";

/** Rising tones. Everything else sinks. */
const RISING: ReadonlySet<FloatTone> = new Set<FloatTone>(["harm", "stress"]);

/** Must outlast the float animation in module.css, including its fade tail. */
const FLOAT_TIMEOUT_MS = 4000;

/** Hold the greyscale until just past the damage flash, so it reads as "then". */
const DEAD_DELAY_MS = 700;

/** Backstop in case `animationend` never arrives, so a class can't stick. */
const FX_TIMEOUT_MS = 2500;

/** How long to wait for a portrait that is still on its way up. */
const WAIT_TIMEOUT_MS = 1500;
const WAIT_INTERVAL_MS = 100;

function findWrapper(actorId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `${PORTRAIT_WRAPPER_SELECTOR}[data-actor-id="${CSS.escape(actorId)}"]`,
  );
}

/**
 * A targeting animation usually arrives before the portrait exists: the GM's
 * flag write has to replicate before Ginzzzu builds the node. Poll briefly
 * rather than dropping the effect.
 */
async function waitForWrapper(actorId: string): Promise<HTMLElement | null> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  for (;;) {
    const found = findWrapper(actorId);
    if (found) return found;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, WAIT_INTERVAL_MS));
  }
}

/** Play one animation on a portrait. Silently does nothing if it never appears. */
export async function playFx(actorId: string, kind: FxKind): Promise<void> {
  try {
    const wrapper = await waitForWrapper(actorId);
    if (!wrapper) return;

    const cls = FX_CLASS[kind];
    let timer: ReturnType<typeof setTimeout> | undefined;

    const clear = (): void => {
      wrapper.classList.remove(cls);
      wrapper.removeEventListener("animationend", onEnd);
      if (timer !== undefined) clearTimeout(timer);
    };

    const onEnd = (event: Event): void => {
      // Ignore animations bubbling up from Ginzzzu's own inner elements.
      if (event.target === wrapper) clear();
    };

    // Re-applying the same class mid-animation is a no-op unless the class is
    // dropped and layout is flushed first, so a second hit restarts the effect.
    wrapper.classList.remove(cls);
    void wrapper.offsetWidth;
    wrapper.classList.add(cls);

    wrapper.addEventListener("animationend", onEnd);
    timer = setTimeout(clear, FX_TIMEOUT_MS);
  } catch (error) {
    // Cosmetic only — never let this surface to the player.
    console.warn(`${LOG_PREFIX} Portrait effect failed.`, error);
  }
}

/**
 * Float a resource change off a portrait — "HP +2", "Stress +1", and so on.
 *
 * This is the Theatre of the Mind stand-in for the system's own scrolling combat
 * text, which `createScrollText` (daggerheart.js:7434) draws over
 * `actor.getActiveTokens()` — invisible at a table whose tokens are off-screen.
 *
 * @param tone Drives the colour and travel direction — see `FloatTone`.
 */
export async function floatText(actorId: string, text: string, tone: FloatTone): Promise<void> {
  try {
    const wrapper = await waitForWrapper(actorId);
    if (!wrapper) return;

    // The float is absolutely positioned, so it needs a positioned ancestor or it
    // escapes to whatever is further up Ginzzzu's dock. Nudge only this element,
    // and only when it isn't already positioned — a CSS rule aimed at their
    // wrapper would apply to every portrait whether we're floating on it or not.
    if (getComputedStyle(wrapper).position === "static") wrapper.style.position = "relative";

    const direction = RISING.has(tone) ? "rise" : "sink";
    const node = document.createElement("span");
    node.className = `${FLOAT_CLASS} ${FLOAT_CLASS}--${direction} ${FLOAT_CLASS}--${tone}`;
    node.textContent = text;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const remove = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      node.remove();
    };

    // Backstopped as well as event-driven: a node that outlives its animation
    // would sit on the portrait permanently.
    node.addEventListener("animationend", remove);
    timer = setTimeout(remove, FLOAT_TIMEOUT_MS);

    wrapper.appendChild(node);
  } catch (error) {
    console.warn(`${LOG_PREFIX} Could not float a resource change.`, error);
  }
}

/**
 * Mark a portrait as killed (persistent greyscale) or revived (clear it).
 *
 * Setting dead waits for the portrait — it may still be rising when the killing
 * blow lands — and delays the greyscale so it settles just after the damage
 * flash. Clearing is immediate and never waits: if there's no portrait, there's
 * nothing to clear.
 */
export async function setDead(actorId: string, dead: boolean): Promise<void> {
  try {
    if (!dead) {
      findWrapper(actorId)?.classList.remove(DEAD_CLASS);
      return;
    }
    const wrapper = await waitForWrapper(actorId);
    if (!wrapper) return;
    setTimeout(() => wrapper.classList.add(DEAD_CLASS), DEAD_DELAY_MS);
  } catch (error) {
    console.warn(`${LOG_PREFIX} Portrait death state failed.`, error);
  }
}
