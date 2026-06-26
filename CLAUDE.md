# MCFunction++ — Project Context for Claude

## What This Is

MCFunction++ is an Electron desktop IDE for authoring, validating, and packaging Minecraft datapacks. It is built by Portyl Studios and distributed as a Windows NSIS installer via GitHub Releases (`Portyl-Studios/MCFunctionPlusPlus`).

The app has two runtime contexts that share most renderer code:
- **Desktop (Electron)** — full local filesystem access via IPC; auto-update via `electron-updater`
- **Web (Firebase Hosting)** — planned future target; not yet implemented

## Tech Stack

| Layer | Tools |
|---|---|
| Main process | Electron, TypeScript (ESM), Node.js |
| Renderer | React, TypeScript, CodeMirror 6, Tailwind CSS |
| Bundler | Vite (renderer), `tsc` (main) |
| Packaging | `electron-builder` — NSIS only for Windows |
| File watching | `@parcel/watcher` |
| Auto-update | `electron-updater` + GitHub Releases |
| CI/CD | `.github/workflows/desktop-release-pipeline.yml` |

## Source Layout

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

## IPC Architecture

The renderer has **no direct Node.js or Electron access**. Everything goes through the contextBridge in `src/main/preload.ts`, which exposes a typed `ElectronAPI` object. All IPC handlers are registered in `src/main/main.ts` or sub-modules (`workspace.ts`, `datapack.ts`, `fileops.ts`, `minecraft-data.ts`, etc.).

- **Add a new capability**: register an `ipcMain.handle('channel-name', ...)` in main, expose it via `preload.ts`, and add the type to `ElectronAPI` in `electron-api.ts`.
- File operations enforce an allowlist (`getAllowedFileOperationRoots`) — paths outside the active workspace/datapack directory are rejected.

## Key Modules

| File | Responsibility |
|---|---|
| `src/main/main.ts` | App bootstrap, IPC wiring, window lifecycle, file watchers |
| `src/main/workspace.ts` | Workspace load/save; tracks which datapacks belong to a workspace |
| `src/main/datapack.ts` | Datapack open/close, Minecraft data bootstrap |
| `src/main/minecraft-data.ts` | Downloads server.jar, runs `--reports`, caches results under `userData/Minecraft Data Cache/<version>` |
| `src/main/preferences.ts` | Persisted app preferences (panels, window state, Java path, MC version) |
| `src/main/auto-updater.ts` | `electron-updater` integration; checks once per launch |
| `src/main/fileops.ts` | Sandboxed file read/write/list with path validation |
| `src/renderer/index.tsx` | App root, CodeMirror setup, editor state |
| `src/renderer/mcfunction-language/` | MCFunction parser, highlighter, diagnostics, autocomplete |
| `src/renderer/use-workspace.ts` | React hook for workspace state |
| `src/renderer/use-datapack.ts` | React hook for datapack state |

## File Types

- `.mpp-workspace` — workspace descriptor; can be double-clicked to open
- `.mpp-datapack` — datapack metadata; can be double-clicked to open
- `.mcfunction` — Minecraft command files; custom language support via CodeMirror

## Security Model

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` — renderer is fully sandboxed
- All file I/O goes through IPC with explicit path validation
- Single instance lock enforced at startup

## Build & Run

```bash
npm install          # install deps
npm run dev          # Vite dev server (renderer hot-reload only, no Electron)
npm run electron     # build + launch Electron
npm run dist:win     # build NSIS installer → release/
```

TypeScript compilation: `tsc` compiles `src/main/` → `out/main/`; Vite bundles `src/renderer/` → `out/renderer/`.

## CI/CD — Release Pipeline

Triggered by pushes to `main` from a non-bot actor. The pipeline:
1. Reads `major.minor` from `package.json`, auto-increments patch from existing tags
2. Commits a version bump with `[skip ci]`
3. Creates a GitHub Release and publishes NSIS artifacts + `latest.yml`

To push without triggering a release, include `[skip ci]` in the commit message.

## Preferences Keys

`preferences-get` / `preferences-set` / `preferences-update` use typed keys:
- `panels` — tab order, visibility, active tabs, panel widths/height
- `window` — `isFullScreen`
- `updates` — `deferredVersion`
- `workspace` — `lastActive.dir/name`
- `minecraft` — `defaultVersion`, `javaPath`, `hideSnapshotsInVersionMenu`

## Java Requirement

The app needs Java at runtime to run Minecraft's `--reports` command for data cache generation. Resolved from either `PATH` or an explicit `javaPath` preference. Java 26+ recommended.

## Conventions

- **ESM throughout** (`"type": "module"` in `package.json`); preload uses CommonJS via `require()` because Electron requires it
- **Typed IPC** — every channel has a corresponding entry in `ElectronAPI` (electron-api.ts) and the preload
- **React hooks** for renderer state — don't reach into the DOM directly
- **CodeMirror 6** for the editor — extensions-based, not monolithic
- **Tailwind** for styling in the renderer
- **No web deployment yet** — don't add Firebase-specific rendering logic until web mode is scoped
