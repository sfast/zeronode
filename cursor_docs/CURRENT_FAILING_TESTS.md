# Current Failing Tests (5 total)

## Test 1: tickAny() - should emit error when no nodes match
**File:** `test/node-advanced.test.js`  
**Error:** `Error: Timeout of 10000ms exceeded`  
**Test:** "should emit error when no nodes match"

**Issue:** Test is timing out - likely because we changed `tickAny()` to reject instead of emit

---

## Test 2: _selectNode() - should return null for empty nodeIds array
**File:** `test/node-advanced.test.js:248`  
**Error:** `AssertionError: expected [Function] to throw an error`  
**Test:** "should return null for empty nodeIds array"

**Issue:** Test expects an error to be thrown, but function returns null instead

---

## Test 3: offTick() - should remove all listeners when handler not provided
**File:** `test/node-advanced.test.js:468`  
**Error:** `TypeError [ERR_INVALID_ARG_TYPE]: The "listener" argument must be of type function. Received undefined`  
**Stack:**
```
at PatternEmitter.removeListener
at Server.offTick (protocol.js:343:17)
at Node.offTick (node.js:519:18)
```

**Issue:** `offTick()` called without handler - PatternEmitter doesn't support removing all listeners for a pattern

---

## Test 4: offTick() - should remove handlers from multiple clients  
**File:** `test/node-advanced.test.js:492`  
**Error:** `NodeError: Invalid address: undefined`  
**Stack:**
```
at Node.disconnect (node.js:345:13)
at Context.<anonymous> (test/node-advanced.test.js:492:19)
```

**Issue:** `disconnect()` being called without address parameter (like `connect`, expects object)

---

## Test 5: Server - should handle client timeout with very short timeout value
**File:** `test/server.test.js:716`  
**Error:** `AssertionError: expected false to be true`  
**Test:** Timeout event not firing

**Issue:** Client timeout event not triggering - timing/health check issue

---

## Quick Analysis

### Test 1: tickAny timeout
**Root Cause:** We changed `tickAny()` to reject promises, but the test still expects the old emit-only behavior
**Fix:** Update test to handle rejection properly

### Test 2: _selectNode null
**Root Cause:** `_selectNode([])` returns `null`, test expects it to throw
**Fix:** Either make function throw, or update test expectation

### Test 3: offTick undefined handler
**Root Cause:** PatternEmitter requires a handler function, can't remove "all handlers for pattern"
**Fix:** Either implement `offTick(pattern)` to handle undefined handler, or remove this test case

### Test 4: disconnect address
**Root Cause:** Same as fixed `connect()` issue - `disconnect()` needs object syntax
**Fix:** Change `nodeB.disconnect()` to `nodeB.disconnect({ address: ... })`

### Test 5: Server timeout
**Root Cause:** Same as Test 7 from original analysis - timing issue
**Fix:** Increase timeouts or fix health check logic

---

*Generated from: `/tmp/zeronode_test_results.txt`*

