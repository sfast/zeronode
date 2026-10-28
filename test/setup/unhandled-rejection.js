/**
 * Unhandled Rejection Trap
 *
 * Mocha does not fail a test when a promise rejects with no handler, so a
 * fire-and-forget send that rejects would pass silently. Rethrow it: mocha
 * treats the resulting uncaught exception as a failure of the running test
 * and carries on with the rest of the suite.
 */

process.on('unhandledRejection', (reason) => {
  throw reason instanceof Error ? reason : new Error(`Unhandled promise rejection: ${String(reason)}`)
})
