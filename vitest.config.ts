import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/security/**/*.test.ts', 'tests/packaging/**/*.test.ts'],
    environment: 'happy-dom',
    restoreMocks: true,
  },
});
