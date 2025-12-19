// Setup file for browser tests to inject Node.js polyfills as globals
import process from 'process'
import { Buffer } from 'buffer'

// Make Buffer and process globally available in the browser
;(globalThis as any).Buffer = Buffer
;(globalThis as any).process = process
;(globalThis as any).global = globalThis

// Ensure process.nextTick is available
if (!process.nextTick) {
  process.nextTick = function(fn: Function, ...args: any[]) {
    return Promise.resolve().then(() => fn(...args))
  }
}
