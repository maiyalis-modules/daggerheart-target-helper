/**
 * Per-action animation configuration.
 *
 * Edits the flag that `vfx-resolver` reads — one entry per action, keyed by the
 * action's `_id` on the owning item. Opening it against an item with several
 * actions (a Grimoire, a weapon with alternate strikes) offers a picker at the
 * top, because keeping those independently configurable is the whole reason the
 * flag is keyed by action rather than by item.
 *
 * A config is a list of steps: one action often wants more than one animation, a
 * cast on the caster and an impact on the target being the obvious case. Steps
 * either start together or wait for each other, which is what `sequence` decides.
 *
 * Reachable from the module API as well as the sheet button, so the window keeps
 * working regardless of what a Daggerheart update does to `DHActionConfig`.
 */
import { LOG_PREFIX, MODULE_ID, TEMPLATES } from "../constants.js";
import {
  clampVfxSpeed,
  pickPreviewActorId,
  pickPreviewPair,
  playPortraitVfx,
  playSpanVfx,
  probeVideoDuration,
  runVfxSequence,
  type VfxFlip,
} from "../services/portrait-fx.js";
import {
  blankActionVfx,
  blankVfxStep,
  clearStoredVfx,
  readStoredVfx,
  resolveVfxPath,
  suggestVfxKeys,
  writeStoredVfx,
  type ActionVfx,
  type VfxPlayOn,
  type VfxSequence,
  type VfxStep,
  type VfxTarget,
} from "../services/vfx-resolver.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const ON_OPTIONS: { value: VfxTarget; label: string }[] = [
  { value: "target", label: "DHTH.Vfx.On.Target" },
  { value: "caster", label: "DHTH.Vfx.On.Caster" },
  { value: "both", label: "DHTH.Vfx.On.Both" },
  { value: "spanning", label: "DHTH.Vfx.On.Spanning" },
];

const PLAY_ON_OPTIONS: { value: VfxPlayOn; label: string }[] = [
  { value: "always", label: "DHTH.Vfx.PlayOn.Always" },
  { value: "hit", label: "DHTH.Vfx.PlayOn.Hit" },
  { value: "miss", label: "DHTH.Vfx.PlayOn.Miss" },
];

const FLIP_OPTIONS: { value: VfxFlip; label: string }[] = [
  { value: "auto", label: "DHTH.Vfx.Flip.Auto" },
  { value: "never", label: "DHTH.Vfx.Flip.Never" },
  { value: "always", label: "DHTH.Vfx.Flip.Always" },
];

const SEQUENCE_OPTIONS: { value: VfxSequence; label: string }[] = [
  { value: "together", label: "DHTH.Vfx.Sequence.Together" },
  { value: "after", label: "DHTH.Vfx.Sequence.After" },
];

/** Below this a search is too broad to be worth running — see `suggestVfxKeys`. */
const MIN_QUERY = 3;

/** The Sequencer globals this window probes for, both optional. */
interface SequencerGlobal {
  DatabaseViewer?: { show?: () => void };
}

function sequencer(): SequencerGlobal | undefined {
  return (globalThis as { Sequencer?: SequencerGlobal }).Sequencer;
}

function localizeOptions<T extends string>(
  options: { value: T; label: string }[],
  current: T,
): { value: T; label: string; selected: boolean }[] {
  return options.map((option) => ({
    value: option.value,
    label: game.i18n.localize(option.label),
    selected: option.value === current,
  }));
}

export class ActionVfxConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
  private readonly item: DhItem;
  private actionId: string;
  /** Edits in progress. Nothing reaches the item until Save. */
  private draft: ActionVfx;
  /** Whether the action being edited already had a stored config when loaded. */
  private stored: boolean;
  /** Guards against an out-of-order duration probe overwriting a newer one. */
  private durationToken = 0;

  constructor(item: DhItem, actionId: string, options: AnyObject = {}) {
    super({
      ...options,
      window: {
        title: game.i18n.format("DHTH.Vfx.Title", { name: item.name ?? "" }),
        icon: "fa-solid fa-wand-sparkles",
      },
    });
    this.item = item;
    this.actionId = actionId;
    const found = readStoredVfx(item, actionId);
    this.stored = found !== null;
    this.draft = found ?? blankActionVfx();
  }

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-action-vfx-config`,
    tag: "section",
    window: {
      title: "DHTH.Vfx.Title",
      icon: "fa-solid fa-wand-sparkles",
      resizable: true,
    },
    position: {
      width: 400,
      height: "auto" as const,
    },
    classes: [MODULE_ID, "dhth-vfx-config-app"],
  };

  static PARTS = {
    main: {
      template: TEMPLATES.actionVfxConfig,
    },
  };

  /**
   * Open the window for an item, optionally on a particular action.
   *
   * Returns null (with a notification) when the item has no actions to configure
   * — a passive feature, a piece of gear — rather than opening an empty form.
   */
  static open(item: DhItem, actionId?: string): ActionVfxConfigApp | null {
    const actions = (item.system?.actionsList ?? []).filter((action) => Boolean(action?._id));
    if (actions.length === 0) {
      ui.notifications?.warn(game.i18n.localize("DHTH.Vfx.Notify.NoActions"));
      return null;
    }

    const chosen = actions.find((action) => action._id === actionId) ?? actions[0];
    if (!chosen) return null;

    const app = new ActionVfxConfigApp(item, chosen._id);
    void app.render({ force: true });
    return app;
  }

  /**
   * Actions this item offers. A weapon's `actionsList` is `[this.attack, ...]`
   * (daggerheart.js:37167) and that first entry can be missing, so anything
   * without an id is dropped rather than becoming a blank row in the picker.
   */
  private get actions(): DhAction[] {
    return (this.item.system?.actionsList ?? []).filter((action) => Boolean(action?._id));
  }

  private get action(): DhAction | undefined {
    return this.actions.find((action) => action._id === this.actionId);
  }

  /**
   * Other actions on this item that already have a config, as copy sources.
   *
   * Only configured ones: copying an action that has nothing set would silently
   * hand back defaults, which reads as the copy having failed. An item whose other
   * actions are all unconfigured therefore shows no copy control at all.
   */
  private copySources(): { id: string; name: string }[] {
    return this.actions
      .filter((action) => action._id !== this.actionId)
      .filter((action) => readStoredVfx(this.item, action._id) !== null)
      .map((action) => ({ id: action._id, name: action.name }));
  }

  async _prepareContext(_options: AnyObject): Promise<AnyObject> {
    const actions = this.actions;
    const status = this.stored ? "DHTH.Vfx.Status.Configured" : "DHTH.Vfx.Status.Unconfigured";
    const sequential = this.draft.sequence === "after";

    return {
      itemName: this.item.name ?? "",
      actionName: this.action?.name ?? "",
      hasManyActions: actions.length > 1,
      actions: actions.map((action) => ({
        id: action._id,
        name: action.name,
        selected: action._id === this.actionId,
      })),
      statusText: game.i18n.localize(status),
      draft: this.draft,
      copySources: this.copySources(),
      canCopy: this.copySources().length > 0,
      canBrowse: Boolean(sequencer()?.DatabaseViewer?.show),
      canRemoveStep: this.draft.steps.length > 1,
      hasManySteps: this.draft.steps.length > 1,
      playOnOptions: localizeOptions(PLAY_ON_OPTIONS, this.draft.playOn),
      sequenceOptions: localizeOptions(SEQUENCE_OPTIONS, this.draft.sequence),
      steps: this.draft.steps.map((step, index) => ({
        index,
        title: game.i18n.format("DHTH.Vfx.StepTitle", { number: index + 1 }),
        key: step.key,
        scale: step.placement.scale,
        anchor: step.placement.anchor,
        delayMs: step.delayMs,
        speed: step.speed,
        reach: step.reach,
        // Reach only means anything for a step drawn between two portraits, so
        // the field appears and disappears with the mode rather than sitting
        // there inert.
        isSpanning: step.on === "spanning",
        // The delay means something different once steps wait for each other, and
        // the label is the only place that difference is visible.
        delayLabel: game.i18n.localize(
          sequential && index > 0 ? "DHTH.Vfx.Field.DelayAfter" : "DHTH.Vfx.Field.Delay",
        ),
        // A negative gap means "start before the previous one ends", which only
        // means anything for a step that has a previous one to overlap with.
        delayMin: sequential && index > 0 ? -10000 : 0,
        onOptions: localizeOptions(ON_OPTIONS, step.on),
        flipOptions: localizeOptions(FLIP_OPTIONS, step.flip),
      })),
    };
  }

  /**
   * Step count the window was last sized for.
   *
   * Only a *change* in the count resizes, so a window the GM has dragged wider
   * stays that way — the resize is there to make room for a step that was just
   * added, not to keep overriding them on every repaint.
   */
  private sizedForSteps = 0;

  /** Widen for side-by-side steps, capped so it can't outgrow the screen. */
  private resizeForSteps(): void {
    const count = this.draft.steps.length;
    if (count === this.sizedForSteps) return;
    this.sizedForSteps = count;

    const width = Math.min(1120, 400 + Math.max(0, count - 1) * 300);
    this.setPosition({ width });
  }

  _onRender(context: AnyObject, options: AnyObject): void {
    super._onRender?.(context, options);

    const root = this.element as HTMLElement | undefined;

    this.resizeForSteps();
    // Before the bound-guard below: the readouts have to be recomputed on every
    // render, but the listeners are only attached once.
    void this.refreshDurations();

    // One delegated listener on the root, which survives part re-renders, rather
    // than ApplicationV2's own `actions` dispatch (unreliable here — see AGENTS.md).
    if (!root || root.dataset["dhthVfxBound"]) return;
    root.dataset["dhthVfxBound"] = "true";

    root.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLElement>("[data-dhth-vfx-action]");
      const command = button?.dataset["dhthVfxAction"];
      if (!command) return;
      event.preventDefault();
      void this.dispatch(command, this.stepIndexOf(button));
    });

    root.addEventListener("change", (event) => {
      const target = event.target as HTMLElement | null;
      const select = target?.closest<HTMLSelectElement>('[data-dhth-vfx="action"]');
      if (select) {
        this.switchAction(select.value);
        return;
      }
      // Some controls change what the form itself says — the delay label, whether
      // the sequence row is shown, whether a step offers Reach — so those repaint.
      // Read first, or the render would throw away what was just chosen.
      if (
        target?.closest('[data-dhth-vfx="sequence"]') ||
        target?.closest('[data-dhth-vfx="on"]')
      ) {
        this.readForm();
        void this.render();
      }
    });

    root.addEventListener("input", (event) => {
      const target = event.target as HTMLElement | null;
      const field = target?.closest<HTMLElement>("[data-dhth-vfx]");
      const name = field?.dataset["dhthVfx"];
      if (name === "key") {
        this.refreshSuggestions(field as HTMLInputElement);
        void this.refreshDurations();
      } else if (name === "speed") {
        void this.refreshDurations();
      }
    });
  }

  /** Which step a control belongs to, or null for the action-level ones. */
  private stepIndexOf(element: HTMLElement | null | undefined): number | null {
    const raw = element?.closest<HTMLElement>("[data-dhth-step]")?.dataset["dhthStep"];
    if (raw === undefined) return null;
    const index = Number(raw);
    return Number.isInteger(index) ? index : null;
  }

  private async dispatch(command: string, stepIndex: number | null): Promise<void> {
    try {
      if (command === "browse") {
        sequencer()?.DatabaseViewer?.show?.();
        return;
      }
      if (command === "copy") return this.copyFrom();
      if (command === "add-step") return this.addStep();
      if (command === "remove-step") return this.removeStep(stepIndex);
      if (command === "preview-step") return this.preview(stepIndex);
      if (command === "preview") return this.preview(null);
      if (command === "save") return this.save();
      if (command === "clear") return this.clear();
    } catch (error) {
      console.error(`${LOG_PREFIX} Animation config action failed.`, error);
    }
  }

  /** Populate one step's datalist from Sequencer's index as it is typed into. */
  private refreshSuggestions(input: HTMLInputElement): void {
    const list = input.list;
    if (!list) return;

    if (input.value.trim().length < MIN_QUERY) {
      list.replaceChildren();
      return;
    }

    list.replaceChildren(
      ...suggestVfxKeys(input.value).map((key) => {
        const option = document.createElement("option");
        option.value = key;
        return option;
      }),
    );
  }

  /**
   * Show how long each chosen asset will actually run at its chosen speed.
   *
   * Written straight into the DOM rather than through a re-render: it updates on
   * every keystroke in two fields per step, and re-rendering would both cost more
   * and fight the draft the same way the settings window once did.
   *
   * The token guards against out-of-order probes — typing quickly starts several,
   * and the slowest to answer is not necessarily the one still on screen.
   */
  private async refreshDurations(): Promise<void> {
    const root = this.element as HTMLElement | undefined;
    if (!root) return;

    const token = ++this.durationToken;

    for (const fieldset of root.querySelectorAll<HTMLElement>("[data-dhth-step]")) {
      const readout = fieldset.querySelector<HTMLElement>("[data-dhth-vfx-duration]");
      if (!readout) continue;

      const key = fieldset.querySelector<HTMLInputElement>('[data-dhth-vfx="key"]')?.value.trim();
      const path = key ? resolveVfxPath(key) : null;
      if (!path) {
        if (token === this.durationToken) readout.textContent = "";
        continue;
      }

      const raw = Number(fieldset.querySelector<HTMLInputElement>('[data-dhth-vfx="speed"]')?.value);
      const speed = clampVfxSpeed(raw);

      void probeVideoDuration(path).then((seconds) => {
        if (token !== this.durationToken) return;
        readout.textContent =
          seconds === null
            ? ""
            : game.i18n.format("DHTH.Vfx.Duration", {
                ms: Math.round((seconds * 1000) / speed),
              });
      });
    }
  }

  /**
   * Move to another action on the same item.
   *
   * Unsaved edits are dropped on purpose: the form is a view onto one action's
   * stored config, and carrying a half-finished draft across would make it far too
   * easy to save one action's settings onto another.
   */
  private switchAction(actionId: string): void {
    if (actionId === this.actionId) return;
    this.actionId = actionId;
    const found = readStoredVfx(this.item, actionId);
    this.stored = found !== null;
    this.draft = found ?? blankActionVfx();
    void this.render();
  }

  /** Pull the current control values into the draft. */
  private readForm(): void {
    const root = this.element as HTMLElement | undefined;
    if (!root) return;

    const field = <T extends HTMLElement>(scope: ParentNode, name: string): T | null =>
      scope.querySelector<T>(`[data-dhth-vfx="${name}"]`);

    const number = (scope: ParentNode, name: string, fallback: number): number => {
      const raw = field<HTMLInputElement>(scope, name)?.value ?? "";
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    const steps: VfxStep[] = [];
    for (const fieldset of root.querySelectorAll<HTMLElement>("[data-dhth-step]")) {
      steps.push({
        on: (field<HTMLSelectElement>(fieldset, "on")?.value ?? "target") as VfxTarget,
        key: (field<HTMLInputElement>(fieldset, "key")?.value ?? "").trim(),
        flip: (field<HTMLSelectElement>(fieldset, "flip")?.value ?? "auto") as VfxFlip,
        placement: {
          scale: number(fieldset, "scale", 1),
          anchor: number(fieldset, "anchor", 0.4),
        },
        delayMs: number(fieldset, "delayMs", 0),
        speed: number(fieldset, "speed", 1),
        reach: number(fieldset, "reach", 1),
      });
    }

    this.draft = {
      enabled: field<HTMLInputElement>(root, "enabled")?.checked ?? true,
      playOn: (field<HTMLSelectElement>(root, "playOn")?.value ?? "always") as VfxPlayOn,
      sequence: field<HTMLSelectElement>(root, "sequence")?.value === "after" ? "after" : "together",
      steps: steps.length > 0 ? steps : [blankVfxStep()],
    };
  }

  private addStep(): void {
    this.readForm();
    // A new step usually mirrors the last one's framing — same portrait size, same
    // anchor — so it starts from a copy with the asset cleared rather than from
    // defaults that would have to be dialled in again.
    const last = this.draft.steps[this.draft.steps.length - 1];
    const next: VfxStep = last
      ? { ...last, key: "", placement: { ...last.placement }, delayMs: 0 }
      : blankVfxStep();
    this.draft.steps.push(next);
    void this.render();
  }

  private removeStep(index: number | null): void {
    if (index === null) return;
    this.readForm();
    if (this.draft.steps.length <= 1) return;
    this.draft.steps.splice(index, 1);
    void this.render();
  }

  /**
   * Play the current settings on a portrait without saving anything.
   *
   * Local only, no socket. This is a tuning tool for whoever has the window open,
   * and firing it at the whole table every time someone nudges a scale would be
   * its own kind of rude.
   *
   * It ignores each step's `on` — there is only one portrait here, and no second
   * one to face — so what it faithfully shows is scale, anchor, delay, speed and
   * the order the steps come in. With no index it plays the whole sequence.
   */
  private async preview(index: number | null): Promise<void> {
    this.readForm();

    const chosen = index === null ? this.draft.steps : [this.draft.steps[index]];
    const steps = chosen.filter((step): step is VfxStep => Boolean(step?.key));
    if (steps.length === 0) {
      ui.notifications?.warn(game.i18n.localize("DHTH.Vfx.Notify.NoKey"));
      return;
    }

    const actorId = pickPreviewActorId(this.item.parent?.id ?? null);
    if (!actorId) {
      ui.notifications?.warn(game.i18n.localize("DHTH.Vfx.Notify.NoPortrait"));
      return;
    }

    // Only needed if a step spans, but resolved up front so the sequence below
    // never stops to look it up mid-flight.
    const pair = pickPreviewPair(this.item.parent?.id ?? null);

    // Resolved up front so a bad key is reported once rather than mid-sequence,
    // and so the timing below never waits on a step that is not going to play.
    const playable: { step: VfxStep; path: string }[] = [];
    for (const step of steps) {
      const path = resolveVfxPath(step.key);
      if (!path) {
        ui.notifications?.warn(game.i18n.format("DHTH.Vfx.Notify.BadKey", { key: step.key }));
        continue;
      }
      playable.push({ step, path });
    }
    if (playable.length === 0) return;

    // The same sequencer the table uses, so a preview cannot time its steps
    // differently from the real thing.
    await runVfxSequence(playable, this.draft.sequence, {
      delayOf: ({ step }) => step.delayMs,
      runtimeOf: async ({ step, path }) => {
        const seconds = await probeVideoDuration(path);
        return seconds === null ? 0 : (seconds * 1000) / clampVfxSpeed(step.speed);
      },
      start: ({ step, path }, delayMs) => {
        // A spanning step previewed on one portrait would be a 4000px strip
        // crushed into a portrait's width — worse than useless. Preview it
        // between two portraits if there are two, and say so if there aren't.
        if (step.on === "spanning") {
          if (!pair) {
            ui.notifications?.warn(game.i18n.localize("DHTH.Vfx.Notify.NoPair"));
            return Promise.resolve();
          }
          return playSpanVfx({
            ...pair,
            path,
            placement: step.placement,
            delayMs,
            speed: step.speed,
            reach: step.reach,
          });
        }

        return playPortraitVfx({
          actorId,
          path,
          placement: step.placement,
          // Nothing to mirror against in a preview, so show the asset as authored.
          flip: "never",
          delayMs,
          speed: step.speed,
        });
      },
    });
  }

  /**
   * Pull another action's settings into this form.
   *
   * Lands in the draft, not on the item — the copy is a starting point to adjust
   * (a different colour, a different anchor) and saving it is a separate,
   * deliberate act.
   */
  private copyFrom(): void {
    const root = this.element as HTMLElement | undefined;
    const select = root?.querySelector<HTMLSelectElement>('[data-dhth-vfx="copySource"]');
    const sourceId = select?.value;
    if (!sourceId) return;

    const source = readStoredVfx(this.item, sourceId);
    if (!source) {
      ui.notifications?.warn(game.i18n.localize("DHTH.Vfx.Notify.CopyFailed"));
      return;
    }

    // Deep-copied so the two actions never end up sharing a step or a placement.
    this.draft = {
      ...source,
      steps: source.steps.map((step) => ({ ...step, placement: { ...step.placement } })),
    };

    const name = this.actions.find((action) => action._id === sourceId)?.name ?? "";
    ui.notifications?.info(game.i18n.format("DHTH.Vfx.Notify.Copied", { name }));
    void this.render();
  }

  private async save(): Promise<void> {
    this.readForm();

    if (!this.draft.steps.some((step) => step.key)) {
      ui.notifications?.warn(game.i18n.localize("DHTH.Vfx.Notify.NoKey"));
      return;
    }

    await writeStoredVfx(this.item, this.actionId, this.draft);
    this.stored = true;
    ui.notifications?.info(
      game.i18n.format("DHTH.Vfx.Notify.Saved", { name: this.action?.name ?? "" }),
    );
    void this.render();
  }

  /** Remove this action's config, dropping it back to auto-recognition. */
  private async clear(): Promise<void> {
    await clearStoredVfx(this.item, this.actionId);
    this.stored = false;
    this.draft = blankActionVfx();
    ui.notifications?.info(game.i18n.localize("DHTH.Vfx.Notify.Cleared"));
    void this.render();
  }
}
