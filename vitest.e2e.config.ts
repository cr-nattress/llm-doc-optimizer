import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/e2e/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    exclude: ['test/unit/**'],
    testTimeout: 30000, // Longer timeout for E2E tests
    hookTimeout: 30000,
    teardownTimeout: 5000,
    isolate: true,
    pool: 'threads'
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@test': resolve(__dirname, './test')
    }
  }
})