# Maiyalis: Target Helper

Targeting quality-of-life tools for [Daggerheart](https://foundryvtt.com/packages/daggerheart) games in Foundry VTT v14.

## Status

Early scaffold. The module loads, registers a client setting, and preloads its templates — feature work is still to come. Built with a TypeScript + Vite toolchain (run in Docker); see [Building](#building).

## Installation

**From manifest URL**

```
https://github.com/maiyalis-modules/daggerheart-target-helper/releases/latest/download/module.json
```

**For local development**

Link this repo into your Foundry user data directory so the folder name matches
the module id. A **directory junction** works without elevation on Windows and
keeps the repo in place:

```powershell
New-Item -ItemType Junction `
  -Path "$env:LOCALAPPDATA\FoundryVTT\Data\modules\daggerheart-target-helper" `
  -Target "d:\Foundry\daggerheart-target-helper"
```

## Building

The module is written in **TypeScript** and compiled to `dist/module.js` (what
`module.json` loads). Node.js is not required on the host — the build runs in a
container:

```
docker compose run --rm build   # one-off type-check + build
docker compose up watch         # rebuild dist/module.js on every save
```

The first run installs dependencies into a named Docker volume (`node_modules`
can't be shared with the host because Vite ships platform-specific binaries).

### Hot reload

While a world is running, Foundry live-applies changes with **no page refresh** to:

- `styles/module.css`
- `templates/*.hbs`
- `lang/*.json`

**JavaScript is not hot-swapped.** After `watch` rebuilds `dist/module.js` from a
TypeScript change, **refresh the browser (F5)** to load it.

## Layout

```
daggerheart-target-helper/
  module.json            # manifest (esmodules -> dist/module.js)
  src/                   # TypeScript source (compiled by Vite)
    module.ts            #   entry point (init / ready hooks)
    constants.ts         #   ids, settings keys, template paths
    settings.ts          #   game.settings registration
    types/foundry.d.ts   #   minimal ambient Foundry type shim
  dist/module.js         # build output (git-ignored)
  styles/module.css      # stylesheet
  templates/             # Handlebars templates
  lang/en.json           # localization strings
  packs/                 # compendium content
  docker-compose.yml     # containerized build toolchain
```

## Localization

All user-facing strings live in [lang/en.json](lang/en.json) under the `DHTH.` prefix. Reference them with `game.i18n.localize()` in scripts or `{{localize}}` in templates.
