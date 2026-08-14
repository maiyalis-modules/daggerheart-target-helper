/**
 * Minimal ambient declarations for the Daggerheart system surface this module
 * touches. Like `foundry.d.ts`, this is a deliberately small shim rather than a
 * full type package — when you touch a new system API, add it here rather than
 * reaching for `any`.
 *
 * Line references below point at `systems/daggerheart/build/daggerheart.js`
 * (system version 2.5.0) so the shape can be re-verified after a system update.
 */

export {};

declare global {
  /** Target dispositions an Action can declare. See daggerheart.js:122-143. */
  type DhTargetType = "self" | "friendly" | "hostile" | "any";

  /**
   * The shape returned by `TargetField.formatTarget` (daggerheart.js:33082).
   * This is exactly what the system puts into `config.targets`, so reusing it
   * keeps our picker rows and the system's own workflow in agreement.
   */
  interface DhFormattedTarget {
    id: string;
    actorId: string;
    name: string;
    img: string;
    difficulty?: number | null;
    evasion?: number | null;
    saved?: { value: unknown; success: unknown };
    /** Set by the attack roll (RollField, order 10) before the damage part. */
    hit?: boolean;
  }

  /** The `target` schema field on an Action (daggerheart.js:33005). */
  interface DhActionTarget {
    type?: DhTargetType | null;
    /** Max targets. `null` means the system imposes no limit. */
    amount?: number | null;
  }

  interface DhActor {
    id: string;
    uuid: string;
    /** Present for unlinked/scene actors; null for linked world actors. */
    token?: { id: string; disposition?: number } | null;
    /** The linked-actor stand-in the system falls back to for disposition. */
    prototypeToken?: { disposition?: number } | null;
  }

  /**
   * A Daggerheart Action. `use()` is re-invokable, which is what lets the guard
   * cancel and then replay the action once targets exist (daggerheart.js:16873).
   */
  interface DhAction {
    _id: string;
    name: string;
    actionType?: string;
    target?: DhActionTarget | null;
    /** Range band (melee/veryClose/close/far/veryFar), from `RangeField`. Blank means no restriction. */
    range?: string | null;
    actor?: DhActor | null;
    item?: { uuid?: string; name?: string } | null;
    /**
     * Resolves to the finished config, or `undefined` if the action bailed —
     * `prepareConfig` falsy, `preUseAction` returning false, the roll dialog
     * dismissed, or a workflow part returning false. That makes the return value
     * a reliable "did this commit?" signal, which the guard uses to decide
     * whether to roll back the targets it applied.
     */
    use(event: Event | null, configOptions?: AnyObject): Promise<DhActionConfig | undefined>;
  }

  /**
   * The workflow config built by `prepareConfig`. `hasTarget` and `targets` are
   * populated by `TargetField#prepareConfig` (daggerheart.js:33025) — they are
   * the guard's detection signal, so no chat-message flag sniffing is needed.
   */
  interface DhActionConfig {
    event?: Event | null;
    title?: string;
    hasTarget?: boolean;
    targets?: DhFormattedTarget[];
    /** Set by `prepareBaseConfig` from the action's own damage/healing fields. */
    hasDamage?: boolean;
    hasHealing?: boolean;
    /** When set, the action forces its own target and ignores user targets. */
    targetUuid?: string | null;
    dialog?: AnyObject;
  }

  /**
   * Statics on the system's `TargetField`, reached at runtime via
   * `game.system.api.fields.ActionFields.TargetField` (daggerheart.js:41348).
   * Neither method uses `this`, so both are safe to call unbound.
   */
  interface DhTargetFieldStatics {
    formatTarget(token: Token): DhFormattedTarget;
    isTargetFriendly(actor: DhActor, target: Token, type: string): boolean;
  }
}
