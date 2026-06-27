# Unit Testing Plan — MCFunction++

Scope of this plan: **pure-logic units first** (no DOM, no Electron, no React). CI wiring is deferred to a documented follow-up. The goal is a fast, deterministic `npm test` that gates the framework-free core of the app.

---

## 1. Current state

- No test runner, no `test` script, no test files anywhere in `src/`.
- Stack is already Vite + TypeScript (ESM), so the runner choice is effectively decided.
- The codebase has a clean band of pure / near-pure functions that need **zero** mocking. These are the first targets.

## 2. Runner: Vitest

Use **Vitest**. Rationale:

- Reuses the existing `vite.config` resolution, ESM, and `tsc` path setup — near-zero config.
- Jest-compatible API (`describe`/`it`/`expect`) with native TS + ESM, no Babel.
- `environment: 'node'` for everything in this phase (no jsdom needed until renderer scope).
- Built-in coverage via `v8`.

Install:

```bash
npm i -D vitest @vitest/coverage-v8
```

`package.json` scripts:

```jsonc
"test":          "vitest run",
"test:watch":    "vitest",
"test:coverage": "vitest run --coverage"
```

`vitest.config.ts` (root):

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/shared/**', 'src/main/*-parser.ts', 'src/main/fileops.ts', 'src/renderer/utils.ts', 'src/renderer/mcfunction-language/**'],
      thresholds: { lines: 80, functions: 80, branches: 70 },
    },
  },
})
```

Convention: co-locate tests as `<module>.test.ts` next to the source (e.g. `src/shared/utils.test.ts`). Co-location keeps imports short and makes missing coverage visually obvious in the tree.

## 3. Targets, in priority order

Ordered by value-to-effort. Everything here is synchronous or trivially async pure logic — deterministic and fast.

### Tier 1 — pure, zero dependencies (do first)

| Module | Functions under test | Why it matters |
|---|---|---|
| `src/shared/utils.ts` | `isDottedNumericVersion`, `compareDottedVersions` | Drives version ordering / update logic. Tiny, high blast radius. |
| `src/renderer/utils.ts` | `normalizePathSeparators`, `trimPathSlashes`, `getPathSegments`, `getPathLeafName`, `getDirFromPath`, `toRelativePaths`, `createFileKey`, `parseFileKey` | Path string handling used everywhere in the tree UI. Pure string in/out. |
| `src/renderer/mcfunction-language/parse-utils.ts` | `tokenizeCommandWithRanges`, `getRootCommandTokens`, `getQuotedRanges`, `isInQuotedRange`, `collectEntityTagsFromNbt` | Core of the language layer; pure functions over strings. |

### Tier 2 — pure with structured data

| Module | Functions under test | Notes |
|---|---|---|
| `src/main/workspace-parser.ts` | `getWorkspaceFilePath`, `toRelativeWorkspaceDatapackPath`, `toAbsoluteWorkspaceDatapackPath`, `normalizeWorkspaceData`, `createDefaultWorkspace`, `addDatapackPath`, `removeDatapackPath`, `setDatapackPaths`, `getDatapackPaths` | Test the non-`fs` functions directly. For `parseWorkspaceFile`/`writeWorkspaceFile` see §4. `normalizeWorkspaceData(unknown)` deserves heavy malformed-input coverage. |
| `src/main/datapack-parser.ts` | `getDatapackMetadataPath`, `createDefaultDatapackMetadata`, `updateDatapackLastOpened` | Same split — pure functions now, `fs` ones later. |
| `src/renderer/mcfunction-language/shared.ts` | `normalizeCommandToken`, `resolveRedirectNode`, `getEffectiveChildren`, `tokenizeCommand`, `resolveNodeForTokens` | Schema-tree navigation. Feed small hand-built `CommandSchemaRoot` fixtures. |

### Tier 3 — security-critical (high value, needs a refactor first)

`src/main/fileops.ts` holds the path-allowlist enforcement, but the validators are **not exported**: `isInvalidFilename`, `isInvalidPathSegment`, `isInvalidDirectory`, `isValidFileAccess`, `isPathWithinRoot`, `assertPathAllowedForFileOperation`. These are the highest-value things to test (traversal escapes, reserved Windows device names, null bytes, deny-by-default when no roots) and currently untestable in isolation.

**Refactor:** extract the validators into `src/main/path-validation.ts` with explicit exports, and re-import them in `fileops.ts`. No behavior change, pure move. Then unit-test `path-validation.ts` directly. This also shrinks the 844-line `fileops.ts` and isolates the security boundary in one auditable file.

## 4. Handling `fs` and Electron without integration tests

Several parser functions wrap `node:fs/promises`. To keep this phase free of real disk I/O:

- Prefer testing the **pure** counterpart that the `fs` function delegates to (the split is already mostly there — e.g. `normalizeWorkspaceData` vs `parseWorkspaceFile`).
- For the thin `fs` wrappers, mock with `vi.mock('node:fs/promises')` and assert the wrapper passes the right path / parses the right payload. Keep these few.
- Anything importing `electron` stays out of scope this phase. Do **not** pull `main.ts`, `preferences.ts`, `auto-updater.ts`, or `minecraft-data.ts` into unit tests — they need an Electron/IPC harness that belongs to a later integration phase.

## 5. Test design conventions

- **Table-driven cases** for the validators and version compare — one `it.each` table of `[input, expected]` rows. Cheap to extend, reads as a spec.
- **Boundary focus** over happy-path volume: empty string, whitespace-only, `.`/`..`, `CON`/`COM1`/`NUL`, trailing-dot/space, null byte, mixed separators, drive letters, traversal (`../../etc`), case-insensitive Windows comparison.
- **Platform note:** `isValidFileAccess`/`isPathWithinRoot` branch on `process.platform === 'win32'`. Add cases that exercise the case-insensitive branch; where needed, stub `process.platform` per-test and restore in `afterEach`.
- **No snapshots** for logic output — assert concrete values so failures are legible.
- **Deterministic time:** `updateDatapackLastOpened` likely stamps a timestamp — inject or freeze with `vi.useFakeTimers()` so the assertion is stable.

## 6. Rollout

1. Add Vitest + config + scripts; commit one trivial test (`shared/utils.test.ts`) to prove the pipeline green. Use `[skip ci]` so it doesn't trigger a release.
2. Land Tier 1 (3 files) — fastest ROI, builds the fixture/style conventions.
3. Land Tier 2 parsers.
4. Extract `path-validation.ts`, then land Tier 3 — the security tests are the headline win.
5. Turn on coverage thresholds once Tiers 1–3 are in; tune numbers to actual.

## 7. Deferred (out of scope here)

- Renderer hooks/components (`use-workspace`, `use-datapack`, panels) → needs `jsdom` + Testing Library + a mocked `ElectronAPI`.
- IPC handler integration tests with a mocked Electron.
- Playwright E2E on the packaged NSIS build.
- CI gating: add a `test` job to `desktop-release-pipeline.yml` that must pass before publish. (Decision: local-only for now.)

---

### First test to write (proves the harness)

```ts
// src/shared/utils.test.ts
import { describe, it, expect } from 'vitest'
import { isDottedNumericVersion, compareDottedVersions } from './utils'

describe('isDottedNumericVersion', () => {
  it.each([
    ['1.21', true], [' 1.21 ', true], ['1', true],
    ['1.21-pre1', false], ['', false], ['v1.2', false], ['1..2', false],
  ])('%s -> %s', (input, expected) => {
    expect(isDottedNumericVersion(input)).toBe(expected)
  })
})

describe('compareDottedVersions', () => {
  it('orders by numeric segment, not lexically', () => {
    expect(compareDottedVersions('1.21', '1.9')).toBe(1)   // 21 > 9
  })
  it('treats missing trailing segments as 0', () => {
    expect(compareDottedVersions('1.21', '1.21.0')).toBe(0)
  })
  it('returns -1 / 0 / 1', () => {
    expect(compareDottedVersions('1.0', '2.0')).toBe(-1)
    expect(compareDottedVersions('1.0', '1.0')).toBe(0)
  })
})
```
