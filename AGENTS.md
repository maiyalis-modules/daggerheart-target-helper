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
  api.ts               the public API published on the module entry (init)
  targeting/           the guard, candidate list, range measurement + origin, hit/miss feedback
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

## Targeting yourself

The picker has a fourth section, **Yourself**, holding the acting actor's own
token(s). Before it existed the only way to be your own target was an action the
system already resolves to the caster (`target.type === "self"`), so anything
aimed at "anyone" — a potion, a self-patch, standing in your own blast — simply
could not be pointed at you.

- **A group, not an exemption.** `includeSelf` on `CandidateOptions` only stops
  the acting actor being filtered out *before* the disposition filter; it still
  has to pass it. So a `hostile` action offers no Self row, and that is on
  purpose: `TargetField.prepareConfig` filters user targets by disposition on the
  way back in (daggerheart.js:35236), so a self target it rejects would leave the
  replayed action swinging at nothing at all. The rule the module holds
  everywhere — *the candidates we offer are exactly the ones the workflow will
  accept* — is what decides this, not a preference about self-harm.
- **`groupFor` short-circuits on self.** A token always matches its own
  disposition, so `isTargetFriendly(actor, self, "friendly")` is true and the
  acting actor would otherwise be filed under Allies every single time.
- **Every token of the acting actor is "yourself"**, matched by actor uuid rather
  than by placeable. Two tokens sharing an actor share a sheet, so damage aimed
  at either lands on you; the distance chip is what tells them apart. This is the
  opposite of the range-origin rule below it, which compares *by placeable* —
  that one is about where an attack starts, and a specific placeable is the only
  thing that answers it.
- **The origin-token exclusion is skipped for self.** In the ordinary case
  `actingToken` *is* the acting actor's token, so the "not a target of its own
  claws" check would take back exactly what `includeSelf` just allowed. A foreign
  origin (a companion) is still excluded.
- **Self is ordered last** in `GROUP_ORDER`, extending the existing
  worst-misclick-last ordering: enemies, allies, then you.
- **Surveys pass `includeSelf: false`** — a list of what's around you has no use
  for a row reading "you, zero feet away".
- `action-portraits.ts` **skips the acting actor when releasing portraits** on an
  abandoned action, the same way `onPreUseAction` sorts it out when raising them:
  the acting actor's portrait belongs to the spotlight system and was never
  raised by us, so releasing it would pull down a portrait we don't own.

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

## Measuring from someone other than the roller

`src/targeting/range-origin.ts` is the one seam where the token an action is
measured *from* is not the acting actor's own. Another module registers a
resolver through the public API (`api.registerRangeOrigin`), it is called with
each action reaching the picker, and it answers with a `Token`, a token id, a
token uuid, or `null` to decline.

- **Written for animal companions.** A Beastbound ranger commanding their
  companion makes the Spellcast Roll themselves, so the roll, the Hope and every
  bonus belong to the ranger — but the claws start where the companion is
  standing. `eryndor-essentials`' Companion feature is the caller.
- **Only the distance moves.** Grouping into enemies/allies and the system's
  disposition filter stay with `action.actor`. Who counts as an enemy is the
  commanding character's question; how far away they are is the companion's.
- **Declining is free, and so is a bad answer.** A token that isn't on the
  current scene falls back to `findActingToken`, so a companion left off the
  battle map measures from its partner rather than not at all. A resolver that
  throws loses its own override and nothing else.
- **The origin token is dropped from the candidate list**, alongside the acting
  actor's — a companion is not a target of its own attack. Compared by placeable
  rather than by actor, since two tokens of one actor are two creatures here.
- Registry, not a property on the action: the system's Actions are `DataModel`s,
  a stray property on one is outside its schema and survives no round trip, and
  an undocumented convention spanning two repositories has nothing holding it
  together. Adding to `TargetHelperApi` means editing the caller too — that's the
  point.

## Action animations (JB2A over the portraits)

A second feedback layer on top of the CSS flashes: a JB2A `.webm` played over a
Ginzzzu portrait to depict an action. Optional at every step — no config, no JB2A,
a bad key, a failed decode — and each of those degrades to the flash alone.

- **Plain DOM video, not Sequencer.** The assets are alpha WebM files; a `<video>`
  appended to `.ginzzzu-portrait-wrapper` plays them and inherits Ginzzzu's drag
  transform for free. Sequencer is used only as a *database* — key
  lookup and search — never as a renderer. **Never set a transform on the
  wrapper**: Ginzzzu drives it through `--ginzzzu-drag-x` / `--ginzzzu-flip-scale-x`
  plus a WAAPI breathing animation, and writing over it fights them. Being a child
  also means it inherits the wrapper's *mirror*, which is the one part that has to
  be cancelled rather than inherited — see the facing section below.
- **Always call `video.play()`.** The `autoplay` attribute does not reliably start
  a video appended from script — it loads, paints one frame and sits there. Assets
  that open on a build-up then show nothing at all, which looks like a broken path
  rather than a stalled playback.
- **A fresh element per play, never a reused one.** Replaying one element means
  re-attaching and rewinding it, and two blows landing together would have the
  second interrupt the first. Separate nodes overlap naturally. Clean up on
  `ended` *and* `error` *and* a timeout — a decode that stalls mid-playback fires
  none of the first two, and a frozen frame parked on a portrait is worse than a
  stuck class.
- **`postRollAction`, not `postUseAction`.** Damage is a workflow *part* of the
  same action (`executeWorkflow`, daggerheart.js:17629), so `use()` does not
  resolve — and `postUseAction` does not fire — until damage has been applied.
  Hooking that puts the swing on top of the damage flash instead of ahead of it.
  Both hooks are registered and each checks the `vfxTiming` setting, so the timing
  can change with no reload.
- **Not every action rolls.** A Hope-spent heal, a utility feature, anything
  resolved by spending rather than rolling has no roll part in its workflow, so
  `postRollAction` never fires for it at all. Those play on `postUseAction`
  whatever the timing setting says, and their `playOn` (hit/miss) is ignored
  because their targets carry no `hit` to filter on. Gating the depiction on
  `config.hasRoll` — a leftover from when this was attack-only — silently killed
  every non-attack animation.
- **Mirroring is decided per client, never sent.** JB2A assets are authored with
  the actor off the left edge, so direction comes from comparing the two
  portraits' live `getBoundingClientRect()`. Portraits are draggable and two
  clients need not have them in the same order. The result is then XOR'd with the
  wrapper's own mirroring (`wrapperMirrored`), because every `flip` decision is
  about how the effect reads *on screen* and a mirrored wrapper mirrors its
  children — that applies to `"always"` and `"never"` too, not just `"auto"`.
- **The asset path is resolved by the sender and broadcast concrete.** One key can
  match a whole family of colour and variant siblings; resolving per client would
  show each player a different file.
- **Chaining the damage flash needs an announcement.** With `"action"` timing the
  flash always arrives *before* the animation, because damage is applied inside
  the workflow. So `postRollAction` emits `vfxExpected` for the portraits involved
  whatever the timing, and a flash landing on an announced portrait is held until
  the video's `ended` (or a 10s backstop — a flash that goes missing would be far
  worse than one that is late). Chaining to `ended` is also why no duration is
  read anywhere.
- **Chaining holds every outcome, not just the damage flash.** Healing, the miss
  flash and the floating resource numbers all wait, because holding one and not
  the others just moves the desync somewhere more visible. The *targeting* cue is
  excluded: it fires before the action to announce who is being aimed at, so
  delaying it would defeat its purpose.
- **The announcement is on `preUseAction`, not the roll.** It is the only hook
  every action reaches, and a rollless action applies its healing inside the
  workflow — so announcing at the roll would miss precisely the case that most
  needs holding. Because that is earlier than `playOn` filtering, the play message
  also carries `releaseActorIds`: portraits announced but not drawn on, whose held
  feedback would otherwise wait for the backstop.
- **Waiting is per *action*, not per portrait.** A portrait usually waits for the
  video playing on itself — but a caster-only animation still has its damage land
  on the *target*, and that flash should follow the swing. So an action nominates
  the portraits that animate as **drivers** and everything else it touches as
  **followers**, released once the last driver finishes (`linkVfxRelease`). The
  announcement therefore covers every portrait the action's feedback can land on,
  not just the ones drawn on. With no drivers the followers go immediately, and
  every bail after the announcement must `emitVfxRelease` — otherwise held
  feedback waits out the whole backstop for an animation that never plays.
- **A held portrait must not be lowered.** Ginzzzu portraits drop on a linger
  timer, so holding feedback for an animation also means holding the portrait.
  `portrait-fx` reports hold/release through `onVfxHoldChange` and the bridge
  re-arms a long window while something waits, then the ordinary short linger once
  it plays. Two traps: `handlePortraitFx` arms the short linger *before* calling
  `playFx`, because `playFx` decides synchronously whether to hold and the long
  re-arm has to win; and a settle with nothing queued stays silent, or it would
  cut short the 45s grace an attack takes while its damage step is still to come.
- **`speed` needs `defaultPlaybackRate`, not just `playbackRate`.** Loading a
  media resource resets `playbackRate` back to `defaultPlaybackRate`, so a rate
  set before `src` is assigned is thrown away by the load that follows — the code
  reads correctly and does nothing at all. Set both, and re-apply on
  `loadedmetadata`. Clamped rather than trusted, since `playbackRate` throws on
  some values. Slowing an asset stretches the wait for anything chained to it,
  which is correct: `ended` still fires when the video is genuinely over, so no
  duration is ever calculated.
- **A config is a list of steps, not one animation.** One action often wants
  several — a cast on the caster and an impact on the target are different assets,
  and a projectile between them will be a third. `sequence` decides whether steps
  start together or wait for each other; `"after"` awaits the previous step's
  video actually ending rather than guessing a delay, so it stays correct whatever
  the asset length or `speed` does. `playVideoFx` returns a promise that resolves
  when the video is gone — finished, failed, or timed out — which is what makes
  that possible without reading a duration.
- **Sequencing lives in one place — `runVfxSequence`.** Both the table playback
  and the config window's preview go through it, because a preview that times its
  steps differently from the real thing is worse than no preview. A **positive**
  gap waits on the previous video's `ended`, which needs no arithmetic and cannot
  drift. A **negative** gap (overlap) is the one case that cannot work that way —
  "start 200ms before the previous finishes" has already passed by the time
  `ended` fires — so there the runtime is measured from `probeVideoDuration`, and
  the overlap is approximate by design. A step's delay is passed *into* `start`
  rather than read from the step, or a sequence would apply it twice.
- **Legacy flat configs are read, not migrated.** A config saved before steps
  existed has `key`/`on`/`placement` directly on the object; `normalize` reads it
  as a one-step list, so saved flags keep working untouched and are only rewritten
  if someone opens the form and saves. An old `on: "both"` stays one step drawn on
  both portraits, exactly as it behaved.
- **A step whose key resolves to nothing is dropped, not fatal.** A four-step
  sequence with one typo should still show the other three; only an action left
  with no playable steps at all abandons and releases its announcement.
- **Config is an item flag keyed by action `_id`** (`vfx.<actionId>`). Daggerheart
  actions are entries in `item.system.actionsList` (daggerheart.js:9517), not
  documents, so there is no `action.setFlag`. Keying by action id is what keeps a
  Grimoire's three actions independently animatable instead of collapsing to one
  animation per item.
- **The auto-recognition table lives in `services/vfx-autorec.ts`.** Matching is a
  substring test with first-hit-wins, so **order matters**: every entry is
  arranged specific-before-generic, or `"sword"` swallows `"greatsword"` and
  `"bow"` swallows `"crossbow"`. Three things are worth re-checking after any edit,
  and all three are one shell command each against
  `modules/jb2a_patreon/scripts/jb2a_sequencer.js`: that every `jb2a.` key's
  family and nested segments exist, that no earlier needle is a substring of a
  later one, and what fraction of the SRD/Void names still match.
- **It only guesses; the per-action config always wins.** Weapons map well because
  a longsword is a longsword. Domain cards are guesses at feel — Daggerheart has no
  counterpart in a library drawn for 5e — so cards with no real visual (Notorious,
  Deft Deceiver, Tactician) deliberately match nothing rather than being given a
  shrug of an animation. Ranged weapons resolve to `on: "spanning"` entries, which
  is the case that mode exists for.
- **Auto-recognition matches the action name first, the item name second.** Item
  first would give every action on a multi-action item the same animation — the
  exact failure the per-action flag exists to avoid. The item fallback catches the
  opposite shape: a weapon named "Dagger" whose only action is called "Attack".
- **Windows hold a draft.** `VfxSettingsApp` re-renders on every change so its
  mismatch warning can appear live; rendering from the *stored* settings repaints
  each control back to its saved value the instant it is touched, and a checkbox
  refuses to stay checked. Read the controls into the draft before re-rendering.
  `ActionVfxConfigApp` is the deliberate opposite: switching action *does* reload
  from storage, because it is a different action's settings.
- **`on: "spanning"` is a separate renderer, not another `on` value.** A projectile
  belongs to *two* portraits, so it cannot live inside either the way every other
  effect does — `playSpanVfx` positions it in viewport coordinates on its own fixed
  overlay (`#dhth-vfx-span-layer`). The cost is what that gives up: it does not
  inherit Ginzzzu's drag or flip, so a portrait dragged mid-flight leaves the shot
  behind. Projectiles are short enough that this has never looked wrong.
  - Stretched along the line, natural thickness — the bargain Sequencer's
    `stretchTo` makes. JB2A ranged assets bake a travel distance into their pixel
    width (`_30ft_1600x400`) and no portrait rail will match one, so something has
    to give; a constant thickness reads better than a strip that fattens with
    distance. `object-fit: fill` is deliberate.
  - Rotated about its left edge (`transform-origin: 0 50%`) with a `margin-top` of
    half its thickness, so the strip is centred on the line rather than hanging off
    it. Doing this with `translateY(-50%) rotate()` instead would translate in the
    *rotated* frame and skew the whole thing off the line.
  - Tracked against the **destination** portrait, so a damage flash chained to the
    animation waits for the shot to land rather than for it to be fired.
- **A weapon's attack is not in its Actions tab.** `WeaponSheet` shows
  `system.actions`, but the thing you actually want to animate is
  `system.attack` — `actionsList` on a weapon is `[this.attack, ...actions]`
  (daggerheart.js:37167), and the attack has no row of its own to open a
  `DHActionConfig` from. So the animation button is registered on **item** sheets
  as well as action sheets; from an item it opens the config with the full action
  picker, attack included. That first entry can also be a hole, so anything
  without an `_id` is filtered out before it becomes a blank row.
- The sheet button (`ui/action-sheet-button.ts`) is the thinnest possible
  integration on purpose: it only opens `ActionVfxConfigApp`, which is also
  reachable through `api.openActionVfxConfig`. If a system update reshapes
  `DHActionConfig`, the button stops appearing and nothing else breaks.

## Turning portraits to face the attacker

While a target's portrait is up, it is mirrored so its subject looks towards
whoever is acting on it (`services/portrait-facing.ts`). Transient and DOM-only,
like the flashes — no actor writes, so it never touches Ginzzzu's own flip flag.

- **Set their variable, never a transform.** Ginzzzu's wrapper transform is a
  chain of custom properties ending in `scaleX(var(--ginzzzu-flip-scale-x, 1))`.
  Writing that variable *inline* beats their `.ginzzzu-portrait-flipped` class rule
  by specificity while leaving the drag offset, breathing scale and emotion tilt in
  the chain intact. Releasing is `removeProperty`, not writing `1` back — that
  hands control to the class again, so a portrait the GM flipped by hand returns to
  *their* flip rather than to unflipped.
- **The GM's flip is the baseline, not a competitor.** The class stays on the
  wrapper and keeps meaning what it meant; the inline value is the product of it
  and the turn, so a hand-flipped portrait that also needs turning lands back on
  `1` rather than on `-1` twice over.
- **Which way unflipped art looks is a setting, because the DOM cannot say.**
  `portraitFacing` is `off` / `right` / `left` — the baseline direction *and* the
  feature's switch. There is deliberately no per-actor setting: Ginzzzu's
  right-click flip already is one, since it moves that actor's baseline and the
  turn composes with it.
- **Cleanup is mostly free.** Ginzzzu does `wrapper.remove()` when a portrait
  lowers and builds a fresh node next time, so the inline value dies with it. The
  explicit `releaseFacing` covers the abandoned-action path, where the portrait
  stays up.
- **Only targets, never the caster** — same reason `onPreUseAction` refuses to
  raise or lower the acting actor's portrait: it belongs to the spotlight system.
  Self-targets are skipped too; there is nobody for them to turn towards.
- **Everything drawn inside a wrapper has to account for the mirror.** Two things
  broke on this and both are now fixed at the source: JB2A videos XOR their flip
  against `wrapperMirrored`, and the floating resource numbers counter-flip through
  `--dhth-float-flip` or print "HP -2" backwards.
- **The CSS flashes move through `--shakeX` / `--bobY`, not `transform`.** An
  animated `transform` on the wrapper *replaces* Ginzzzu's whole chain for its
  duration, so a damage flash on a turned (or merely dragged) portrait snapped it
  upright, shook, and snapped back. Those two variables are terms inside their
  chain — registered with `@property`, which is also what lets a custom property
  animate smoothly — and Ginzzzu's own emotion shakes drive them the same way.
  Positive `--bobY` is *down*.

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
