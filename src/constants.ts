/** Shared, immutable identifiers for the module. */

export const MODULE_ID = "daggerheart-target-helper" as const;
export const MODULE_TITLE = "Maiyalis: Target Helper" as const;

/** Prefix used for all console logging so output is easy to filter. */
export const LOG_PREFIX = `${MODULE_TITLE} |` as const;

/** Setting keys, kept in one place to avoid typos across the codebase. */
export const SETTINGS = {
  /** Whether the module's helpers are active for this client. */
  enabled: "enabled",
  /** Whether targeted actions raise the target's Ginzzzu portrait. */
  portraitIntegration: "portraitIntegration",
  /** Seconds a raised portrait lingers after the last thing that happened to it. */
  portraitLingerSeconds: "portraitLingerSeconds",
  /**
   * Turn a target's portrait to face whoever is acting on it — and, since it
   * takes the baseline direction unflipped art looks in, the switch for the whole
   * feature. See `services/portrait-facing.ts`.
   */
  portraitFacing: "portraitFacing",
  /** Whether to release the acting user's targets once an action completes. */
  clearTargetsAfterAction: "clearTargetsAfterAction",
  /** On a full miss: hide the damage prompt and flash a block on the target. */
  missFeedback: "missFeedback",
  /** Float resource changes (HP marked, Stress, healing) off the portrait. */
  damageNumbers: "damageNumbers",
  /** Master switch for action animations (the JB2A layer). */
  vfxEnabled: "vfxEnabled",
  /** When an action's animation plays — see `VfxTiming`. */
  vfxTiming: "vfxTiming",
  /** Hold the damage flash until the animation finishes instead of overlapping. */
  vfxChainFlash: "vfxChainFlash",
} as const;

/** Foundry template paths (served from the module root at runtime). */
export const TEMPLATES = {
  targetPanel: `modules/${MODULE_ID}/templates/target-panel.hbs`,
  targetPicker: `modules/${MODULE_ID}/templates/target-picker.hbs`,
  actionVfxConfig: `modules/${MODULE_ID}/templates/action-vfx-config.hbs`,
  vfxSettings: `modules/${MODULE_ID}/templates/vfx-settings.hbs`,
} as const;

/** The system this module's targeting guard hooks into. */
export const DAGGERHEART_ID = "daggerheart" as const;

/**
 * Fired by `DHBaseAction#use()` before the roll dialog, the action workflow,
 * the resource spend, and the chat card. Returning `false` aborts cleanly with
 * nothing spent. See systems/daggerheart/build/daggerheart.js:16884.
 */
export const PRE_USE_ACTION_HOOK = `${DAGGERHEART_ID}.preUseAction` as const;

/**
 * Fired at the end of `use()`, after the to-hit roll but *before* any chat-card
 * damage step (damage/apply run as separate forced workflow parts). This is the
 * point at which the acting user's live targets are no longer needed.
 */
export const POST_USE_ACTION_HOOK = `${DAGGERHEART_ID}.postUseAction` as const;

/**
 * Fired before the damage part of an action's workflow runs (order 10 roll →
 * order 20 damage), so `config.targets[].hit` is already set. Returning `false`
 * skips the inline (automation-driven) damage roll — the manual chat-card button
 * takes a different path and is handled separately.
 */
export const PRE_DAMAGE_ACTION_HOOK = `${DAGGERHEART_ID}.preDamageAction` as const;
/**
 * Fired by `executeWorkflow` (daggerheart.js:17632) once the roll part of an
 * action has finished, and *before* the damage part runs.
 *
 * This is the beat an attack should be depicted on. `postUseAction` is not: the
 * damage roll is a workflow part of the same action rather than a separate action
 * off the chat card, so `use()` does not resolve — and `postUseAction` does not
 * fire — until damage has already been rolled and applied. Hooking that put the
 * swing on top of the damage flash instead of ahead of it.
 *
 * `config.targets` carry their `hit` flags by this point, set by the RollField.
 */
export const POST_ROLL_ACTION_HOOK = `${DAGGERHEART_ID}.postRollAction` as const;


/**
 * Fired on the affected actor once damage/healing has been *dispatched* — note
 * that is not the same as applied. `modifyResource` (daggerheart.js:16133) writes
 * inside `forEach(async …)`, which discards the promises, and for a non-GM the
 * write is a fire-and-forget socket emit to the GM (daggerheart.js:12421). So the
 * actor these hooks hand you still holds its *old* resource values.
 *
 * Good enough to trigger an animation; never read a resource off it. Anything
 * that depends on the new value belongs on `UPDATE_ACTOR_HOOK` instead.
 */
export const POST_TAKE_DAMAGE_HOOK = `${DAGGERHEART_ID}.postTakeDamage` as const;
export const POST_TAKE_HEALING_HOOK = `${DAGGERHEART_ID}.postTakeHealing` as const;

/**
 * Core document hooks. `preUpdateActor` runs only on the client that initiates
 * the update — for a player attacking an adversary that is the *GM's* client —
 * while `updateActor` runs on every client once the change has landed. Options
 * set during the pre hook are replicated with the update, which is how data
 * crosses that gap (the system does the same with `scrollingTextData`).
 */
export const PRE_UPDATE_ACTOR_HOOK = "preUpdateActor" as const;
export const UPDATE_ACTOR_HOOK = "updateActor" as const;

/**
 * Our own hook, fired by the target guard when a replayed action is abandoned
 * (the roll dialog dismissed, or the replay threw) after the picker had already
 * applied targets. Passed `(action, tokenIds)` — the token ids the guard set.
 *
 * It exists so the guard stays targeting-only: the portrait integration listens
 * for this rather than the guard reaching into the portrait bridge itself.
 */
export const ACTION_ABANDONED_HOOK = `${MODULE_ID}.actionAbandoned` as const;

/** Ginzzzu's Portraits & NPC Dock — an optional enhancement, never a dependency. */
export const PORTRAITS_MODULE_ID = "ginzzzu-portraits" as const;

/** Actor flag Ginzzzu uses to track which portraits are on screen. */
export const PORTRAIT_SHOWN_FLAG = `flags.${PORTRAITS_MODULE_ID}.portraitShown` as const;

/** DOM node Ginzzzu renders per on-screen portrait, keyed by world actor id. */
export const PORTRAIT_WRAPPER_SELECTOR = ".ginzzzu-portrait-wrapper" as const;
/**
 * JB2A's animation library. Like Ginzzzu's portraits, an optional enhancement
 * and never a dependency: every video effect no-ops when this isn't installed,
 * leaving the CSS flash that has always been there.
 */
export const JB2A_MODULE_ID = "jb2a_patreon" as const;

/**
 * The single asset played over a damaged portrait, hardcoded on purpose.
 *
 * Choosing an effect per action is a resolver's job and there isn't one yet. The
 * point of one constant is to find out at the table whether a video on every hit
 * is wanted at all — and at what scale and anchor — before a mapping table gets
 * built around the answer and tuned against the wrong origin.
 */
export const VFX_DAMAGE_PATH =
  `modules/${JB2A_MODULE_ID}/Library/Generic/Impact/Impact_01_Dark_Red_400x400.webm` as const;
/**
 * The melee swing played over an attacked portrait, hardcoded for the same reason
 * `VFX_DAMAGE_PATH` is: one weapon, one asset, until a session says what the rest
 * should be. 800x600 and authored with the attacker off the left edge, so it needs
 * mirroring when the attacker's portrait sits to the right — see `playPortraitVfx`.
 */
export const VFX_DAGGER_PATH =
  `modules/${JB2A_MODULE_ID}/Library/Generic/Weapon_Attacks/Melee/Dagger02_01_Regular_White_800x600.webm` as const;



/** v14 chat render hook (passes the message document and its root element). */
export const RENDER_CHAT_MESSAGE_HOOK = "renderChatMessageHTML" as const;

/** The system's "Roll Damage" button on an attack chat card. */
export const DAMAGE_ROLL_BUTTON_SELECTOR = ".duality-action-damage" as const;

/** Our cross-client channel. Requires `"socket": true` in module.json. */
export const SOCKET_EVENT = `module.${MODULE_ID}` as const;

/** Settings submenu key for the animation options window. */
export const VFX_SETTINGS_MENU = "vfxSettings" as const;
