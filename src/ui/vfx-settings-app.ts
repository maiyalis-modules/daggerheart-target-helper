/**
 * The animation options window, reached from the settings tab.
 *
 * These three live in their own window rather than on the main settings sheet
 * because they only make sense read together — the timing choice is what decides
 * whether chaining the flash is meaningful at all — and because the animation
 * section is the one most likely to keep growing.
 *
 * World-scoped and GM-only (`restricted: true` on the menu): the animations are a
 * shared effect the whole table sees, not a per-player preference.
 */
import { LOG_PREFIX, MODULE_ID, SETTINGS, TEMPLATES } from "../constants.js";
import { vfxChainFlash, vfxEnabled, vfxTiming, type VfxTiming } from "../services/vfx-settings.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TIMING_OPTIONS: { value: VfxTiming; label: string }[] = [
  { value: "roll", label: "DHTH.Settings.Vfx.Timing.Roll" },
  { value: "action", label: "DHTH.Settings.Vfx.Timing.Action" },
];

interface VfxSettingsDraft {
  enabled: boolean;
  timing: VfxTiming;
  chainFlash: boolean;
}

export class VfxSettingsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * Unsaved edits.
   *
   * The window re-renders on every change so the mismatch warning can appear as
   * the combination is chosen. Rendering from the *stored* settings instead would
   * repaint each control back to its saved value the instant it was touched — a
   * checkbox that refuses to stay checked. Everything on screen therefore comes
   * from here, and the stored settings are read exactly once to seed it.
   */
  private draft: VfxSettingsDraft | null = null;

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-vfx-settings`,
    tag: "section",
    window: {
      title: "DHTH.Settings.Vfx.Menu.Name",
      icon: "fa-solid fa-wand-sparkles",
      resizable: false,
    },
    position: {
      width: 460,
      height: "auto" as const,
    },
    classes: [MODULE_ID, "dhth-vfx-settings-app"],
  };

  static PARTS = {
    main: {
      template: TEMPLATES.vfxSettings,
    },
  };

  /** The draft, seeded from the stored settings on first use. */
  private get current(): VfxSettingsDraft {
    this.draft ??= {
      enabled: vfxEnabled(),
      timing: vfxTiming(),
      chainFlash: vfxChainFlash(),
    };
    return this.draft;
  }

  async _prepareContext(_options: AnyObject): Promise<AnyObject> {
    const draft = this.current;

    return {
      enabled: draft.enabled,
      chainFlash: draft.chainFlash,
      timingOptions: TIMING_OPTIONS.map((option) => ({
        value: option.value,
        label: game.i18n.localize(option.label),
        selected: option.value === draft.timing,
      })),
      // Chaining with roll-timed animations is not wrong, just inert: the
      // animation has long finished by the time damage lands, so the flash is
      // never actually held. Worth saying rather than letting it look broken.
      chainWithoutAction: draft.chainFlash && draft.timing !== "action",
    };
  }

  _onRender(context: AnyObject, options: AnyObject): void {
    super._onRender?.(context, options);

    const root = this.element as HTMLElement | undefined;
    // Delegated rather than ApplicationV2's `actions` dispatch — see AGENTS.md.
    if (!root || root.dataset["dhthVfxsBound"]) return;
    root.dataset["dhthVfxsBound"] = "true";

    root.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest("[data-dhth-vfxs-action='save']")) return;
      event.preventDefault();
      void this.save();
    });

    root.addEventListener("change", (event) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest("[data-dhth-vfxs]")) return;
      // Capture what the user just did before repainting, or the render would
      // undo it — see `draft`.
      this.readForm();
      void this.render();
    });
  }

  /** Pull the current control values into the draft. */
  private readForm(): void {
    const root = this.element as HTMLElement | undefined;
    if (!root) return;

    const field = <T extends HTMLElement>(name: string): T | null =>
      root.querySelector<T>(`[data-dhth-vfxs="${name}"]`);

    this.draft = {
      enabled: field<HTMLInputElement>("enabled")?.checked ?? true,
      timing: field<HTMLSelectElement>("timing")?.value === "action" ? "action" : "roll",
      chainFlash: field<HTMLInputElement>("chainFlash")?.checked ?? false,
    };
  }

  private async save(): Promise<void> {
    try {
      this.readForm();
      const draft = this.current;

      await game.settings.set(MODULE_ID, SETTINGS.vfxEnabled, draft.enabled);
      await game.settings.set(MODULE_ID, SETTINGS.vfxTiming, draft.timing);
      await game.settings.set(MODULE_ID, SETTINGS.vfxChainFlash, draft.chainFlash);

      ui.notifications?.info(game.i18n.localize("DHTH.Settings.Vfx.Notify.Saved"));
      void this.close();
    } catch (error) {
      console.error(`${LOG_PREFIX} Could not save the animation options.`, error);
    }
  }
}
