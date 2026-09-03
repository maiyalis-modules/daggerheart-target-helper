/**
 * Cross-client channel for the portrait integration.
 *
 * Raising a Ginzzzu portrait writes an actor flag, which only a GM may do — so a
 * player who attacks an adversary has to ask the GM to raise it. The animations
 * themselves are pure DOM and run on every client independently.
 *
 * Foundry sockets do not loop back to the sender, so every emit here also
 * dispatches locally. Handlers therefore run exactly once per client.
 */
import { SOCKET_EVENT } from "../constants.js";
import type { VfxFlip, VfxPlacement } from "./portrait-fx.js";
import type { VfxSequence, VfxTarget } from "./vfx-resolver.js";

export type PortraitFxKind = "targeted" | "damage" | "heal";


/** One of an action's animations, with its asset already resolved to a file. */
export interface ResolvedVfxStep {
  on: VfxTarget;
  /** Concrete path, resolved by the sender. */
  path: string;
  placement: VfxPlacement;
  flip: VfxFlip;
  delayMs: number;
  speed: number;
  /** Spanning steps only — see `VfxStep.reach`. */
  reach: number;
}

/**
 * An action to depict, as distinct from its outcome.
 *
 * Assets are resolved on the acting client and sent as concrete paths so every
 * client plays the same files — one key can match a whole family of colour and
 * variant siblings, and a table where each player saw a different one would be
 * quietly wrong. Mirroring is *not* sent: that depends on where each client's
 * portraits happen to sit, and they are draggable.
 *
 * `targetActorIds` has already been filtered by the config's `playOn`, so a
 * receiving client plays everything it is given without re-deciding.
 */
export interface ActionVfxPayload {
  /** The acting actor: drawn on by caster steps, and the reference every target
   * step faces. */
  casterActorId: string;
  /** Portraits the action is depicted on. */
  targetActorIds: string[];
  sequence: VfxSequence;
  steps: ResolvedVfxStep[];
  /**
   * Portraits this action touches that are *not* animating — the target of a
   * caster-only effect, or one filtered out by `playOn`.
   *
   * They still wait: all of an action's feedback should land after its animation,
   * whichever portrait the animation happens to be on. They are released once
   * every animating portrait is done.
   */
  followerActorIds: string[];
}

export interface TargetsEngagedPayload {
  /**
   * The acting actor, or `null` when it has none we can name. Carried only so
   * each client can turn the targets to face it — which portrait sits where is a
   * local question (they are draggable), but *who* to face is not.
   */
  casterActorId: string | null;
  /** Targets whose portraits should be raised, then lowered once they settle. */
  actorIds: string[];
  /** Targets that are the acting actor itself: animate, but never raise or lower. */
  selfActorIds: string[];
  /**
   * Whether this action deals damage or healing. When true the portrait holds on
   * a longer safety window instead of the short linger, because the effect lands
   * in a separate chat-card step that may be seconds away — the short linger
   * takes over once the damage/heal actually applies.
   */
  expectsEffect: boolean;
}

type SocketMessage =
  | ({ type: "targetsEngaged" } & TargetsEngagedPayload)
  | { type: "targetsReleased"; actorIds: string[] }
  | { type: "portraitFx"; actorId: string; kind: PortraitFxKind }
  | ({ type: "actionVfx" } & ActionVfxPayload)
  | { type: "vfxExpected"; actorIds: string[] }
  | { type: "vfxRelease"; actorIds: string[] };

export interface SocketHandlers {
  /** Runs on every client. GM-only work is branched inside the handler. */
  onTargetsEngaged: (payload: TargetsEngagedPayload) => void;
  /**
   * The action those targets were engaged for never happened. Runs on every
   * client; only the GM has a portrait to drop.
   */
  onTargetsReleased: (actorIds: string[]) => void;
  /** Runs on every client. */
  onPortraitFx: (actorId: string, kind: PortraitFxKind) => void;
  /** Runs on every client. */
  onActionVfx: (payload: ActionVfxPayload) => void;
  /**
   * An animation is coming for these portraits. Sent at roll time even when the
   * animation itself plays later, so a damage flash arriving in between knows to
   * wait for it. Runs on every client.
   */
  onVfxExpected: (actorIds: string[]) => void;

  /**
   * Nothing is coming for these portraits after all — an animation that was
   * announced and then never played. Runs on every client.
   */
  onVfxRelease: (actorIds: string[]) => void;
}

let handlers: SocketHandlers | null = null;

function dispatch(message: SocketMessage): void {
  if (!handlers) return;
  switch (message.type) {
    case "targetsEngaged":
      handlers.onTargetsEngaged({
        casterActorId: message.casterActorId,
        actorIds: message.actorIds,
        selfActorIds: message.selfActorIds,
        expectsEffect: message.expectsEffect,
      });
      return;
    case "targetsReleased":
      handlers.onTargetsReleased(message.actorIds);
      return;
    case "portraitFx":
      handlers.onPortraitFx(message.actorId, message.kind);
      return;
    case "actionVfx":
      handlers.onActionVfx({
        casterActorId: message.casterActorId,
        targetActorIds: message.targetActorIds,
        sequence: message.sequence,
        steps: message.steps,
        followerActorIds: message.followerActorIds,
      });
      return;
    case "vfxExpected":
      handlers.onVfxExpected(message.actorIds);
      return;
    case "vfxRelease":
      handlers.onVfxRelease(message.actorIds);
      return;
  }
}

export function registerSocket(deps: SocketHandlers): void {
  handlers = deps;
  game.socket?.on(SOCKET_EVENT, (message: SocketMessage) => dispatch(message));
}

/** Send to every other client, then run locally — sockets do not echo back. */
function broadcast(message: SocketMessage): void {
  game.socket?.emit(SOCKET_EVENT, message);
  dispatch(message);
}

export function emitTargetsEngaged(payload: TargetsEngagedPayload): void {
  broadcast({ type: "targetsEngaged", ...payload });
}

export function emitTargetsReleased(actorIds: string[]): void {
  broadcast({ type: "targetsReleased", actorIds });
}

export function emitPortraitFx(actorId: string, kind: PortraitFxKind): void {
  broadcast({ type: "portraitFx", actorId, kind });
}

export function emitActionVfx(payload: ActionVfxPayload): void {
  broadcast({ type: "actionVfx", ...payload });
}

export function emitVfxExpected(actorIds: string[]): void {
  broadcast({ type: "vfxExpected", actorIds });
}

export function emitVfxRelease(actorIds: string[]): void {
  broadcast({ type: "vfxRelease", actorIds });
}
