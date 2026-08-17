# Maiyalis: Target Helper — Agent guide

> This is the canonical instruction file for all coding agents. Update this
> file when shared guidance changes. `CLAUDE.md` imports it for Claude Code;
> Codex reads `AGENTS.md` directly. Do not duplicate shared instructions in
> agent-specific files.

A FoundryVTT **v14** module for the **Daggerheart** system. Written in TypeScript,
compiled to `dist/module.js` (what `module.json` loads). It guards targeted
actions (`src/targeting/`), showing a picker (`src/ui/target-picker-app.ts`) when
one is used with nothing targeted, and layers on optional feedback — Ginzzzu
portraits, miss flashes, floating resource numbers (`src/services/`).

## Build — read this first

**Node.js is NOT installed on the host, and Python isn't either.** The build runs
in Docker. Do not run `npm` / `node` / `tsc` / `vite` directly on the host — they
won't exist.

```
docker compose run --rm build     # one-off type-check + build (tsc --noEmit && vite build)
docker compose up watch           # rebuild dist/module.js on every save
```

- First run installs deps into a **named Docker volume** (`dth-node-modules`), not
  the host — Vite ships platform-specific binaries that a Windows `node_modules`
  can't run in the Linux container. `package-lock.json` still persists to the host.
- The host `node_modules/` folder is an empty mount-point artifact; ignore it.
- **Never add a `restart:` policy** to `docker-compose.yml` (keep `restart: "no"`).
  These are manual, developer-invoked containers. Don't change Docker Desktop settings.
- To validate JSON without Node, use PowerShell: `Get-Content -Raw file.json | ConvertFrom-Json`.

### Hot reload

While a world runs, Foundry live-applies (no refresh): `styles/module.css`,
`templates/*.hbs`, `lang/*.json`. **JavaScript is not hot-swapped** — after `watch`
rebuilds `dist/module.js`, **press F5** in the browser.

## Layout

```
src/
  module.ts            entry point — Hooks.once("init"|"ready")
  constants.ts         MODULE_ID, MODULE_TITLE, LOG_PREFIX, SETTINGS, TEMPLATES, hook names
  settings.ts          game.settings registration (called from init)
  targeting/           the guard, candidate list, range measurement, hit/miss feedback
  ui/                  the picker window and its presentation helpers
  services/            cross-cutting helpers (portrait bridge, sockets, actor state)
  types/               minimal ambient shims — foundry.d.ts and daggerheart.d.ts
dist/module.js         build output (git-ignored)
module.json            manifest — esmodules -> dist/module.js
styles/ templates/ lang/ packs/   served from the repo root as-is
```

## Conventions

- **One id, one title.** `MODULE_ID = "daggerheart-target-helper"` and
  `MODULE_TITLE` live in `constants.ts`. `LOG_PREFIX` derives from the title;
  log with `` console.log(`${LOG_PREFIX} …`) ``.
- **Settings**: add a key to `SETTINGS` in `constants.ts`, register it in
  `settings.ts`, which is called during the `init` hook (settings can't be
  registered later).
- **Templates**: add the path to `TEMPLATES` in `constants.ts`; they're preloaded
  via `loadTemplates(Object.values(TEMPLATES))` in `init`.
- **Types**: there's no full Foundry type package — `src/types/foundry.d.ts` is a
  deliberately minimal shim. When you touch a new Foundry global, **add it to the
  shim** rather than reaching for `any` everywhere. (Swap in `fvtt-types` later if
  the surface grows large.)
- **Localization**: every user-facing string lives in `lang/en.json` under the
  `DHTH.` prefix — `game.i18n.localize("DHTH.…")` in TS, `{{localize "DHTH.…"}}`
  in templates. Don't hardcode display strings.

## The range survey (read-only mode)

`TargetPickerApp` has a second mode: a **survey**, opened on demand rather than
by an action, that lists everything on the scene with its distance from one token
and picks nothing. `TargetPickerOptions.surveySourceId` is what puts it in that
mode, and `TargetPickerApp.survey(token)` is the entry point.

- **Same rows, different verbs.** `surveyCandidates(token)` calls the same
  `buildCandidates` the guard does, passing no `targetType` and no `range` — so
  nothing is filtered by disposition and nothing is greyed as out of reach, but
  the grouping and the distance chips are identical.
- Rows are inert because they carry an **empty `data-dhth`**, not because they're
  `disabled` — `disabled` greys the whole list out (`.totm-target-btn:disabled`),
  and reading the list is the entire point. Backed up by `onPick` refusing in
  survey mode and by `aria-disabled="true"` + `tabindex="-1"` on the row, with
  `.totm-target-btn--static` removing the hover/press affordances so it doesn't
  *look* clickable either.
- The `--static` flag is passed **per row** (`rowStatic`), not read off `@root`
  in the template. It's consumed inside two nested `{{#each}}` blocks, and the
  markup shouldn't depend on how those scope.
- **At most one survey exists.** Two ApplicationV2 instances sharing a window id
  fight over `foundry.applications.instances`, and the second strands the first
  as an orphan nothing can close — so `survey()` closes the outgoing window
  before claiming the slot, and `close()` only clears the slot when it's still
  its own.
- It **re-measures on `updateToken`/`createToken`/`deleteToken`** (debounced;
  `updateToken` fires continuously through a drag). A distance readout that goes
  stale while the GM moves things is worse than none, and the hooks are dropped
  in `close`. If the token it measures *from* leaves the scene the window closes
  itself — every distance in it would be from nowhere.

`src/api.ts` publishes `openRangeSurvey` on
`game.modules.get("daggerheart-target-helper").api` during `init`. Its only
consumer today is the **Tokens on Scene** bar in `eryndor-essentials`
(`src/integrations/target-helper-survey.ts` there), which draws its crosshair
button only when the API answers. Keep the shape stable — changing it means
editing that module too.

## Row state in the picker (CSS)

Rows are `<button>`s inside a scroll container, and **core Foundry's own button
styling is the thing to reason about first** — `foundry2.css` styles bare
`button` and `button:focus`, and `button:focus` at specificity (0,1,1) outranks
every single-class rule in this module.

Two bugs came out of that pair, and both looked like ours:

- **A clicked row grew a bright bar across its top and bottom that stopped dead
  at the left and right edges.** Core's `button:focus` sets `outline: 1px solid`
  *and* `box-shadow: 0 0 4px`, both drawn outside the row —
  and `.totm-target-dialog__list` sets `overflow-y: auto`, which forces
  `overflow-x` to `auto` as well, clipping them horizontally. It fired on plain
  mouse clicks, so it read as a selection highlight that didn't join up.
- **The focused row lost its group stripe**, because core's `box-shadow`
  replaced ours wholesale.

Fixed by overriding `.totm-target-btn:focus` to `outline: none` and re-declaring
our own shadows there, with the focus ring drawn **inset** so there is nothing
outside the element to clip, and only on `:focus-visible` so a mouse click no
longer decorates a row at all.

A row composes two inset shadows through custom properties —
`--totm-row-stripe` (the group's enemy/neutral/ally accent) and `--totm-row-ring`
(the selected/focus ring) — rather than each rule setting `box-shadow` directly,
which would make them replace each other by specificity. That is also why the
group accent **must not go back to being a `border-left`**: at
`.totm-target-group .totm-target-btn` (0,2,0) it outranked
`.totm-target-btn--selected` (0,1,0), so the selected highlight painted three
sides and died at the stripe.

Survey rows additionally carry `pointer-events: none` (with it turned back *on*
for the distance chip, so its tooltip survives — core's
`button > * { pointer-events: none }` means that needs saying explicitly). With
no pointer events the row cannot be hovered, pressed, or click-focused, so none
of core's `button:*` states can reach it in the first place.

`styles/module.css` is not bundled — Foundry serves it directly and hot-reloads
it — but anything driven by a context flag (`rowStatic`, `rowAction`) is in
`dist/module.js` and needs **F5**. When a CSS fix "doesn't work", check that
first: a mix of new stylesheet and old JS renders rows with none of the classes
the stylesheet is targeting. Rendering `styles/module.css` against
`resources/app/public/css/foundry2.css` in headless Chrome is a fast way to
settle what a row actually looks like without launching a world.

## Range measurement and the distance chip

`src/targeting/range.ts` owns every question about how far apart two tokens are.
It is the single measurement: `collectCandidates` measures once with
`distanceBetween`, then hands that number to both `isWithinRange` (the gate) and
`bandFor` (the chip), so the greying and the label can never come from two
different readings, and a `distanceTo` that throws costs the chip rather than the
whole picker.

Two system settings decide what a distance *means*, and both are mirrored so the
picker agrees with the ruler and the token hover:

- **World** `VariantRules.rangeMeasurement` (daggerheart.js:22435) — the foot
  thresholds (5/15/30/60) plus `enabled`, which is **on by default** and makes
  the system print band *names* instead of numbers everywhere. So the chip
  usually reads "Close", not "30 ft"; `formatDistance` only falls back to
  numbers-plus-units when a world has turned that off.
- **Scene** `scene.flags.daggerheart.rangeMeasurement` (daggerheart.js:37731) —
  `custom` supplies its own thresholds, `disable` puts plain numbers back on that
  scene alone. `DhMeasuredTemplate.getRangeLabels` (daggerheart.js:40206) is the
  routine being mirrored. Note the split: `custom` changes the *thresholds*
  (so it changes gating), `disable` changes only the *display*.

Colours come from `src/ui/range-colors.ts`, which mirrors **Daggerheart:
Distances**' palette so a chip matches the ring the player just saw on the
canvas. Optional, never a dependency — without that module it uses the same
traffic-light default the module itself does. Its four palettes are **copied**
from `daggerheart-distances/scripts/constants.js` (verified against **v0.2.6**);
its `ring1`–`ring4` are melee/veryClose/close/far in order. A dynamic `import()`
of its real table would work but only asynchronously, and this is read while
rendering a row.

The chip's colour reaches CSS as an inline `--dhth-range-rgb` holding
space-separated channels. **The row emits the whole declaration or an empty
`style` attribute — never `--dhth-range-rgb:` with nothing after it.** An empty
custom property is still a *declared* one, so `var(--dhth-range-rgb, 120 135 150)`
in `styles/module.css` would skip its fallback and compute to nothing; that
fallback is what covers Very Far and an unreadable palette.

## Foundry gotchas (apply when you build the features)

- **ApplicationV2 UI**: the built-in `actions` click dispatch has proven
  unreliable in this Foundry build. Prefer one delegated click listener attached
  in `_onRender` that reads a `data-*` attribute via `closest()`.
- **Handlebars**: no `{{else if}}` and no `eq` helper here — precompute booleans
  in `_prepareContext` and use nested `{{#if}}`/`{{else}}`.
- **Hand-edited JSON** (`lang/`, `packs/`): save **UTF-8 without a BOM**. Foundry's
  loader chokes on a BOM, and PowerShell's `Set-Content -Encoding utf8` adds one —
  use `[System.IO.File]::WriteAllText(path, text, (New-Object System.Text.UTF8Encoding($false)))`.
- **World state**: only GMs can write world-scoped settings; all clients can read.
  Player→GM coordination goes over `game.socket` (set `"socket": true` in
  `module.json` first — currently `false`).
- **A chat message does not remember who was hit.** `config.targets[].hit` is set
  by the attack roll (daggerheart.js:40922), but `DHActorRoll`'s schema
  (daggerheart.js:17130) keeps only id/actorId/name/img/difficulty/evasion, so the
  field is stripped on the way into the document and reads `undefined` — which
  tests as "missed" for every target of every attack. There is no `hasHitTarget`
  either; it never existed. The card re-derives hits at render time, so ask the
  system: `system.currentHitTargets` (daggerheart.js:17211), guarded by
  `system.targeting.usingSelect` — on the "selected tokens" tab it returns the
  controlled tokens instead and its ids no longer match `system.targets`.

## Dev environment

- A directory **junction** already links this repo into Foundry:
  `%LOCALAPPDATA%\FoundryVTT\Data\modules\daggerheart-target-helper` → the repo root.
  Foundry serves the built `dist/module.js` and the root assets directly.
- Sibling module **Campaign Story Decks** (`../foundry-narrative-tools`) uses the same
  toolchain and is a good reference for patterns — ApplicationV2 windows, the
  delegated-click dispatch, GM-authoritative world-setting sync over sockets, and
  the Docker build setup are all worked out there.
