# Contributing to MCFunction++

Thanks for your interest in contributing! This document covers the development setup, build process, release pipeline, and asset requirements. For a product overview, see the [README](README.md).

MCFunction++ is an Electron desktop IDE for authoring, validating, and packaging Minecraft datapacks, built by Portyl Studios.

## Tech Stack

| Layer | Tools |
|---|---|
| Main process | Electron, TypeScript (ESM), Node.js |
| Renderer | React, TypeScript, CodeMirror 6, Tailwind CSS |
| Bundler | Vite (renderer), `tsc` (main) |
| Packaging | `electron-builder` — NSIS (Windows) |
| File watching | `@parcel/watcher` |
| Auto-update | `electron-updater` + GitHub Releases |

## Prerequisites

- [Node.js](https://nodejs.org/) v20 or higher
- [npm](https://www.npmjs.com/) v10 or higher (ships with Node.js)
- [Java](https://adoptium.net/) 26+ (required at runtime for Minecraft data preparation)

## Getting Started

```bash
git clone https://github.com/Portyl-Studios/MCFunctionPlusPlus.git
cd MCFunctionPlusPlus
npm install
```

## Development Workflow

Renderer dev server with hot module replacement (UI only, no Electron):

```bash
npm run dev
```

Launch the Electron app:

```bash
npm start            # run the last build
npm run electron     # build, then launch
```

## Building

```bash
npm run build
```

This compiles TypeScript from `src/main/` → `out/main/` and bundles the React renderer from `src/renderer/` → `out/renderer/`.

## Building Distributables

```bash
npm run dist:win     # Windows NSIS installer → release/
```

Other targets exist (`dist:mac`, `dist:linux`, `dist`) but are not officially supported or tested; Windows/NSIS is the only distributed target today.

## Project Structure

```
src/
  main/           # Electron main process (Node.js / Electron APIs)
  renderer/       # React UI + CodeMirror editor
    mcfunction-language/   # Custom MCFunction language for CodeMirror
    overlays/              # Dialog, toast, context menu, tooltip systems
    themes/                # CodeMirror color themes
    diagnostics/           # Global diagnostic scanning
  shared/         # Code shared between main and renderer
resources/
  datapack-schema/         # JSON schemas for datapack validation
assets/                    # App icons, installer art
```

### IPC Architecture

The renderer has no direct Node.js or Electron access. Everything goes through the contextBridge in `src/main/preload.ts`, which exposes a typed `ElectronAPI` object. IPC handlers are registered in `src/main/main.ts` and sub-modules (`workspace.ts`, `datapack.ts`, `fileops.ts`, `minecraft-data.ts`, etc.).

To add a capability: register an `ipcMain.handle('channel-name', ...)` in main, expose it via `preload.ts`, and add the type to `ElectronAPI` in `electron-api.ts`. File operations are sandboxed to an allowlist (`getAllowedFileOperationRoots`) — paths outside the active workspace/datapack are rejected.

## Release Pipeline (CI/CD)

`.github/workflows/desktop-release-pipeline.yml` automates versioning and publishing on pushes to `main`:

- **Trigger** — pushes to `main` by a non-bot actor.
- **Version** — reads `major.minor` from `package.json`; auto-computes the patch from existing `vMAJOR.MINOR.*` tags, ignoring any user-provided patch.
- **Bump** — commits the version bump to `package.json` (with `[skip ci]`) if it changed.
- **Tag & Release** — creates tag `vX.Y.Z` and a GitHub Release.
- **Assets** — builds and publishes NSIS artifacts (`.exe`, `.exe.blockmap`, `latest.yml`) when missing.
- **Safeguard** — skips publishing if all required assets already exist for the target tag.

### Choosing major/minor

Before pushing to `main`, set `package.json` version to the major/minor line you want with patch `0` (e.g. `2.4.0`). The pipeline creates `v2.4.0` for the first release in that series, then `v2.4.1`, `v2.4.2`, etc. on subsequent pushes.

### Pushing without triggering a release

Add `[skip ci]` to the commit message:

```bash
git commit -m "docs: update README [skip ci]"
git push
```

## Auto-Update

Desktop auto-update uses `electron-builder` + `electron-updater` against GitHub Releases (`Portyl-Studios/MCFunctionPlusPlus`). The Windows channel is NSIS artifacts + `latest.yml`. The app checks for updates exactly once per launch (no background polling until restart), and only in packaged builds.

## Asset Requirements

App icons:

- Windows: `assets/icon.ico` (256×256 or multi-size ICO)
- macOS: `assets/icon.icns` (512×512@2x recommended)
- Linux: `assets/icon.png` (512×512 recommended)

NSIS installer art:

- Header: `assets/installer-header.bmp` (150×57)
- Sidebar: `assets/installer-sidebar.bmp` (164×314)

You can generate icon formats from a single PNG with tools like [icoconverter.com](https://www.icoconverter.com/), [cloudconvert](https://cloudconvert.com/png-to-icns), or [img2go](https://www.img2go.com/convert-to-icon).

## Minecraft Data

The desktop app prepares Minecraft command/schema data automatically. On startup, and whenever the selected datapack's Minecraft version changes, it checks a local cache first; if the version is missing it downloads the official `server.jar` metadata source, runs report generation, and builds the cache under the app's user data directory in `Minecraft Data Cache/<mc_version>`. Progress and errors surface in-app.

<details>
<summary>Legacy manual process (debugging only)</summary>

Use this only to inspect raw Mojang report output yourself:

1. Download the target `server.jar` from [Minecraft Server Downloads](https://www.minecraft.net/en-us/download/server).
2. Run `java -DbundlerMainClass=net.minecraft.data.Main -jar server.jar --reports`.
3. Inspect output in `generated/reports/`.

MCFunction++ no longer requires manually placing generated reports into `resources/minecraft/<mc_version>` for normal usage.

</details>

## License

By contributing, you agree that your contributions are licensed under [GPLv3](LICENSE).
