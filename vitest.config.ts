import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    // Client preview spec declares jsdom per-file; the rest run under node.
    environment: 'node',
    // The dsh SDK ship some .ts-suffixed relative imports; tests import them
    // as regular packages so keep resolution permissive.
    server: { deps: { inline: [] } },
  },
})
