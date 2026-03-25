import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['tests/setup/vitest.setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: [
        'src/main/workspace-parser.ts',
        'src/main/datapack-parser.ts',
        'src/renderer/mcfunction-language/parse-utils.ts',
      ],
      exclude: [
        'src/**/*.d.ts',
        'tests/**',
        'out/**',
        'release/**',
        'resources/**',
        'node_modules/**',
      ],
      thresholds: {
        lines: 60,
        functions: 60,
        statements: 60,
        branches: 45,
      },
    },
  },
})
