/**
 * Maiyalis: Target Helper — module entry point.
 *
 * Wires the module into FoundryVTT's lifecycle hooks. Business logic lives in
 * sibling modules under `src/`; this file only bootstraps.
 */
import { registerApi } from "./api.js";
import { registerActionSheetButton } from "./ui/action-sheet-button.js";
import { LOG_PREFIX, TEMPLATES } from "./constants.js";
import { registerSettings } from "./settings.js";
import { registerActionPortraits } from "./targeting/action-portraits.js";
import { registerMissFeedback } from "./targeting/miss-feedback.js";
import { registerResourceFeedback } from "./targeting/resource-feedback.js";
import { registerTargetGuard } from "./targeting/target-guard.js";

Hooks.once("init", async () => {
  console.log(`${LOG_PREFIX} Initializing.`);
  registerSettings();
  // Order matters: `Hooks.call` stops at the first handler returning `false`, so
  // the guard must run first — an action it cancels never reaches the portraits.
  registerTargetGuard();
  registerActionPortraits();
  registerMissFeedback();
  registerResourceFeedback();
  registerActionSheetButton();
  // Published during init so a module whose own init runs later still sees it.
  registerApi();
  await foundry.applications.handlebars.loadTemplates(Object.values(TEMPLATES));
});

Hooks.once("ready", () => {
  console.log(`${LOG_PREFIX} Ready (system: ${game.system.id} v${game.system.version}).`);
});
