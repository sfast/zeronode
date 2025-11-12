# Failing Tests Analysis

## Overview
**7 tests failing** - 6 in node-advanced.test.js, 1 in server.test.js

---

## Test 1: offTick - Remove all listeners
**File:** `test/node-advanced.test.js:451-472`  
**Error:** `NodeError: Invalid address: undefined`  
**Line:** 459

```javascript
it('should remove all listeners when handler not provided', async () => {
  const [portA] = getUniquePorts(1)
  const nodeA = new Node({ id: 'node-A' })
  const nodeB = new Node({ id: 'node-B' })
  testNodes.push(nodeA, nodeB)
  
  // Setup: bind() returns address when complete
  const addressA = await nodeA.bind(`tcp://127.0.0.1:${portA}`)
  await nodeB.connect(addressA)  // ❌ Line 459 - FAILS HERE
  
  // Register multiple handlers for same pattern
  const handler1 = () => {}
  const handler2 = () => {}
  nodeA.onTick('test:event', handler1)
  nodeA.onTick('test:event', handler2)
  
  // Remove all handlers for pattern (no handler specified)
  nodeA.offTick('test:event')
  
  // Verify handlers were removed (no error on duplicate removal)
  nodeA.offTick('test:event', handler1) // Should not throw
})
```

**Issue:** `addressA` is undefined - `bind()` not returning address properly

---

## Test 2: offTick - Multiple clients
**File:** `test/node-advanced.test.js:474-495`  
**Error:** `NodeError: Invalid address: undefined`  
**Line:** 483

```javascript
it('should remove handlers from multiple clients', async () => {
  const [portA] = getUniquePorts(1)
  const nodeA = new Node({ id: 'node-A' })
  const nodeB = new Node({ id: 'node-B' })
  const nodeC = new Node({ id: 'node-C' })
  testNodes.push(nodeA, nodeB, nodeC)
  
  // Setup: bind returns address, connect waits for handshake
  const addressA = await nodeA.bind(`tcp://127.0.0.1:${portA}`)
  await nodeB.connect(addressA)  // ❌ Line 483 - FAILS HERE
  await nodeC.connect(addressA)
  
  const handler = () => {}
  nodeA.onTick('test:multi', handler)
  
  // offTick should propagate to all connected clients
  nodeA.offTick('test:multi', handler)
  
  await nodeB.disconnect()
  await nodeC.disconnect()
  await nodeA.unbind()
  await wait(TIMING.DISCONNECT_COMPLETE)
})
```

**Issue:** Same - `addressA` is undefined

---

## Test 3: tickUpAll - Upstream only
**File:** `test/node-advanced.test.js:500-522`  
**Error:** `NodeError: Invalid address: undefined`  
**Line:** 511-512

```javascript
it('should send tick to upstream nodes only', async () => {
  const [portA, portB] = getUniquePorts(2)
  const nodeA = new Node({ id: 'node-A' })
  const nodeB = new Node({ id: 'node-B' })
  const nodeC = new Node({ id: 'node-C' })
  testNodes.push(nodeA, nodeB, nodeC)
  
  // Topology: B ← A → C (B=upstream, C=downstream from A's perspective)
  const addressB = await nodeB.bind(`tcp://127.0.0.1:${portB}`)
  const addressA = await nodeA.bind(`tcp://127.0.0.1:${portA}`)
  
  await nodeA.connect(addressB) // ❌ Line 511 - FAILS HERE
  await nodeC.connect(addressA) // Or line 512
  
  let receivedB = false
  let receivedC = false
  
  nodeB.onTick('upstream:test', () => { receivedB = true })
  nodeC.onTick('upstream:test', () => { receivedC = true })
  
  // tickUpAll should only send to upstream (B), not downstream (C)
  nodeA.tickUpAll({ event: 'upstream:test' })
  await wait(TIMING.MESSAGE_PROPAGATION)
  
  expect(receivedB).to.be.true
  expect(receivedC).to.be.false
})
```

**Issue:** Both `addressA` and `addressB` are undefined

---

## Test 4: requestAny with no matching nodes
**File:** `test/node-advanced.test.js:530-550`  
**Error:** `NodeError: Invalid address: undefined`  
**Line:** 538

```javascript
it('should handle requestAny with no matching nodes', async () => {
  const [portA] = getUniquePorts(1)
  const nodeA = new Node({ id: 'node-A' })
  const nodeB = new Node({ id: 'node-B', options: { type: 'worker' } })
  testNodes.push(nodeA, nodeB)
  
  // Setup
  const addressA = await nodeA.bind(`tcp://127.0.0.1:${portA}`)
  await nodeB.connect(addressA)  // ❌ Line 538 - FAILS HERE
  
  nodeB.onRequest('test:request', () => ({ result: 'ok' }))
  
  // Filter that matches no nodes
  const error = await nodeA.requestAny({
    event: 'test:request',
    filter: (node) => node.options?.type === 'manager' // No nodes match
  }).catch(e => e)
  
  expect(error).to.be.an('error')
  expect(error.code).to.equal('NO_NODES_MATCH_FILTER')
})
```

**Issue:** `addressA` is undefined

---

## Test 5: tickAny with no matching nodes
**File:** `test/node-advanced.test.js:552-573`  
**Error:** `NodeError: Invalid address: undefined`  
**Line:** 560

```javascript
it('should handle tickAny with no matching nodes', async () => {
  const [portA] = getUniquePorts(1)
  const nodeA = new Node({ id: 'node-A' })
  const nodeB = new Node({ id: 'node-B', options: { region: 'us' } })
  testNodes.push(nodeA, nodeB)
  
  // Setup
  const addressA = await nodeA.bind(`tcp://127.0.0.1:${portA}`)
  await nodeB.connect(addressA)  // ❌ Line 560 - FAILS HERE
  
  let received = false
  nodeB.onTick('test:tick', () => { received = true })
  
  // Filter that matches no nodes
  const error = await nodeA.tickAny({
    event: 'test:tick',
    filter: (node) => node.options?.region === 'eu' // No match
  }).catch(e => e)
  
  expect(error).to.be.an('error')
  expect(error.code).to.equal('NO_NODES_MATCH_FILTER')
  expect(received).to.be.false
})
```

**Issue:** `addressA` is undefined

---

## Test 6: tickAll with filter (no matches)
**File:** `test/node-advanced.test.js:576-597`  
**Error:** `NodeError: Invalid address: undefined`  
**Line:** 584

```javascript
it('should handle tickAll with filter that matches no nodes', async () => {
  const [portA] = getUniquePorts(1)
  const nodeA = new Node({ id: 'node-A' })
  const nodeB = new Node({ id: 'node-B', options: { env: 'prod' } })
  testNodes.push(nodeA, nodeB)
  
  // Setup
  const addressA = await nodeA.bind(`tcp://127.0.0.1:${portA}`)
  await nodeB.connect(addressA)  // ❌ Line 584 - FAILS HERE
  
  let received = false
  nodeB.onTick('test:broadcast', () => { received = true })
  
  // Filter that matches no nodes
  nodeA.tickAll({
    event: 'test:broadcast',
    filter: (node) => node.options?.env === 'staging'
  })
  await wait(TIMING.MESSAGE_PROPAGATION)
  
  // tickAll doesn't throw on empty results, just sends to zero nodes
  expect(received).to.be.false
})
```

**Issue:** `addressA` is undefined

---

## Test 7: Server client timeout
**File:** `test/server.test.js:689-720`  
**Error:** `AssertionError: expected false to be true`  
**Line:** 716

```javascript
it('should handle client timeout with very short timeout value', async () => {
  server = new Server({ 
    id: 'test-server',
    config: { 
      clientTimeout: 200,  // Increased from 50ms for reliability
      healthCheckInterval: 50 
    }
  })
  await server.bind('tcp://127.0.0.1:0')
  
  const client = new Client({ id: 'test-client' })
  await client.connect(server.getAddress())
  
  await wait(150) // Wait for handshake
  
  // Stop client ping to trigger timeout
  client._stopPing()
  
  let timeoutFired = false
  server.once(ServerEvent.CLIENT_TIMEOUT, ({ clientId }) => {
    expect(clientId).to.equal('test-client')
    timeoutFired = true
  })
  
  // Wait for timeout to trigger (200ms timeout + health check)
  await wait(350)
  
  expect(timeoutFired).to.be.true  // ❌ Line 716 - FAILS (timeoutFired is false)
  
  await client.disconnect()
  await wait(50)
})
```

**Issue:** Timeout event not firing - timing issue

---

## Root Cause Analysis

### Tests 1-6: Common Issue
**Pattern:** All fail with `NodeError: Invalid address: undefined`  
**Root Cause:** `Node.bind()` not returning address in "Additional Coverage" tests

**Why it fails:**
```javascript
const addressA = await nodeA.bind(`tcp://127.0.0.1:${portA}`)
// addressA = undefined (expected: 'tcp://127.0.0.1:8xxx')
await nodeB.connect(addressA)  // ❌ Fails - can't connect to undefined
```

**Investigation needed:**
1. Check if `Node.bind()` actually returns address (we tested manually - it does!)
2. Check if there's a timing issue in these specific tests
3. Check if the `testNodes` array pattern affects it
4. Possible race condition in cleanup/port reuse

### Test 7: Timing Issue
**Pattern:** Client timeout event not firing  
**Root Cause:** Health check timing calculation incorrect

**Why it fails:**
- Client timeout: 200ms
- Health check interval: 50ms
- Wait time: 350ms
- Expected: Timeout fires after ~250ms (200 + 50)
- Actual: Not firing at all

**Possible causes:**
1. `_stopPing()` might not exist or not work as expected
2. Health check might not run when expected
3. Server might not be checking timeouts correctly
4. Timing might need to be even longer

---

## Quick Fix Strategy

### For Tests 1-6 (Address Issue)
**Option A:** Add logging to debug
```javascript
const addressA = await nodeA.bind(`tcp://127.0.0.1:${portA}`)
console.log('DEBUG: addressA =', addressA)  // Add this
await nodeB.connect(addressA)
```

**Option B:** Use getAddress() explicitly
```javascript
await nodeA.bind(`tcp://127.0.0.1:${portA}`)
const addressA = nodeA.getAddress()  // Fallback
await nodeB.connect(addressA)
```

**Option C:** Add small wait after bind
```javascript
await nodeA.bind(`tcp://127.0.0.1:${portA}`)
await wait(50)  // Let bind fully complete
const addressA = nodeA.getAddress()
await nodeB.connect(addressA)
```

### For Test 7 (Timeout)
**Option A:** Increase wait time
```javascript
await wait(500)  // Increase from 350ms
```

**Option B:** Check if _stopPing exists
```javascript
if (typeof client._stopPing === 'function') {
  client._stopPing()
} else {
  // Alternative way to stop ping
}
```

**Option C:** Use waitForEvent helper
```javascript
await waitForEvent(server, ServerEvent.CLIENT_TIMEOUT, 1000)
```

---

## Recommended Next Steps

1. **Run Test 1 with debug logging** to see what `bind()` returns
2. **Check if issue is in testNodes cleanup** affecting port reuse
3. **Verify _stopPing() method exists** in Client class
4. **Increase timeout wait times** for more reliability

