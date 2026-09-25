import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['packages/**/*.test.ts', 'apps/studio/src/lib/**/*.test.ts'],
    environment: 'node',
  },
});
