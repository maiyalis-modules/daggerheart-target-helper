/**
 * Adds an **Animation** button to the system's action configuration sheet, so a
 * per-action animation is set up where the action is already being edited rather
 * than through a macro.
 *
 * Deliberately the last piece of the animation UI to be built, and deliberately
 * the thinnest. Everything it does is open `ActionVfxConfigApp`, which works
 * perfectly well on its own through `api.openActionVfxConfig` — so if a
 * Daggerheart update reshapes `DHActionConfig`, the button stops appearing and
 * nothing else about the feature breaks.
 */
import { LOG_PREFIX } from "../constants.js";
import { ActionVfxConfigApp } from "./action-vfx-config-app.js";

/**
 * `DHActionConfig` extends `DHActionBaseConfig` (daggerheart.js:13610), and which
 * of the two names a render hook arrives under depends on how far up the chain
 * this Foundry build walks. Listening for both costs nothing — the button is
 * inserted at most once per render either way.
 */
const RENDER_HOOKS = ["renderDHActionConfig", "renderDHActionBaseConfig"] as const;

const BUTTON_CLASS = "dhth-vfx-sheet-button";

/**
 * The separator lives on a wrapper, not on the button. Border and padding on the
 * button itself are painted as part of it, making its box taller at the top than
 * the bottom and leaving the label sitting off-centre.
 */
const FOOTER_CLASS = "dhth-vfx-sheet-footer";

export function registerActionSheetButton(): void {
  for (const hook of RENDER_HOOKS) Hooks.on(hook, onRenderActionConfig);
  for (const hook of ITEM_RENDER_HOOKS) Hooks.on(hook, onRenderItemSheet);
}

/** The sheet's root element, however this build hands it over. */
function rootOf(element: unknown): HTMLElement | null {
  if (element instanceof HTMLElement) return element;
  // Tolerate a jQuery-wrapped element, which older render hooks pass.
  const first = (element as { 0?: unknown } | null)?.[0];
  return first instanceof HTMLElement ? first : null;
}

/**
 * Item sheets that can carry actions worth animating.
 *
 * A weapon's attack is not in its Actions tab — `actionsList` on a weapon is
 * `[this.attack, ...actions]` (daggerheart.js:37167), and the attack has no row of
 * its own to open a config sheet from. So the *item* needs an entry point too, or
 * the most common thing anyone would want to animate is unreachable.
 *
 * `renderDHBaseItemSheet` is listed first in case this build fires hooks up the
 * inheritance chain; the concrete names cover it if not. Duplicate insertion is
 * guarded either way.
 */
const ITEM_RENDER_HOOKS = [
  "renderDHBaseItemSheet",
  "renderWeaponSheet",
  "renderArmorSheet",
  "renderDomainCardSheet",
  "renderFeatureSheet",
  "renderConsumableSheet",
  "renderClassSheet",
  "renderSubclassSheet",
  "renderAncestrySheet",
  "renderCommunitySheet",
  "renderBeastformSheet",
  "renderLootSheet",
] as const;

/** Actions worth offering. Weapon `actionsList` can hold a hole where an
 * unconfigured attack would be, so anything without an id is dropped. */
function configurableActions(item: DhItem | null | undefined): DhAction[] {
  return (item?.system?.actionsList ?? []).filter((action) => Boolean(action?._id));
}

function onRenderItemSheet(app: unknown, element: unknown): void {
  try {
    const root = rootOf(element);
    if (!root) return;
    if (root.querySelector("." + FOOTER_CLASS)) return;

    const sheet = app as { document?: DhItem; item?: DhItem } | null;
    const item = sheet?.document ?? sheet?.item;
    if (!item) return;

    if (configurableActions(item).length === 0) return;
    if (item.isOwner !== true && game.user?.isGM !== true) return;

    root.querySelector(".window-content")?.appendChild(buildButton(item, undefined, true));
  } catch (error) {
    console.warn(`${LOG_PREFIX} Could not add the animation button to the item sheet.`, error);
  }
}

/** The button itself, shared by both entry points. */
function buildButton(item: DhItem, actionId?: string, inset = false): HTMLElement {
  const footer = document.createElement("div");
  // Item sheets run their content to the window edge, so the button needs its own
  // side margin there. Action config sheets already pad their content, and adding
  // it again would inset the button twice.
  footer.className = inset ? `${FOOTER_CLASS} ${FOOTER_CLASS}--inset` : FOOTER_CLASS;

  const button = document.createElement("button");
  button.type = "button";
  button.className = BUTTON_CLASS;

  const icon = document.createElement("i");
  icon.className = "fa-solid fa-wand-sparkles";
  button.append(icon, document.createTextNode(game.i18n.localize("DHTH.Vfx.SheetButton")));

  button.addEventListener("click", (event) => {
    event.preventDefault();
    ActionVfxConfigApp.open(item, actionId);
  });

  footer.appendChild(button);
  return footer;
}

function onRenderActionConfig(app: unknown, element: unknown): void {
  try {
    const root = rootOf(element);
    if (!root) return;

    // Both hooks may fire for one render, and a sheet re-renders in place.
    if (root.querySelector('.' + FOOTER_CLASS)) return;

    const action = (app as { action?: DhAction | null } | null)?.action;
    const item = action?.item;
    if (!action?._id || !item) return;

    // Configuring an animation writes an item flag, so it needs the same
    // permission editing the item does. GMs own everything, so this covers them.
    if (item.isOwner !== true && game.user?.isGM !== true) return;

    // Appended to the window content rather than woven into the system's form:
    // nothing of ours ends up inside their field layout, so their own submit and
    // re-render machinery never has to know about it.
    const anchor = root.querySelector(".window-content") ?? root;
    anchor.appendChild(buildButton(item, action._id));
  } catch (error) {
    // Cosmetic, and on someone else's sheet — never let it break their window.
    console.warn(`${LOG_PREFIX} Could not add the animation button to the action sheet.`, error);
  }
}
