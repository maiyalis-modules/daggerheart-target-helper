import { MODULE_ID, TEMPLATES } from "../constants.js";
import type { TargetCandidate, TargetGroup } from "../targeting/candidates.js";
import { surveyCandidates } from "../targeting/candidates.js";
import { formatDistance } from "../targeting/range.js";
import { bandColorChannels } from "./range-colors.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Section order, and the lang key for each heading.
 *
 * Ordered by how much damage a misclick does. Enemies lead because they're what
 * most targeted actions are aimed at; allies come after them on purpose, since
 * for an `any`-target action the picker is the last thing between a player and
 * damaging their own party. Yourself is last by the same reasoning taken one
 * step further — it's the pick you least want to make by accident, and the one
 * you'll only be making on purpose.
 */
const GROUP_ORDER: { key: TargetGroup; label: string }[] = [
  { key: "enemy", label: "DHTH.Picker.Group.Enemies" },
  { key: "neutral", label: "DHTH.Picker.Group.Neutral" },
  { key: "ally", label: "DHTH.Picker.Group.Allies" },
  { key: "self", label: "DHTH.Picker.Group.Self" },
];

export interface TargetPickerOptions {
  /** Max selectable targets. `Infinity` when the action declares no limit. */
  max: number;
  /** Window title — usually the action's own title. */
  title: string;
  /**
   * Id of the token being measured *from* when this is a **range survey**: a
   * read-only view of the scene opened on demand, picking nothing. Its presence
   * is what puts the window in that mode. Kept as an id rather than the token so
   * a token deleted while the window is open resolves to nothing and closes it,
   * rather than leaving a stale placeable behind.
   */
  surveySourceId?: string;
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
  private targets: TargetCandidate[];
  private readonly max: number;
  private readonly selected = new Set<string>();
  private resolver: ((result: TargetPickerResult) => void) | null;
  private settled = false;
  /**
   * The survey window currently on screen, if any. There is at most one — see
   * {@link TargetPickerApp.survey}.
   */
  private static openSurvey: TargetPickerApp | null = null;

  /** Set only in survey mode — see {@link TargetPickerOptions.surveySourceId}. */
  private readonly surveySourceId: string | null;
  /** Live-refresh hook registrations, held so `close` can take them back off. */
  private surveyHooks: { hook: string; id: number }[] = [];

  constructor(
    targets: TargetCandidate[],
    pickerOptions: TargetPickerOptions,
    resolver: ((result: TargetPickerResult) => void) | null,
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
    this.surveySourceId = pickerOptions.surveySourceId ?? null;
  }

  /** Whether this window is a read-only range survey rather than a picker. */
  private get isSurvey(): boolean {
    return this.surveySourceId !== null;
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

  /**
   * Open the same list as a **range survey**: what's on the scene, how far from
   * `source`, and nothing else. Picks nothing, targets nothing, resolves nothing
   * — the caller gets the window rather than a promise, because there is no
   * outcome to wait for.
   *
   * Its own window id, so a survey and a live targeting prompt can be open at
   * the same time without one replacing the other. Only ever *one* survey
   * though: two ApplicationV2 instances sharing an id fight over
   * `foundry.applications.instances`, and the second would strand the first as
   * an orphan nothing can close. Opening a survey for another token therefore
   * replaces the one on screen, which is also how it reads — this is a window
   * you point at something.
   */
  static survey(source: Token): TargetPickerApp {
    void TargetPickerApp.openSurvey?.close();

    const app = new TargetPickerApp(
      surveyCandidates(source),
      {
        max: 0,
        title: game.i18n.format("DHTH.Survey.Title", { name: source.name }),
        surveySourceId: source.id,
      },
      null,
      { id: `${MODULE_ID}-range-survey` },
    );
    TargetPickerApp.openSurvey = app;
    void app.render({ force: true });
    return app;
  }

  /**
   * Re-measure and repaint. Survey only: a distance display that silently goes
   * stale as the GM moves things is worse than no distance display, and a token
   * moving is exactly when someone has this window open.
   *
   * Closes itself if the token it measures from has left the scene — every
   * distance in the list would otherwise be from nowhere.
   */
  private refreshSurvey(): void {
    if (!this.surveySourceId) return;

    const source = canvas.tokens?.get(this.surveySourceId) ?? null;
    if (!source) {
      void this.close();
      return;
    }

    this.targets = surveyCandidates(source);
    void this.render();
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
    for (const { hook, id } of this.surveyHooks) Hooks.off(hook, id);
    this.surveyHooks = [];
    // Only clear the slot if it's still ours: `survey()` closes the outgoing
    // window *before* claiming it, so a blind clear would wipe the incoming one.
    if (TargetPickerApp.openSurvey === this) TargetPickerApp.openSurvey = null;
    this.settle(null);
    return super.close(options);
  }

  /**
   * Keep a survey in step with the canvas. Bound once, on first render, and
   * dropped in {@link close}.
   *
   * `updateToken` fires continuously through a drag, so the repaint is debounced
   * — and it isn't filtered to position changes, because elevation, size and a
   * rename all change what a row says too.
   */
  private bindSurveyRefresh(): void {
    if (!this.isSurvey || this.surveyHooks.length > 0) return;

    const refresh = foundry.utils.debounce(() => this.refreshSurvey(), 100) as () => void;
    for (const hook of ["updateToken", "createToken", "deleteToken"]) {
      this.surveyHooks.push({ hook, id: Hooks.on(hook, refresh) });
    }
  }

  _onRender(context: AnyObject, options: AnyObject): void {
    super._onRender?.(context, options);
    this.bindSurveyRefresh();
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
    if (!tokenId || this.isSurvey) return;

    // Belt and braces: the button already carries `disabled`, but a target out
    // of the action's range must never be selectable, full stop.
    const target = this.targets.find((candidate) => candidate.id === tokenId);
    if (!target || !target.inRange) return;

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
    const survey = this.isSurvey;
    const multi = !survey && this.max > 1;
    const capped = Number.isFinite(this.max);
    const atCap = multi && this.selected.size >= this.max;

    // Handlebars here has no `eq` helper and no `{{else if}}`, so every branch
    // the template needs is precomputed into a boolean (see CLAUDE.md). That
    // includes the sections: the grouping is done here, and the template just
    // walks whatever it's handed.
    const rows = this.targets.map((target) => {
      // Most worlds run the system's range variant rule, which prints band names
      // rather than feet — so this is usually "Close", not "30 ft". Null the
      // whole way through when the actor has no token to measure from, which is
      // routine in Theatre of the Mind play; the chip is simply left out.
      const rangeLabel = formatDistance(target.distance, target.band);
      const rangeChannels = bandColorChannels(target.band);

      return {
        ...target,
        selected: !survey && this.selected.has(target.id),
        // Out of range always wins: capping never re-enables a target the
        // action simply can't reach.
        disabled: !survey && ((atCap && !this.selected.has(target.id)) || !target.inRange),
        outOfRange: !survey && !target.inRange,
        // Blank in survey mode, which leaves `data-dhth=""` on the row: the
        // delegated listener still matches it and falls through to no case, so
        // the row is inert without being `disabled` (which would grey the whole
        // list out — see `.totm-target-btn:disabled`).
        rowAction: survey ? "" : "pick",
        // Per row rather than read off `@root` in the template: the flag is
        // consumed inside two nested `{{#each}}` blocks, and keeping it on the
        // row means the markup never depends on how those blocks scope.
        rowStatic: survey,
        hasRange: rangeLabel !== null,
        rangeLabel: rangeLabel ?? "",
        // The band's own name, so the colour is decodable even when the label
        // is a bare number — and so it's readable at all for anyone who can't
        // separate the palette's hues.
        rangeTitle: target.band
          ? game.i18n.localize(`DAGGERHEART.CONFIG.Range.${target.band}.name`)
          : "",
        // The whole declaration, not just the channels: an empty custom property
        // (`--x: ;`) is *declared*, so `var(--x, fallback)` would skip its
        // fallback and compute to nothing. Emitting an empty `style` instead
        // leaves the property undeclared, which is what the neutral default in
        // the stylesheet relies on.
        rangeStyle: rangeChannels ? `--dhth-range-rgb: ${rangeChannels}` : "",
        hasDifficulty: target.difficulty !== null && target.difficulty !== undefined,
        hasEvasion: target.evasion !== null && target.evasion !== undefined,
        isDefeated: target.defeated !== null,
        defeatedLabel: target.defeated?.name ?? "",
        hasConditions: target.conditions.length > 0,
      };
    });

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
      // Both are the picker's business: a survey commits nothing, so it offers
      // neither "Attack Without a Target" nor a Confirm — only a way out.
      canPick: !survey,
      dismissLabel: survey
        ? game.i18n.localize("DHTH.Survey.Close")
        : game.i18n.localize("DHTH.Picker.Cancel"),
      canConfirm: this.selected.size > 0,
      countLabel: capped
        ? game.i18n.format("DHTH.Picker.SelectedCapped", {
            count: this.selected.size,
            max: this.max,
          })
        : game.i18n.format("DHTH.Picker.Selected", { count: this.selected.size }),
      hint: survey
        ? game.i18n.localize("DHTH.Survey.Hint")
        : multi
          ? game.i18n.localize("DHTH.Picker.HintMulti")
          : game.i18n.localize("DHTH.Picker.HintSingle"),
    };
  }
}
