// This test file runs after all the others. This is where we can run the cleanup
// code that is required

import { test } from 'vitest'

test('cleanup', function () {
  // Shut down the process and any daemons
  if (process && process.exit) {
    process.exit(0)
  }
})
