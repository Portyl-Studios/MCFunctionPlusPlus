# MCFunction++ — Roadmap

_Analysis date: 2026-06-27 · Current version: 1.0.19_

## Where the project stands

A mature, single-developer Electron IDE (~20k LOC) with a genuinely strong core:

- **Custom MCFunction language** — parser, syntax highlighter, context-aware autocomplete, live linting, and context diagnostics driven by real Minecraft report data.
- **Automatic Minecraft data bootstrap** — downloads `server.jar`, runs `--reports`, and caches per-version registry/command data. This is the project's hardest-won and most differentiating capability.
- **Workspace + datapack model** — `.mpp-workspace` / `.mpp-datapack` descriptors, sandboxed file ops with a path allowlist, external file watching, datapack inspector.
- **Distribution** — Windows NSIS installer with `electron-updater` auto-update wired to GitHub Releases, plus an automated version-bump/release CI pipeline.

### Gaps found during analysis (evidence-based)

| Gap | Evidence | Impact |
|---|---|---|
| **Packaging not implemented** | `index.tsx:4675/4685` — "Build Datapack" and "Export Datapack" menu items are `disabled: true`, `onClick: undefined`. No zip/archive code anywhere. | The headline value prop ("release-ready packaging") is a stub. |
| **Zero automated tests** | No jest/vitest/playwright dep or config; no `*.test.*` files. | 20k LOC of parser/IPC/file logic with no regression safety net. |
| **Monolithic renderer** | `index.tsx` is 5,160 lines; `datapacktree.tsx` is 1,808. | Hard to maintain, onboard, or test. |
| **"Transpiler" promised, absent** | Keyword in `package.json`; no transpile logic exists. | Either drop the claim or build the feature. |
| **Web target unbuilt** | Firebase configured, but renderer assumes Electron IPC throughout. | Roadmap item, correctly deferred. |
| **Windows-only in practice** | mac/linux build configs exist but README ships Windows NSIS only. | Limits addressable audience. |

---

## Roadmap

Sequenced so the most credibility-critical gap (shipping a datapack) comes first, and a test net lands before larger refactors.

### v1.1 — Close the core loop: packaging _(highest priority)_
Make the disabled menu items real.

- **Export Datapack** → produce a spec-correct `.zip` (proper `pack.mcmeta`, `pack_format` matched to the datapack's MC version, namespace layout intact). Add `JSZip`/`archiver`, an `export-datapack` IPC channel, and a progress/result toast.
- **Build Datapack** → validate-then-package: run the full diagnostic scan, block (or warn) on errors, then export. Surface a build report.
- Add "export to active Minecraft `saves/<world>/datapacks/`" as a one-click dev convenience.

### v1.2 — Confidence: testing + diagnostics depth
- Introduce **Vitest** for the language layer first (parser, `context.ts`, autocomplete, diagnostics) — pure functions, highest ROI. Seed fixtures from cached report data.
- Add **Playwright/electron** smoke tests for open-workspace → edit → export.
- Wire tests into the release pipeline as a gate before publish.
- Expand diagnostics: unresolved function/tag references across files, selector and NBT path validation, unused-function hints.

### v1.3 — Authoring power features
- Project-wide **find & replace** and **go-to-definition / find-references** for functions, tags, and resource IDs.
- **Rename refactor** across the datapack (function moves update `#tag` references and `function` calls).
- Snippet library + command templates for common patterns (raycasts, scoreboard scaffolds, scheduler loops).
- Optional: a `.mcfunction` **formatter** and format-on-save.

### v1.4 — Maintainability refactor
- Decompose `index.tsx` into feature modules (editor, menus, panels, command palette) and split `datapacktree.tsx`. Do this _after_ tests exist so behavior is pinned.
- Extract a shared "platform" interface so file/IPC access sits behind one boundary — the seam the web target will need.

### v2.0 — Reach: cross-platform + web
- Ship **macOS and Linux** builds through the existing electron-builder configs; extend CI matrix and code-signing/notarization.
- Begin the **web target** against the v1.4 platform abstraction: in-browser editing with File System Access API or a virtual FS; server-side or precomputed Minecraft data (the `--reports` step can't run client-side).

### Continuous / cross-cutting
- Keep the Minecraft data bootstrap current as new MC versions and `pack_format`s ship; surface version-compat warnings in the UI.
- `CONTRIBUTING.md`, architecture doc, and a public changelog now that releases are automated.
- Telemetry-free crash/error reporting (opt-in) to catch field issues.

---

## Suggested next step
v1.1 packaging is the single highest-leverage item — it converts the product from "smart editor" to "ships datapacks," which is the promise in the tagline. Everything else builds on a working export.
