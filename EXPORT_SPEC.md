# Export / Build Datapack — Implementation Spec (v1.1)

_Scoped against the codebase at 1.0.19. Replaces the disabled menu stubs at `index.tsx:4675` (Build) and `4685` (Export)._

## 1. Goal

Turn a loaded datapack directory into a Minecraft-loadable `.zip`:

- **Export Datapack** — package as-is to a user-chosen location.
- **Build Datapack** — run the global diagnostic scan first, gate on errors, then export with a build report. Optionally drop straight into a world's `datapacks/` folder.

A valid datapack zip has `pack.mcmeta` and `data/` at the **archive root** (not nested under a folder). The loaded datapack directory already _is_ that root, so the core operation is "zip the directory contents, minus internal files, with a synced `pack.mcmeta`."

## 2. What's already in place (reuse, don't rebuild)

| Need | Existing asset |
|---|---|
| Datapack metadata (`id`, `name`, `packVersion`, `minecraftVersion`, `author`, `description`, `packFormatVersionMin/Max`, `tags`) | `DatapackMetadata` in `datapack-parser.ts`; live instance via `datapackManager.getDatapack()` / `getDatapackDir()` (`datapack.ts`) |
| Recursive file listing | `getAllFiles(rootDir)` in `fileops.ts` |
| Datapack sanity check (pack.mcmeta present) | `validateDatapackFolder()` in `fileops.ts` |
| Native save dialog pattern | `workspace-save-dialog` handler, `workspace.ts:443` (`dialog.showSaveDialog` with filters + `defaultPath`) |
| pack_format parsing precedent (`pack_format`, `supported_formats`, min/max) | `main.ts:508–533` |
| Validation pass for Build | `runGlobalDiagnosticsScan()` → `Record<string, DiagnosticSummary>` (`diagnostics/global-diagnostics.ts`), already called in `index.tsx:2886` |
| Typed IPC plumbing | `preload.ts` + `ElectronAPI` in `electron-api.ts` |

## 3. Dependency

Add **`archiver`** (`npm i archiver` + `npm i -D @types/archiver`).

Rationale over JSZip: `archiver` streams files from disk to the output `.zip` stream, so it never loads the whole pack into memory and sidesteps the 10 MB cap baked into the `readFile` helper. Pipe `fs.createReadStream` per entry — do **not** route export reads through `fileops.readFile`.

## 4. Trust boundary (important)

File I/O is deny-by-default and allowlisted to the active workspace/datapack roots (`assertPathAllowedForFileOperation`, `getAllowedFileOperationRoots` at `main.ts:264`). Export must:

- **Read** from the datapack directory — already an allowed root; assert it matches `datapackManager.getDatapackDir()` (or is within an allowed root) before reading.
- **Write** the `.zip` to an arbitrary user location (Downloads, Desktop, a world folder) that is *outside* the allowlist. The native save dialog is the trust boundary here — exactly how `workspace-save-dialog` already legitimizes an out-of-sandbox write. So the destination path must originate from `dialog.showSaveDialog` inside main, never from a renderer-supplied string.

Conclusion: do the dialog **and** the zip in one main-process handler. The renderer passes intent, not a path.

## 5. New main-process module: `src/main/export.ts`

```ts
export interface ExportResult {
  canceled: boolean
  outputPath?: string
  fileCount?: number
  bytes?: number
  warnings: string[]      // e.g. "pack.mcmeta regenerated from metadata"
}

export interface ExportOptions {
  syncPackMcmeta: boolean   // default true: rewrite pack.mcmeta from metadata
  destination?: string      // preset path (Build → world saves); skips dialog when set
}
```

Algorithm:

1. Resolve `datapackDir = datapackManager.getDatapackDir()`. If null → throw "No datapack loaded".
2. `await validateDatapackFolder(datapackDir)` → false ⇒ throw "Not a valid datapack".
3. Pick destination:
   - If `options.destination` set (Build-to-world), use it.
   - Else `dialog.showSaveDialog(mainWindow, { title: 'Export Datapack', defaultPath: defaultZipName(metadata), filters: [{ name: 'Datapack Zip', extensions: ['zip'] }] })`. Canceled ⇒ return `{ canceled: true, warnings: [] }`.
4. Build the entry list from `getAllFiles(datapackDir)`, then apply the **inclusion rules** (§6).
5. Open `archiver('zip', { zlib: { level: 9 } })`, pipe to `fs.createWriteStream(outputPath)`.
6. For each kept file, `archive.file(absPath, { name: relativePosixPath })`. The relative name is `path.relative(datapackDir, absPath)` with `\` → `/`.
7. Inject the synced `pack.mcmeta` (§7) via `archive.append(jsonString, { name: 'pack.mcmeta' })` instead of copying the on-disk one.
8. `await archive.finalize()`; collect `archive.pointer()` for `bytes` and the kept count for `fileCount`.
9. Return `ExportResult`. Surface `archive` `warning`/`error` events as rejects or `warnings[]`.

Register in `main.ts` alongside the other handlers (needs `mainWindow` for the dialog, like `workspace.ts`).

## 6. Archive inclusion rules

Start from `getAllFiles(datapackDir)` and:

- **Exclude** the internal metadata file `.mpp-datapack` (it is MCFunction++ bookkeeping, not part of the datapack).
- **Exclude** editor/VCS cruft if present: `.git/`, `node_modules/`, `.DS_Store`, `Thumbs.db`, `*.mpp-workspace`.
- **Normalize pack.mcmeta state**: if only `pack.mcmeta.disabled` exists on disk, the injected `pack.mcmeta` (§7) covers it; never write a `.disabled` file into the zip.
- **Include** `pack.png` (icon) and the entire `data/` tree verbatim.
- Skip directory entries (archiver creates them implicitly from file paths); skip symlinks.

`defaultZipName(metadata)` = sanitize(`${metadata.name}-${metadata.packVersion}`) + `.zip`, stripping characters invalid on Windows (`<>:"/\|?*`).

## 7. `pack.mcmeta` generation (source of truth = metadata)

Because the inspector lets users edit `packFormatVersionMin/Max`, `description`, etc., regenerate `pack.mcmeta` from `DatapackMetadata` at export time so the shipped file can't drift from what the UI shows. Shape mirrors what `main.ts:508–533` already parses:

```json
{
  "pack": {
    "pack_format": <packFormatVersionMin>,
    "supported_formats": { "min_inclusive": <min>, "max_inclusive": <max> },
    "description": <description>
  }
}
```

- When `min === max`, emit just `pack_format` (omit `supported_formats`) for maximum compatibility.
- Do **not** invent a Minecraft-version → pack_format table. The fictional/future version strings in this project (e.g. `26.1.2`, default format `12`) mean any hardcoded mapping would rot; metadata is the authority.
- If `syncPackMcmeta` is false, copy the on-disk `pack.mcmeta` (or `pack.mcmeta.disabled` renamed) verbatim and add a warning.

## 8. IPC contract

`electron-api.ts` — extend `ElectronAPI`:

```ts
exportDatapack: (options?: { syncPackMcmeta?: boolean }) => Promise<ExportResult>
buildDatapack:  (options: { hasErrors: boolean; destination?: string }) => Promise<ExportResult>
```

`preload.ts` — `exportDatapack: (o) => ipcRenderer.invoke('export-datapack', o ?? {})` (same for build).

`main.ts` — `ipcMain.handle('export-datapack', …)` and `'build-datapack'`, both delegating to `export.ts`.

Optional progress for large packs: `webContents.send('export-progress', { entry, processed, total })` from archiver's `entry`/`progress` events; renderer shows it on the existing toast/refresh-status UI. Defer if it complicates v1.1.

## 9. Renderer wiring

Replace the two stubs in `index.tsx`:

**Export menu** (`4685`):
```ts
{ label: "Export Datapack", onClick: handleExportDatapack, disabled: !activeDatapackDir }
```
`handleExportDatapack`: call `window.electron.exportDatapack()`. On `canceled` do nothing; on success show a toast ("Exported <name> — <fileCount> files, <size>") with a "Reveal in Explorer" action wired to the existing `reveal-in-file-explorer` channel; on throw, error toast.

**Build menu** (`4675`):
```ts
{ label: "Build Datapack", onClick: handleBuildDatapack, disabled: !activeDatapackDir }
```
`handleBuildDatapack`:
1. Run `runGlobalDiagnosticsScan({ targetDatapackDirs: [activeDatapackDir], … })` (same args as `index.tsx:2886`).
2. Tally errors from the returned `DiagnosticSummary` map.
3. If errors > 0, open the existing `dialog` overlay: "N errors found. Export anyway?" → Cancel / Export anyway.
4. Call `window.electron.buildDatapack({ hasErrors })`; same result handling as Export.
5. (Stretch) Add "Build into world…" that resolves `…/saves/<world>/datapacks/` and passes it as `destination`, skipping the save dialog.

Both items already have separate dropdown state (`isHeaderMenuFourOpen` / `FiveOpen`) — no menu restructuring needed.

## 10. Edge cases

- No datapack loaded → items disabled; handler also guards.
- Datapack with only `pack.mcmeta.disabled` → injected `pack.mcmeta` enables it.
- Destination path locked/in-use (e.g. open by Minecraft) → catch `EBUSY`/`EPERM`, surface a clear toast.
- Re-export over an existing file → native dialog confirms overwrite; world-destination path overwrites silently (intended for iteration).
- Files > 10 MB → fine, streamed (the readFile cap is bypassed by design).
- Filename collisions / illegal chars → sanitized in `defaultZipName`.

## 11. Test plan (lands with v1.2 Vitest, stub now)

- `pack.mcmeta` generation: min===max vs range; description passthrough; missing format fields fall back to metadata defaults.
- Inclusion filter: `.mpp-datapack` excluded, `data/**` + `pack.png` included, `.disabled` normalized.
- `defaultZipName` sanitization.
- Integration (Playwright/electron, v1.2): open fixture datapack → Export → assert the `.zip` opens, root has `pack.mcmeta` + `data/`, and Minecraft `pack_format` matches metadata.

## 12. Effort

| Piece | Est. |
|---|---|
| `export.ts` (zip + mcmeta + dialog) | ~1 day |
| IPC + preload + types | ~0.5 day |
| Renderer handlers, toasts, Build validation gate | ~1 day |
| "Build into world" destination resolver (stretch) | ~0.5 day |
| Unit tests | ~0.5 day |

~3–3.5 days for Export + Build, validation-gated, with a regression net.
