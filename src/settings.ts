/**
 * Registers the module's settings with Foundry. Must be called during the `init`
 * hook (settings cannot be registered later).
 */
import { MODULE_ID, SETTINGS, VFX_SETTINGS_MENU } from "./constants.js";
import { VfxSettingsApp } from "./ui/vfx-settings-app.js";

export function registerSettings(): void {
  game.settings.register(MODULE_ID, SETTINGS.enabled, {
    name: "DHTH.Settings.Enabled.Name",
    hint: "DHTH.Settings.Enabled.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });

  // World-scoped: the portraits are a shared, table-wide effect, so this is the
  // GM's call rather than each player's.
  game.settings.register(MODULE_ID, SETTINGS.portraitIntegration, {
    name: "DHTH.Settings.PortraitIntegration.Name",
    hint: "DHTH.Settings.PortraitIntegration.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // World-scoped for the same reason as the portraits themselves: it's a shared
  // visual the whole table sees, not a per-player preference.
  game.settings.register(MODULE_ID, SETTINGS.damageNumbers, {
    name: "DHTH.Settings.DamageNumbers.Name",
    hint: "DHTH.Settings.DamageNumbers.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.portraitLingerSeconds, {
    name: "DHTH.Settings.PortraitLinger.Name",
    hint: "DHTH.Settings.PortraitLinger.Hint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 0, max: 30, step: 1 },
    default: 2,
  });

  // World-scoped, and a direction rather than a checkbox: "which way does the art
  // look when nothing is flipped" is the one thing the DOM cannot answer, and it
  // doubles as the on/off switch. Per-actor exceptions need no setting — Ginzzzu's
  // own right-click flip already moves that actor's baseline, and the turn composes
  // with it.
  game.settings.register(MODULE_ID, SETTINGS.portraitFacing, {
    name: "DHTH.Settings.PortraitFacing.Name",
    hint: "DHTH.Settings.PortraitFacing.Hint",
    scope: "world",
    config: true,
    type: String,
    default: "right",
    choices: {
      off: "DHTH.Settings.PortraitFacing.Off",
      right: "DHTH.Settings.PortraitFacing.Right",
      left: "DHTH.Settings.PortraitFacing.Left",
    },
  });

  // Client-scoped: releasing targets affects only the acting player's own reticle,
  // so each player decides for themselves.
  game.settings.register(MODULE_ID, SETTINGS.clearTargetsAfterAction, {
    name: "DHTH.Settings.ClearTargets.Name",
    hint: "DHTH.Settings.ClearTargets.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });

  // World-scoped: whether a miss suppresses the damage prompt is a table rule,
  // and the chat card is shared, so keep it consistent for everyone.
  game.settings.register(MODULE_ID, SETTINGS.missFeedback, {
    name: "DHTH.Settings.MissFeedback.Name",
    hint: "DHTH.Settings.MissFeedback.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // --- Action animations -----------------------------------------------------
  // All world-scoped: the animations are a shared, table-wide effect. Hidden from
  // the main settings tab (`config: false`) and edited through the submenu below,
  // which keeps a growing animation section from crowding the targeting options.

  game.settings.register(MODULE_ID, SETTINGS.vfxEnabled, {
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.vfxTiming, {
    scope: "world",
    config: false,
    type: String,
    default: "roll",
    choices: {
      roll: "DHTH.Settings.Vfx.Timing.Roll",
      action: "DHTH.Settings.Vfx.Timing.Action",
    },
  });

  game.settings.register(MODULE_ID, SETTINGS.vfxChainFlash, {
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });

  game.settings.registerMenu(MODULE_ID, VFX_SETTINGS_MENU, {
    name: "DHTH.Settings.Vfx.Menu.Name",
    label: "DHTH.Settings.Vfx.Menu.Label",
    hint: "DHTH.Settings.Vfx.Menu.Hint",
    icon: "fa-solid fa-wand-sparkles",
    type: VfxSettingsApp,
    restricted: true,
  });
}
