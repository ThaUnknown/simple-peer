import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  define: {
    // Define global for compatibility
    global: 'globalThis'
  },
  resolve: {
    alias: {
      // Polyfill Node.js modules for browser
      events: 'events',
      buffer: 'buffer',
      stream: 'stream-browserify',
      util: 'util',
      process: 'process/browser'
    }
  },
  optimizeDeps: {
    include: ['events', 'buffer', 'stream-browserify', 'util', 'process/browser']
  },
  test: {
    globals: true,
    testTimeout: 30000,
    hookTimeout: 30000,
    setupFiles: ['test/setup-browser.ts'],
    include: ['test/**/*.ts', 'test/**/*.js'],
    exclude: ['node_modules/**', 'test/common.ts', 'test/common.js', 'test/setup-browser.ts'],
    browser: {
      enabled: true,
      instances: [
        // Default to chromium, but can be overridden with --browser.name flag
        // Supported browsers: chromium, firefox, webkit
        { browser: 'chromium', provider: playwright() },
        { browser: 'firefox', provider: playwright() },
        { browser: 'webkit', provider: playwright() },
      ],
      headless: true
    }
  }
})
