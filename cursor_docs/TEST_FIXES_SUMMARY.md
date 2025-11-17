# Test Fixes Summary

## Date: 2025-11-17

## Overview
Fixed 2 failing tests after the protocol refactoring and configuration merge changes.

---

## Issues Identified and Fixed

### 1. Config Test Failure: `should ignore unknown config keys`

**File**: `src/protocol/tests/config.test.js`

#### Root Cause
The test expected `mergeProtocolConfig()` to **filter out** unknown configuration keys, but our critical bug fix changed this behavior to **preserve all** user-provided configuration keys (using the spread operator `...config`).

#### Why This Change Was Necessary
During debugging of the client timeout test, we discovered that user-provided configuration keys like `PING_INTERVAL` were being **discarded** by `mergeProtocolConfig()`. The function was only explicitly merging `BUFFER_STRATEGY`, `PROTOCOL_REQUEST_TIMEOUT`, and `DEBUG`, causing all other configuration to be lost.

**Before (buggy)**:
```javascript
export function mergeProtocolConfig(config = {}) {
  return {
    BUFFER_STRATEGY: config.BUFFER_STRATEGY ?? Globals.PROTOCOL_BUFFER_STRATEGY,
    PROTOCOL_REQUEST_TIMEOUT: config.PROTOCOL_REQUEST_TIMEOUT ?? Globals.PROTOCOL_REQUEST_TIMEOUT,
    DEBUG: config.DEBUG ?? false
    // ❌ All other config keys are lost!
  }
}
```

**After (fixed)**:
```javascript
export function mergeProtocolConfig(config = {}) {
  return {
    ...config,  // ✅ Preserve ALL user config
    BUFFER_STRATEGY: config.BUFFER_STRATEGY ?? Globals.PROTOCOL_BUFFER_STRATEGY,
    PROTOCOL_REQUEST_TIMEOUT: config.PROTOCOL_REQUEST_TIMEOUT ?? Globals.PROTOCOL_REQUEST_TIMEOUT,
    DEBUG: config.DEBUG ?? false
  }
}
```

#### Fix Applied
Updated the test to reflect the new intended behavior - that all user configuration keys should be preserved:

```javascript
it('should preserve all user config keys', () => {
  const config = mergeProtocolConfig({
    DEBUG: true,
    CUSTOM_KEY: 'should be preserved',
    PING_INTERVAL: 5000
  })
  
  expect(config).to.have.property('CUSTOM_KEY', 'should be preserved')
  expect(config).to.have.property('PING_INTERVAL', 5000)
  expect(config.DEBUG).to.be.true
})
```

---

### 2. Server Test Timeout: `should handle client timeout with very short timeout value`

**File**: `test/server.test.js`

#### Root Cause
**Race Condition**: The test was attaching the `ClientEvent.READY` listener **AFTER** calling `client.connect()`. In many cases, the READY event fires very quickly (or even synchronously), causing the event listener to miss it entirely. The test would then wait forever for a READY event that had already been emitted.

#### Symptoms
- Test timeout at 15000ms (later 10000ms)
- Mocha error: `"done()" is called; if returning a Promise, ensure it resolves`
- Debug logs showed the test was stuck at "waiting for READY..."

#### Debug Process

**Step 1**: Added comprehensive logging:
```javascript
console.log('[TEST] Connecting client...')
await client.connect(server.getAddress())
console.log('[TEST] Client connected, waiting for READY...')

await new Promise(resolve => {
  client.once(ClientEvent.READY, () => {
    console.log('[TEST] Client READY received')  // ❌ Never printed
    resolve()
  })
})
```

**Output**:
```
[TEST] Connecting client...
[TEST] Client connected, waiting for READY...
// ❌ Test hangs here forever
```

**Step 2**: Discovered that READY was being emitted **before** we attached the listener, so the Promise never resolved.

#### Fix Applied
Attach the `ClientEvent.READY` listener **BEFORE** calling `client.connect()`:

```javascript
// ✅ Attach READY listener BEFORE connecting to avoid race condition
const readyPromise = new Promise(resolve => {
  client.once(ClientEvent.READY, () => resolve())
})

await client.connect(server.getAddress())

// Wait for handshake
await readyPromise
```

#### Why This Matters
This is a common anti-pattern in event-driven systems:
1. ❌ **Wrong**: Connect → Attach Listener → Wait (listener may miss event)
2. ✅ **Correct**: Attach Listener → Connect → Wait (listener guaranteed to catch event)

---

## Additional Changes

### Test Timeout Configuration
Increased the Mocha timeout for this specific test from the default 10000ms to 15000ms because the test intentionally waits 6 seconds for a timeout to occur:

```javascript
it('should handle client timeout with very short timeout value', async function() {
  this.timeout(15000) // Increase timeout for this test (waits 6s + setup)
  // ...
})
```

---

## Test Results

### Before Fixes
```
2 failing

1) Server - Client Timeout Edge Cases
   should handle client timeout with very short timeout value:
   Error: Timeout of 10000ms exceeded

2) Protocol Configuration - mergeProtocolConfig()
   should ignore unknown config keys:
   AssertionError: expected { DEBUG: true, …(3) } to not have property 'UNKNOWN_KEY'
```

### After Fixes
```
✅ 749 passing (59s)
✅ 0 failing
```

---

## Coverage Impact

### Protocol Layer
- **Overall**: 95.65% statements
- `config.js`: **100%** statements (was 91.86%)
- `server.js`: 99.06% statements
- `client.js`: 97.34% statements

### Overall Codebase
- **Statements**: 96.29% (5464/5674)
- **Branches**: 87.51% (666/761)
- **Functions**: 97.37% (223/229)
- **Lines**: 96.29% (5464/5674)

---

## Lessons Learned

### 1. Configuration Merging Pattern
When merging user configuration with defaults, always **preserve all user keys** first, then override specific ones:

```javascript
// ✅ Correct pattern
return {
  ...userConfig,    // Preserve everything
  KEY: userConfig.KEY ?? DEFAULT  // Override specific keys with defaults
}

// ❌ Incorrect pattern
return {
  KEY: userConfig.KEY ?? DEFAULT  // Loses all other keys!
}
```

### 2. Event Listener Timing
In asynchronous systems, always attach event listeners **before** triggering the action that emits the event:

```javascript
// ✅ Correct
const promise = new Promise(resolve => {
  emitter.once('event', resolve)  // Listener attached first
})
await emitter.doAction()  // Action triggered second
await promise

// ❌ Wrong (race condition)
await emitter.doAction()  // Action may emit immediately
const promise = new Promise(resolve => {
  emitter.once('event', resolve)  // Listener may miss event
})
await promise
```

### 3. Test Debugging Strategy
When a test times out:
1. Add logging at each step to identify where it hangs
2. Check for race conditions in event handling
3. Verify Promises/callbacks are being resolved
4. Consider increasing timeout as a last resort, not first fix

---

## Files Modified

1. **`src/protocol/config.js`**
   - Fixed `mergeProtocolConfig()` to preserve all user configuration keys
   
2. **`src/protocol/tests/config.test.js`**
   - Updated test name and expectations to match new behavior
   
3. **`test/server.test.js`**
   - Fixed race condition in client timeout test
   - Increased Mocha timeout to 15000ms
   - Removed debug logging after fix

---

## Conclusion

Both test failures revealed important issues:

1. **A critical bug** in configuration merging that was silently dropping user configuration
2. **A race condition** in test setup that caused intermittent failures

The fixes not only resolved the immediate test failures but also improved the overall robustness of the configuration system and test suite.

