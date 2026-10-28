/**
 * Unhandled Rejection Trap
 *
 * Mocha does not fail a test when a promise rejects with no handler, so a
 * fire-and-forget send that rejects would pass silently. Rethrow it: mocha
 * treats the resulting uncaught exception as a failure of the test (or hook)
 * that is running when it fires, which is not necessarily the test that
 * leaked it, and carries on with the rest of the suite.
 *
 * A root `after` hook waits briefly so that a rejection leaking from the last
 * test still fails the run instead of being cut off by `--exit`.
 */

process.on('unhandledRejection', (reason) => {
  throw reason instanceof Error ? reason : new Error(`Unhandled promise rejection: ${String(reason)}`)
})

export const mochaHooks = {
  async afterAll () {
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}
