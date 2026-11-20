import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ['test/**/*.integration-spec.ts'],
    testTimeout: 20000,
    fileParallelism: false,
  },
});
