/**
 * Transient portrait animations. Runs on every client and touches nothing but
 * the DOM — no actor writes, no permissions, and no interference with an emotion
 * the GM set by hand.
 *
 * Two tiers, deliberately independent. A CSS flash on the wrapper is the
 * baseline and always runs; a JB2A video is layered over it for the kinds that
 * have one. The video tier is optional at every step — no entry for the kind, no
 * JB2A installed, a bad path, a failed decode — and each of those falls back to
 * the flash alone rather than to nothing.
 */
import { JB2A_MODULE_ID, LOG_PREFIX, VFX_DAMAGE_PATH } from "../constants.js";
import {
  findWrapper,
  portraitActorIds,
  waitForWrapper,
  wrapperMirrored,
} from "./portrait-dom.js";
import type { PortraitFxKind } from "./socket.js";
import { vfxChainFlash } from "./vfx-settings.js";

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

/**
 * Video effects played *alongside* the CSS flash, by kind. Absent kinds simply
 * don't get one — the flash is the baseline and the video is additive, so a
 * missing entry, a missing asset, or a missing JB2A all degrade to exactly the
 * behaviour this module had before.
 */
const FX_VIDEO: Partial<Record<FxKind, string>> = {
  damage: VFX_DAMAGE_PATH,
};

/** Placement class for a video effect. See `.dhth-vfx` in module.css. */
const VFX_CLASS = "dhth-vfx";

/** Placement class for a spanning effect. See `.dhth-vfx-span` in module.css. */
const SPAN_CLASS = "dhth-vfx-span";

/**
 * Backstop for a video that never reports finishing. `ended` covers the normal
 * path and `error` covers a failed load, but a decode that stalls mid-playback
 * fires neither — and a frozen frame parked on a portrait is far more obvious
 * mid-session than a stuck class. Comfortably longer than any JB2A asset.
 */
const VFX_TIMEOUT_MS = 10_000;

/**
 * Animations in flight per portrait. A damage flash that has been chained to the
 * animation waits until this empties for that actor.
 */
const activeVideos = new Map<string, Set<HTMLVideoElement>>();

/**
 * Portraits an animation has been *announced* for but not yet started on.
 *
 * The announcement is what makes chaining work at all. Damage is applied inside
 * the action's workflow, so with `"action"` timing the flash always arrives
 * *before* the animation it is supposed to follow — there is no video to wait on
 * yet. Marking the portrait at roll time gives the flash something to wait for.
 */
const expectingVfx = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Outcome feedback held back, keyed by portrait, in the order it arrived.
 *
 * A queue of thunks rather than a flash kind, because the flash is not the only
 * thing that has to wait: the floating "HP -2" belongs with its flash, and
 * holding one without the other just moves the desync somewhere more visible.
 */
const heldEffects = new Map<string, Array<() => void>>();

/**
 * Feedback that waits for the animation.
 *
 * `"targeted"` is excluded on purpose. It fires *before* the action, to announce
 * who is being aimed at, so holding it until after the animation would defeat the
 * entire point of it. Everything else here reports an outcome, and an outcome
 * reads better after the blow than during it.
 */
const CHAINABLE: ReadonlySet<FxKind> = new Set<FxKind>(["damage", "heal", "blocked"]);

/**
 * How long an announced animation has to actually arrive.
 *
 * A held flash must never be lost: an action can be announced and then never
 * animate (a workflow part bails, the asset fails to load), and a portrait that
 * silently stopped flashing for damage would be a far worse bug than one that
 * flashes late. Generous, because it only ever fires when something went wrong.
 */
const VFX_EXPECT_TTL_MS = 10_000;

/**
 * Announce that an animation is coming for this portrait, so a damage flash
 * arriving first knows to wait. Safe to call more than once for one portrait.
 */
export function expectVfx(actorId: string): void {
  const existing = expectingVfx.get(actorId);
  if (existing !== undefined) clearTimeout(existing);
  expectingVfx.set(
    actorId,
    setTimeout(() => settleVfx(actorId), VFX_EXPECT_TTL_MS),
  );
}

/**
 * Told when a portrait starts and stops holding feedback, so the portrait bridge
 * can keep the portrait on screen for as long as something is waiting on it.
 *
 * A listener rather than a direct call: this module knows about the DOM and
 * nothing else, and the linger is the bridge's business. Registered once, at init.
 */
type VfxHoldListener = (actorId: string, held: boolean) => void;
const holdListeners: VfxHoldListener[] = [];

export function onVfxHoldChange(listener: VfxHoldListener): void {
  holdListeners.push(listener);
}

function notifyHold(actorId: string, held: boolean): void {
  for (const listener of holdListeners) {
    try {
      listener(actorId, held);
    } catch (error) {
      console.warn(`${LOG_PREFIX} A hold listener failed.`, error);
    }
  }
}

/** Whether anything is still expected or playing on this portrait. */
function awaitingVfx(actorId: string): boolean {
  return expectingVfx.has(actorId) || activeVideos.has(actorId);
}

/**
 * Queue something to run once this portrait's animation is done, if the table has
 * asked for that and an animation is actually pending. Answers whether it took
 * ownership — a `false` means the caller should just get on with it.
 */
function holdUntilVfx(actorId: string, run: () => void): boolean {
  if (!vfxChainFlash() || !awaitingVfx(actorId)) return false;
  const queue = heldEffects.get(actorId);
  if (queue) queue.push(run);
  else heldEffects.set(actorId, [run]);
  notifyHold(actorId, true);
  return true;
}

/**
 * Portraits waiting on *someone else's* animation.
 *
 * A portrait usually waits for the video playing on itself, but not always: a
 * caster-only animation still has its damage land on the target, and that flash
 * should follow the swing rather than pre-empt it. So an action nominates the
 * portraits that actually animate as drivers, and everything else it touches
 * follows them — released once the last driver is done.
 */
interface ReleaseGroup {
  /** Drivers still animating. The followers go when this empties. */
  pending: Set<string>;
  followers: string[];
}

const driverGroups = new Map<string, ReleaseGroup>();

/**
 * Tie a set of portraits to the animations they should wait for.
 *
 * With no drivers there is nothing to wait for, so the followers are let go at
 * once — an action whose targets were all filtered out by `playOn` must not leave
 * its feedback sitting on the backstop.
 */
export function linkVfxRelease(driverActorIds: string[], followerActorIds: string[]): void {
  if (driverActorIds.length === 0) {
    for (const actorId of followerActorIds) settleVfx(actorId);
    return;
  }

  const group: ReleaseGroup = {
    pending: new Set(driverActorIds),
    followers: followerActorIds.filter((id) => !driverActorIds.includes(id)),
  };
  for (const actorId of driverActorIds) driverGroups.set(actorId, group);
}

/**
 * Nothing more is coming for this portrait — run whatever was waiting on it.
 *
 * Exported because an action can announce more portraits than it ends up drawing
 * on: `playOn` filtering happens after the announcement, and a target filtered
 * out would otherwise sit on its held flash until the backstop fired.
 */
export function releaseVfx(actorId: string): void {
  settleVfx(actorId);
}

function settleVfx(actorId: string): void {
  const timer = expectingVfx.get(actorId);
  if (timer !== undefined) clearTimeout(timer);
  expectingVfx.delete(actorId);

  const queue = heldEffects.get(actorId);
  if (queue) {
    heldEffects.delete(actorId);
    for (const run of queue) run();
    // Only after something was actually held and released. A settle with nothing
    // queued must stay silent: the portrait may be sitting on the long grace an
    // attack takes while its damage step is still to come, and telling the bridge
    // to re-arm the short linger there would drop it out from under the player.
    notifyHold(actorId, false);
  }

  // This portrait may have been the last animation a group was waiting on. The
  // group is unhooked before recursing, so a follower can never settle back into
  // the driver that released it.
  const group = driverGroups.get(actorId);
  if (!group) return;
  driverGroups.delete(actorId);
  group.pending.delete(actorId);
  if (group.pending.size > 0) return;

  const followers = group.followers;
  group.followers = [];
  for (const follower of followers) settleVfx(follower);
}

function trackVideo(actorId: string, video: HTMLVideoElement): void {
  const existing = activeVideos.get(actorId);
  if (existing) existing.add(video);
  else activeVideos.set(actorId, new Set([video]));
}

function untrackVideo(actorId: string, video: HTMLVideoElement): void {
  const existing = activeVideos.get(actorId);
  if (!existing) return;
  existing.delete(video);
  if (existing.size > 0) return;
  activeVideos.delete(actorId);
  settleVfx(actorId);
}

/**
 * Absolutely positioned children escape to whatever is further up Ginzzzu's dock
 * unless the wrapper is itself positioned. Nudge only this element, and only when
 * it isn't already positioned — a CSS rule aimed at their wrapper would apply to
 * every portrait whether we are drawing on it or not.
 */
function ensurePositioned(wrapper: HTMLElement): void {
  if (getComputedStyle(wrapper).position === "static") wrapper.style.position = "relative";
}

/**
 * Where a video effect sits on a portrait, as plain numbers rather than CSS.
 *
 * Numbers because these are about to become fields in a config form that a GM
 * fills in per action — "1.7" is a sane thing to type into a box, "170%" is not.
 * They are converted to custom properties on the element, so a placement that
 * reads wrong can still be dialled in live in devtools before being written back.
 */
export interface VfxPlacement {
  /** Width as a multiple of the portrait wrapper's width. 1 = exactly as wide. */
  scale: number;
  /** Vertical centre down the wrapper, 0 (top) to 1 (bottom). */
  anchor: number;
}

/** Used by the outcome flashes, and as the fallback for a half-filled config. */
export const DEFAULT_PLACEMENT: VfxPlacement = { scale: 1, anchor: 0.4 };

/**
 * How to mirror an effect horizontally.
 *
 * JB2A assets are authored with the actor off the left edge, so anything with a
 * direction reads backwards when the other party's portrait is to the left.
 * `"auto"` resolves that from the live rects at play time — never by the sender,
 * because portraits are draggable and two clients need not agree on the order.
 */
export type VfxFlip = "auto" | "never" | "always";

/**
 * Play a JB2A animation over a portrait.
 *
 * A fresh `<video>` every call, never a reused one. Replaying a single element
 * means re-attaching and rewinding it, and two blows landing together would have
 * the second interrupt the first; separate nodes overlap on their own.
 *
 * `play()` is called explicitly rather than trusting the `autoplay` attribute,
 * which does not reliably start a video appended from script — it loads, paints
 * one frame and sits there. Assets that open on a build-up then show nothing at
 * all, which is a genuinely confusing way to fail.
 *
 * The node is a child of the wrapper so it inherits Ginzzzu's drag and flip
 * transforms. Never set a transform on the wrapper itself: they drive it through
 * custom properties (`--ginzzzu-drag-x`, `--ginzzzu-flip-scale-x`) plus a WAAPI
 * breathing animation, and writing over it fights them.
 */
function playVideoFx(
  wrapper: HTMLElement,
  path: string,
  placement: VfxPlacement = DEFAULT_PLACEMENT,
  flip = false,
  speed = 1,
): Promise<void> {
  // Nothing to play, but callers may still be awaiting this to sequence on.
  if (!game.modules.get(JB2A_MODULE_ID)?.active) return Promise.resolve();

  ensurePositioned(wrapper);

  const video = document.createElement("video");
  // Muted is what lets playback start without a user gesture. JB2A assets carry
  // no audio track, so nothing is given up for it.
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.className = VFX_CLASS;

  // Clamped rather than trusted: `playbackRate` throws on some values, and a
  // config typo should not take the animation down with it.
  const rate = clampVfxSpeed(speed);
  // `defaultPlaybackRate` as well as `playbackRate`, and again once metadata is
  // in: loading a media resource resets `playbackRate` back to
  // `defaultPlaybackRate`, so a rate set before `src` is assigned — as it is
  // here — is thrown away by the load that follows. Setting only `playbackRate`
  // looks correct and does nothing at all.
  //
  // Slowing an asset stretches the wait for anything chained to it, which is the
  // behaviour we want: `ended` still fires when the video is genuinely over, so
  // no duration is ever calculated.
  video.defaultPlaybackRate = rate;
  video.playbackRate = rate;
  video.addEventListener("loadedmetadata", () => {
    video.playbackRate = rate;
  });
  video.style.setProperty("--dhth-vfx-width", `${placement.scale * 100}%`);
  video.style.setProperty("--dhth-vfx-top", `${placement.anchor * 100}%`);
  if (flip) video.style.setProperty("--dhth-vfx-flip", "-1");

  const actorId = wrapper.dataset["actorId"] ?? "";

  // Resolves when the video is gone, however it went — finished, failed, or timed
  // out. That is what lets a sequential step wait for the one before it without
  // reading a duration, and it stays correct whatever `speed` does to the runtime.
  return new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const remove = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      video.remove();
      if (actorId) untrackVideo(actorId, video);
      resolve();
    };

    video.addEventListener("ended", remove);
    video.addEventListener("error", remove);
    timer = setTimeout(remove, VFX_TIMEOUT_MS);

    video.src = path;
    wrapper.appendChild(video);
    if (actorId) trackVideo(actorId, video);
    void video.play().catch(() => remove());
  });
}

/**
 * Play a configured effect on one portrait.
 *
 * `referenceActorId` is the *other* party in the exchange — the attacker when
 * drawing on a target, the target when drawing on the caster. It is used only to
 * resolve `"auto"` mirroring, and only from live rects on this client. A reference
 * with no portrait on screen is not a reason to drop the effect: it plays
 * unmirrored, which is better than not playing.
 *
 * The delay is honoured here rather than by the sender so that every client waits
 * the same amount from its own receipt, instead of inheriting the sender's clock.
 */
export async function playPortraitVfx(options: {
  actorId: string;
  referenceActorId?: string | null;
  path: string;
  placement?: VfxPlacement;
  flip?: VfxFlip;
  delayMs?: number;
  speed?: number;
}): Promise<void> {
  try {
    const { actorId, referenceActorId, path } = options;
    const placement = options.placement ?? DEFAULT_PLACEMENT;
    const flipMode = options.flip ?? "auto";
    const delayMs = options.delayMs ?? 0;

    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));

    const wrapper = await waitForWrapper(actorId);
    if (!wrapper) return;

    let flip = flipMode === "always";
    if (flipMode === "auto" && referenceActorId) {
      const reference = findWrapper(referenceActorId);
      flip =
        reference !== null &&
        reference.getBoundingClientRect().left > wrapper.getBoundingClientRect().left;
    }

    // The video is a child of the wrapper, so a mirrored portrait mirrors the
    // effect along with it — and every `flip` decision above is about how the
    // effect reads *on screen*. Cancel the wrapper's own mirroring back out, or a
    // portrait turned to face its attacker (or one the GM flipped by hand) plays
    // every directional asset backwards. `wrapperMirrored` reads the composed
    // value, so it covers both causes at once.
    if (wrapperMirrored(wrapper)) flip = !flip;

    await playVideoFx(wrapper, path, placement, flip, options.speed ?? 1);
  } catch (error) {
    console.warn(`${LOG_PREFIX} Portrait effect failed.`, error);
  }
}


/** Speed bounds, shared so the config form's readout can never disagree with
 * what actually plays. `playbackRate` throws outside a sane range. */
export function clampVfxSpeed(speed: number): number {
  return Math.min(4, Math.max(0.1, Number.isFinite(speed) ? speed : 1));
}

/**
 * An asset's runtime and natural size, or null when it can't be determined.
 *
 * Probed from a detached `<video>` with `preload="metadata"` — enough to read both
 * without fetching the whole file, and it never touches the page. Results are
 * cached per path, failures included, so typing in the config form's key field
 * doesn't re-probe the same asset on every keystroke.
 */
export interface VideoMeta {
  /** Seconds at natural speed. */
  duration: number;
  width: number;
  height: number;
}

const metaCache = new Map<string, VideoMeta | null>();

export async function probeVideoMeta(path: string): Promise<VideoMeta | null> {
  const cached = metaCache.get(path);
  if (cached !== undefined) return cached;

  const meta = await new Promise<VideoMeta | null>((resolve) => {
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.muted = true;

    probe.addEventListener("loadedmetadata", () => {
      resolve(
        Number.isFinite(probe.duration) && probe.videoWidth > 0
          ? { duration: probe.duration, width: probe.videoWidth, height: probe.videoHeight }
          : null,
      );
    });
    probe.addEventListener("error", () => resolve(null));
    // A metadata fetch that never lands must not leave the caller awaiting.
    setTimeout(() => resolve(null), 5000);

    probe.src = path;
  });

  metaCache.set(path, meta);
  return meta;
}

/** Runtime in seconds, or null. See {@link probeVideoMeta}. */
export async function probeVideoDuration(path: string): Promise<number | null> {
  return (await probeVideoMeta(path))?.duration ?? null;
}

/**
 * Run a list of animations either all at once or one after another.
 *
 * Shared by the real playback and the config window's preview so the two can't
 * drift — a preview that times its steps differently from the table is worse than
 * no preview at all.
 *
 * A **positive** gap waits on the previous step's video actually ending, which
 * needs no arithmetic and cannot drift however long the asset is or whatever
 * `speed` does to it. A **negative** gap is the one case that cannot work that
 * way: "start 200ms before the previous finishes" is a moment that has already
 * passed by the time `ended` fires, so there the runtime has to be measured. That
 * makes overlap approximate — the real video also waits on its portrait being on
 * screen — which is fine for a cosmetic beat.
 *
 * @param start Launches one item and resolves when it has finished. The delay is
 *   passed in rather than read from the item, because in a sequence the waiting
 *   has already happened here and must not be applied twice.
 */
export async function runVfxSequence<T>(
  items: readonly T[],
  sequence: "together" | "after",
  handlers: {
    delayOf: (item: T) => number;
    runtimeOf: (item: T) => Promise<number>;
    start: (item: T, delayMs: number) => Promise<void>;
  },
): Promise<void> {
  const { delayOf, runtimeOf, start } = handlers;

  if (sequence !== "after") {
    for (const item of items) void start(item, delayOf(item));
    return;
  }

  let running: Promise<void> | null = null;
  let previous: T | null = null;

  for (const item of items) {
    const delay = delayOf(item);

    if (!running) {
      await wait(delay);
    } else if (delay < 0 && previous !== null) {
      await wait((await runtimeOf(previous)) + delay);
    } else {
      await running;
      await wait(delay);
    }

    previous = item;
    running = start(item, 0);
  }

  await running;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}


/**
 * Two portraits to preview a spanning effect between, or null if there aren't two.
 *
 * Prefers `preferredActorId` as the source so a weapon's own owner fires the shot
 * where possible, then takes whatever else is on screen as the destination.
 */
export function pickPreviewPair(
  preferredActorId?: string | null,
): { fromActorId: string; toActorId: string } | null {
  const ids = portraitActorIds();

  if (ids.length < 2) return null;

  const fromActorId = preferredActorId && ids.includes(preferredActorId) ? preferredActorId : ids[0];
  const toActorId = ids.find((id) => id !== fromActorId);
  return fromActorId && toActorId ? { fromActorId, toActorId } : null;
}

/**
 * The layer spanning animations are drawn on.
 *
 * A projectile belongs to *two* portraits, so it cannot live inside either the way
 * every other effect does — it is positioned in viewport coordinates on its own
 * fixed overlay instead. The cost of that is what it gives up: it does not inherit
 * Ginzzzu's drag or flip, so a portrait dragged mid-flight leaves the shot behind.
 * Projectiles are short and that has never looked wrong, but it is the reason this
 * is a separate renderer rather than another `on` value.
 */
const SPAN_LAYER_ID = "dhth-vfx-span-layer";

function spanLayer(): HTMLElement {
  const existing = document.getElementById(SPAN_LAYER_ID);
  if (existing) return existing;

  const layer = document.createElement("div");
  layer.id = SPAN_LAYER_ID;
  document.body.appendChild(layer);
  return layer;
}

/** The point on a portrait a span starts or ends at. */
function anchorPoint(wrapper: HTMLElement, anchor: number): { x: number; y: number } {
  const rect = wrapper.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height * anchor };
}

/**
 * Draw an animation travelling from one portrait to another.
 *
 * Stretched along the line and left at its natural thickness — the same bargain
 * Sequencer's `stretchTo` makes. JB2A's ranged assets bake a travel distance into
 * their pixel width (`_30ft_1600x400`), and no portrait rail is going to match one
 * of those, so something has to give. Stretching lengthwise keeps the beam a
 * consistent thickness whatever the gap, which reads far better than a strip that
 * gets fatter the further it flies; pick an asset whose length is roughly the
 * separation you usually have and the distortion is invisible.
 *
 * Tracked against the *destination* portrait, so a damage flash chained to the
 * animation waits for the shot to land rather than for it to be fired.
 */
export async function playSpanVfx(options: {
  fromActorId: string;
  toActorId: string;
  path: string;
  placement?: VfxPlacement;
  delayMs?: number;
  speed?: number;
  /** How far past both portrait centres to draw. See `VfxStep.reach`. */
  reach?: number;
}): Promise<void> {
  try {
    const { fromActorId, toActorId, path } = options;
    const placement = options.placement ?? DEFAULT_PLACEMENT;

    if ((options.delayMs ?? 0) > 0) await wait(options.delayMs ?? 0);
    if (!game.modules.get(JB2A_MODULE_ID)?.active) return;

    const to = await waitForWrapper(toActorId);
    const from = findWrapper(fromActorId);
    // Both ends are required: there is no sensible place to draw a shot from an
    // actor who has no portrait on screen.
    if (!to || !from) return;

    const meta = await probeVideoMeta(path);
    if (!meta) return;

    const start = anchorPoint(from, placement.anchor);
    const end = anchorPoint(to, placement.anchor);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const centreDistance = Math.hypot(dx, dy);
    if (centreDistance < 1) return;

    // Extended symmetrically past both centres, so the asset's own transparent
    // lead-in and lead-out fall outside the portraits rather than eating into the
    // span. The origin moves back by half the extra, or the whole overshoot would
    // land on the target's end.
    const reach = Math.min(4, Math.max(1, options.reach ?? 1));
    const overshoot = (reach - 1) / 2;
    const originX = start.x - dx * overshoot;
    const originY = start.y - dy * overshoot;
    const distance = centreDistance * reach;

    const angle = Math.atan2(dy, dx);
    const thickness = meta.height * placement.scale;

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.className = SPAN_CLASS;

    const rate = clampVfxSpeed(options.speed ?? 1);
    video.defaultPlaybackRate = rate;
    video.playbackRate = rate;
    video.addEventListener("loadedmetadata", () => {
      video.playbackRate = rate;
    });

    video.style.left = `${originX}px`;
    video.style.top = `${originY}px`;
    video.style.width = `${distance}px`;
    video.style.height = `${thickness}px`;
    // Half its own thickness up, so the strip is centred on the line rather than
    // hanging below it, then rotated about that same left-centre point.
    video.style.marginTop = `${-thickness / 2}px`;
    video.style.transform = `rotate(${angle}rad)`;

    return await new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const remove = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        video.remove();
        untrackVideo(toActorId, video);
        resolve();
      };

      video.addEventListener("ended", remove);
      video.addEventListener("error", remove);
      timer = setTimeout(remove, VFX_TIMEOUT_MS);

      video.src = path;
      spanLayer().appendChild(video);
      trackVideo(toActorId, video);
      void video.play().catch(() => remove());
    });
  } catch (error) {
    console.warn(`${LOG_PREFIX} Span effect failed.`, error);
  }
}

/**
 * Pick a portrait to preview an effect on, preferring the one that owns it.
 *
 * The config form needs *somewhere* to draw, and the actor being configured is
 * usually but not always on screen — a GM tuning an adversary's weapon before the
 * fight starts may only have the party up. Falling back to any portrait is more
 * useful than refusing to preview, because scale and anchor are what is being
 * judged and those read the same on anyone.
 */
export function pickPreviewActorId(preferredActorId?: string | null): string | null {
  if (preferredActorId && findWrapper(preferredActorId)) return preferredActorId;
  return portraitActorIds()[0] ?? null;
}

/**
 * Play one animation on a portrait.
 *
 * Outcome flashes are held back when an animation has been announced for that
 * portrait and the table has asked for the two to be sequenced — see `expectVfx`
 * and `CHAINABLE`. The targeting cue never waits, and a held flash is released by
 * `settleVfx` the moment the animation finishes (or gives up).
 */
export async function playFx(actorId: string, kind: FxKind): Promise<void> {
  if (CHAINABLE.has(kind) && holdUntilVfx(actorId, () => void runFx(actorId, kind))) return;
  return runFx(actorId, kind);
}

/** Apply the flash. Silently does nothing if the portrait never appears. */
async function runFx(actorId: string, kind: FxKind): Promise<void> {
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

    // Additive: the flash above always runs, and the video joins it when the kind
    // has one and JB2A is installed.
    const videoPath = FX_VIDEO[kind];
    if (videoPath) playVideoFx(wrapper, videoPath);
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
  if (holdUntilVfx(actorId, () => void runFloat(actorId, text, tone))) return;
  return runFloat(actorId, text, tone);
}

/** Draw the number. Silently does nothing if the portrait never appears. */
async function runFloat(actorId: string, text: string, tone: FloatTone): Promise<void> {
  try {
    const wrapper = await waitForWrapper(actorId);
    if (!wrapper) return;

    ensurePositioned(wrapper);

    const direction = RISING.has(tone) ? "rise" : "sink";
    const node = document.createElement("span");
    node.className = `${FLOAT_CLASS} ${FLOAT_CLASS}--${direction} ${FLOAT_CLASS}--${tone}`;
    node.textContent = text;
    // The number is a child of the wrapper, so a mirrored portrait — turned to
    // face its attacker, or flipped by the GM — would print "HP -2" backwards.
    // Turn the glyphs back; the keyframes carry the variable, since an animated
    // transform replaces whatever the base rule says.
    if (wrapperMirrored(wrapper)) node.style.setProperty("--dhth-float-flip", "-1");

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
