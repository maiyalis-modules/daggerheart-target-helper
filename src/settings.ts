/**
 * Registers the module's settings with Foundry. Must be called during the `init`
 * hook (settings cannot be registered later).
 */
import { MODULE_ID, SETTINGS } from "./constants.js";

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
}
