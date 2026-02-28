import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/ui/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    // Electron main-process tests run in Node — no DOM needed
    environmentMatchGlobs: [['tests/electron/**/*.test.ts', 'node']],
  },
});
