import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Phase 1 targets are all framework-free pure logic; no jsdom needed.
    environment: 'node',
    globals: false,
    include: ['src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/shared/**',
        'src/main/path-validation.ts',
        'src/main/workspace-parser.ts',
        'src/main/datapack-parser.ts',
        'src/renderer/utils.ts',
        'src/renderer/mcfunction-language/parse-utils.ts',
        'src/renderer/mcfunction-language/shared.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
      },
    },
  },
})
