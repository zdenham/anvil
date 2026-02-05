import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'runtime/**/*.test.ts',
      '__tests__/**/*.test.ts',
    ],
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
