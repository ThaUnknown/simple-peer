import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    testTimeout: 20000,
    hookTimeout: 20000,
    include: ['test/**/*.ts', 'test/**/*.js'],
    exclude: ['node_modules/**', 'test/common.ts', 'test/common.js']
  }
})
