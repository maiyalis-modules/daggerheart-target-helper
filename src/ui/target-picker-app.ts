import { MODULE_ID, TEMPLATES } from "../constants.js";
import type { TargetCandidate, TargetGroup } from "../targeting/candidates.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Section order, and the lang key for each heading.
 *
 * Enemies lead because they're what most targeted actions are aimed at, and
 * allies come last on purpose: for an `any`-target action the picker is the last
 * thing between a player and damaging their own party, so the friendly rows
 * shouldn't sit under the cursor.
 */
const GROUP_ORDER: { key: TargetGroup; label: string }[] = [
  { key: "enemy", label: "DHTH.Picker.Group.Enemies" },
  { key: "neutral", label: "DHTH.Picker.Group.Neutral" },
  { key: "ally", label: "DHTH.Picker.Group.Allies" },
];

export interface TargetPickerOptions {
  /** Max selectable targets. `Infinity` when the action declares no limit. */
  max: number;
  /** Window title — usually the action's own title. */
  title: string;
}

/**
 * The picker's outcome:
 * - `string[]` — the chosen token ids.
 * - `"none"`   — proceed with the action untargeted (terrain, an object, …).
 * - `null`     — the player backed out; abandon the action.
 */
export type TargetPickerResult = string[] | "none" | null;

/**
 * Target picker shown when a targeted action is used with nothing targeted.
 *
 * Resolves to the chosen token ids, or `null` if the player backed out — the
 * caller treats `null` as "abandon the action", so cancelling must never leave
 * a half-applied state.
 */
export class TargetPickerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  private readonly targets: TargetCandidate[];
  private readonly max: number;
  private readonly selected = new Set<string>();
  private resolver: ((result: TargetPickerResult) => void) | null;
  private settled = false;

  constructor(
    targets: TargetCandidate[],
    pickerOptions: TargetPickerOptions,
    resolver: (result: TargetPickerResult) => void,
    options: AnyObject = {},
  ) {
    super({
      ...options,
      window: {
        title: pickerOptions.title,
        icon: "fa-solid fa-crosshairs",
      },
    });
    this.targets = targets;
    this.max = pickerOptions.max;
    this.resolver = resolver;
  }

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-target-picker`,
    tag: "section",
    window: {
      title: "DHTH.Picker.Title",
      icon: "fa-solid fa-crosshairs",
      resizable: false,
    },
    position: {
      width: 420,
      height: "auto",
    },
    classes: [MODULE_ID, "totm-target-picker"],
  };

  static PARTS = {
    main: {
      template: TEMPLATES.targetPicker,
    },
  };

  /**
   * Show the picker and await the player's choice.
   *
   * @returns The chosen token ids, or `null` if cancelled or dismissed.
   */
  static async prompt(
    targets: TargetCandidate[],
    pickerOptions: TargetPickerOptions,
  ): Promise<TargetPickerResult> {
    return new Promise<TargetPickerResult>((resolve) => {
      const app = new TargetPickerApp(targets, pickerOptions, resolve);
      void app.render({ force: true });
    });
  }

  /** Resolve the pending promise exactly once. */
  private settle(result: TargetPickerResult): void {
    if (this.settled) return;
    this.settled = true;
    const resolve = this.resolver;
    this.resolver = null;
    resolve?.(result);
  }

  /** A dismissed window (Escape, close button) counts as a cancel. */
  async close(options: AnyObject = {}): Promise<unknown> {
    this.settle(null);
    return super.close(options);
  }

  _onRender(context: AnyObject, options: AnyObject): void {
    super._onRender?.(context, options);
    const root = this.element as HTMLElement | undefined;
    // The delegated listener lives on the root, which survives part re-renders,
    // so bind it once. (ApplicationV2's built-in `actions` dispatch is unreliable
    // in this Foundry build — see CLAUDE.md.)
    if (!root || root.dataset["dhthBound"]) return;
    root.dataset["dhthBound"] = "1";

    root.addEventListener("click", (event: Event) => {
      const el = (event.target as HTMLElement | null)?.closest?.(
        "[data-dhth]",
      ) as HTMLElement | null;
      if (!el || !root.contains(el)) return;

      switch (el.dataset["dhth"]) {
        case "pick":
          this.onPick(el.dataset["tokenId"]);
          break;
        case "no-target":
          this.settle("none");
          void this.close();
          break;
        case "confirm":
          this.onConfirm();
          break;
        case "cancel":
          void this.close();
          break;
      }
    });
  }

  private onPick(tokenId: string | undefined): void {
    if (!tokenId) return;

    // Single-target actions are the common case: one click picks and commits.
    if (this.max <= 1) {
      this.settle([tokenId]);
      void this.close();
      return;
    }

    if (this.selected.has(tokenId)) this.selected.delete(tokenId);
    else if (this.selected.size < this.max) this.selected.add(tokenId);

    void this.render();
  }

  private onConfirm(): void {
    if (this.selected.size === 0) return;
    this.settle(Array.from(this.selected));
    void this.close();
  }

  async _prepareContext(_options: AnyObject): Promise<AnyObject> {
    const multi = this.max > 1;
    const capped = Number.isFinite(this.max);
    const atCap = multi && this.selected.size >= this.max;

    // Handlebars here has no `eq` helper and no `{{else if}}`, so every branch
    // the template needs is precomputed into a boolean (see CLAUDE.md). That
    // includes the sections: the grouping is done here, and the template just
    // walks whatever it's handed.
    const rows = this.targets.map((target) => ({
      ...target,
      selected: this.selected.has(target.id),
      disabled: atCap && !this.selected.has(target.id),
      hasDifficulty: target.difficulty !== null && target.difficulty !== undefined,
      hasEvasion: target.evasion !== null && target.evasion !== undefined,
      isDefeated: target.defeated !== null,
      defeatedLabel: target.defeated?.name ?? "",
      hasConditions: target.conditions.length > 0,
    }));

    // Empty sections are dropped rather than rendered as headings with nothing
    // under them — most actions are disposition-filtered and yield exactly one.
    const groups = GROUP_ORDER.map((group) => ({
      key: group.key,
      label: game.i18n.localize(group.label),
      targets: rows.filter((row) => row.group === group.key),
    })).filter((group) => group.targets.length > 0);

    return {
      groups,
      multi,
      canConfirm: this.selected.size > 0,
      countLabel: capped
        ? game.i18n.format("DHTH.Picker.SelectedCapped", {
            count: this.selected.size,
            max: this.max,
          })
        : game.i18n.format("DHTH.Picker.Selected", { count: this.selected.size }),
      hint: multi
        ? game.i18n.localize("DHTH.Picker.HintMulti")
        : game.i18n.localize("DHTH.Picker.HintSingle"),
    };
  }
}
