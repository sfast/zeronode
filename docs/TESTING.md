# Testing Guide

> **Comprehensive Testing Documentation for ZeroNode**

---

## Table of Contents

- [Overview](#overview)
- [Test Coverage](#test-coverage)
- [Running Tests](#running-tests)
- [Test Structure](#test-structure)
- [Writing Tests](#writing-tests)
- [Testing Best Practices](#testing-best-practices)
- [Common Patterns](#common-patterns)
- [Troubleshooting](#troubleshooting)

---

## Overview

ZeroNode has **95%+ test coverage** across all layers with over **643 passing tests**.

### Test Stack

- **Test Runner:** Mocha
- **Assertions:** Chai (`expect` style)
- **Coverage:** c8 (native V8 coverage)
- **Async:** Fully async/await compatible

---

## Test Coverage

### Current Coverage (as of latest build)

```
File                  | % Stmts | % Branch | % Funcs | % Lines |
----------------------|---------|----------|---------|---------|
All files             |   95.3% |    89.7% |   97.9% |   95.3% |
 src/                 |   95.5% |    90.6% |    100% |   95.5% |
  node.js             |   94.5% |    87.2% |    100% |   94.5% |
  node-errors.js      |    100% |     100% |    100% |    100% |
  utils.js            |    100% |     100% |    100% |    100% |
 src/protocol/        |   92.8% |    83.1% |     96% |   92.8% |
  client.js           |   84.6% |    81.3% |    100% |   84.6% |
  server.js           |   96.9% |    92.7% |    100% |   96.9% |
  protocol.js         |   94.3% |    84.4% |   88.5% |   94.3% |
  envelope.js         |   91.1% |       68% |   95.5% |   91.1% |
 src/transport/zeromq/|   98.7% |    97.8% |    100% |   98.7% |
  router.js           |   93.8% |    97.1% |    100% |   93.8% |
  dealer.js           |    100% |    95.7% |    100% |    100% |
  socket.js           |    100% |    97.9% |    100% |    100% |
```

### Coverage by Category

| Category                    | Tests | Coverage |
|----------------------------|-------|----------|
| Node Layer                 | 89    | 94.5%    |
| Client/Server Protocol     | 127   | 92.8%    |
| Transport (ZeroMQ)         | 156   | 98.7%    |
| Envelope & Serialization   | 65    | 91.1%    |
| Error Handling             | 78    | 100%     |
| Integration Tests          | 128   | -        |
| **Total**                  | **643** | **95.3%** |

---

## Running Tests

### All Tests

```bash
# Run all tests with coverage
npm test

# Run all tests without coverage
npm run test:only
```

### Specific Test Files

```bash
# Run only Node tests
npm test test/node.test.js

# Run only Integration tests
npm test test/integration.test.js

# Run only Transport tests
npm test src/transport/zeromq/tests/
```

### Coverage Report

```bash
# Generate HTML coverage report
npm run coverage

# Open coverage report in browser
open coverage/index.html
```

### Watch Mode

```bash
# Run tests in watch mode (re-run on file changes)
npm run test:watch
```

### Benchmarks

```bash
# Run all benchmarks
npm run benchmark

# Run specific benchmark
npm run benchmark:node
npm run benchmark:client-server
npm run benchmark:router-dealer
```

---

## Test Structure

### Directory Layout

```
zeronode/
├── test/
│   ├── test-utils.js             # Shared test utilities
│   ├── node.test.js              # Node layer tests
│   ├── node-advanced.test.js     # Advanced routing tests
│   ├── node-coverage.test.js     # Coverage-focused tests
│   ├── integration.test.js       # End-to-end tests
│   ├── index.test.js             # Public API tests
│   ├── node-errors.test.js       # Error handling tests
│   ├── protocol-errors.test.js   # Protocol error tests
│   ├── utils.test.js             # Utility function tests
│   ├── utils-extended.test.js    # Extended utils tests
│   ├── envelop.test.js           # Envelope format tests
│   └── server.test.js            # Server-specific tests
├── src/protocol/tests/
│   └── client.test.js            # Client protocol tests
└── src/transport/zeromq/tests/
    ├── config.test.js            # Configuration tests
    ├── context.test.js           # Context management tests
    ├── dealer.test.js            # Dealer socket tests
    ├── router.test.js            # Router socket tests
    ├── integration.test.js       # Transport integration tests
    ├── reconnection.test.js      # Reconnection tests
    ├── socket-coverage.test.js   # Socket edge cases
    └── socket-errors.test.js     # Socket error handling
```

### Test File Structure

```javascript
import { expect } from 'chai'
import Node from '../src/node.js'
import { wait, TIMING } from './test-utils.js'

describe('Node - Feature Group', () => {
  let nodeA, nodeB, nodeC
  
  // Cleanup after each test
  afterEach(async () => {
    const nodes = [nodeA, nodeB, nodeC].filter(Boolean)
    await Promise.all(nodes.map(n => n.stop().catch(() => {})))
    await wait(TIMING.CLEANUP)
    nodeA = nodeB = nodeC = null
  })
  
  describe('Specific Feature', () => {
    it('should do something specific', async () => {
      // Arrange
      nodeA = new Node({ id: 'node-a' })
      await nodeA.bind('tcp://127.0.0.1:8000')
      
      // Act
      nodeB = new Node({ id: 'node-b' })
      await nodeB.connect({ address: 'tcp://127.0.0.1:8000' })
      
      // Assert
      expect(nodeB.getId()).to.equal('node-b')
    })
  })
})
```

---

## Writing Tests

### 1. **Use Test Utilities**

```javascript
import { wait, TIMING } from './test-utils.js'

// Centralized timing constants
TIMING.BIND_READY = 100           // Wait after bind()
TIMING.PEER_REGISTRATION = 200    // Wait after connect()
TIMING.CLEANUP = 300              // Wait after stop()
TIMING.RACE_CONDITION_BUFFER = 50 // Minimal ZMQ stability wait

// Use in tests
await nodeA.bind('tcp://127.0.0.1:8000')
await wait(TIMING.BIND_READY)  // ← Consistent timing
```

### 2. **Proper Cleanup**

```javascript
describe('My Tests', () => {
  let nodeA, nodeB
  
  // ✅ Good: Clean up after EACH test
  afterEach(async () => {
    const nodes = [nodeA, nodeB].filter(Boolean)
    await Promise.all(nodes.map(n => n.stop().catch(() => {})))
    await wait(TIMING.CLEANUP)
    nodeA = nodeB = null
  })
  
  // ❌ Bad: No cleanup (tests interfere with each other)
  it('test 1', async () => {
    nodeA = new Node({ id: 'node-a' })
    // ...no cleanup...
  })
})
```

### 3. **Test Handler Signatures**

```javascript
// ✅ Correct: onRequest uses (envelope, reply)
server.onRequest('api:user', (envelope, reply) => {
  const userId = envelope.data.id
  const tag = envelope.tag
  reply({ user: { id: userId, name: 'John' } })
})

// ✅ Correct: onTick uses (envelope)
server.onTick('log:info', (envelope) => {
  console.log(envelope.data.message)
})
```

### 4. **Handle Async Errors**

```javascript
// ✅ Good: Properly catch and assert errors
it('should timeout when no handler', async () => {
  try {
    await client.request({
      event: 'nonexistent',
      data: {},
      timeout: 500
    })
    expect.fail('Should have timed out')
  } catch (err) {
    expect(err.code).to.equal('REQUEST_TIMEOUT')
  }
})

// ❌ Bad: No error handling
it('should timeout', async () => {
  await client.request({ event: 'nonexistent', data: {} })
  // ^ Test will fail with unhandled rejection
})
```

### 5. **Use Dynamic Ports**

```javascript
// ✅ Good: Dynamic ports (avoid conflicts)
const ports = {
  a: 9000 + Math.floor(Math.random() * 1000),
  b: 9000 + Math.floor(Math.random() * 1000)
}

await nodeA.bind(`tcp://127.0.0.1:${ports.a}`)

// ❌ Bad: Fixed ports (tests can conflict)
await nodeA.bind('tcp://127.0.0.1:8000')
```

### 6. **Test Edge Cases**

```javascript
describe('Edge Cases', () => {
  it('should handle disconnect from non-connected address', async () => {
    nodeA = new Node({ id: 'node-a' })
    await nodeA.bind('tcp://127.0.0.1:8000')
    
    // Disconnect from address we never connected to
    const result = await nodeA.disconnect('tcp://127.0.0.1:9999')
    expect(result).to.be.true  // Should not throw
  })
  
  it('should handle empty filter results', async () => {
    nodeA = new Node({ id: 'node-a' })
    await nodeA.bind('tcp://127.0.0.1:8000')
    
    // Request with filter that matches no nodes
    try {
      await nodeA.requestAny({
        event: 'test',
        filter: { nonexistent: 'value' }
      })
      expect.fail('Should have rejected')
    } catch (err) {
      expect(err.code).to.equal('NO_NODES_MATCH_FILTER')
    }
  })
})
```

---

## Testing Best Practices

### 1. **One Assertion Per Test (When Possible)**

```javascript
// ✅ Good: Focused test
it('should return node ID', () => {
  const node = new Node({ id: 'test' })
  expect(node.getId()).to.equal('test')
})

// ❌ Bad: Testing multiple things
it('should work correctly', async () => {
  const node = new Node({ id: 'test' })
  expect(node.getId()).to.equal('test')
  await node.bind('tcp://127.0.0.1:8000')
  expect(node.getAddress()).to.exist
  await node.stop()
  // ... too much in one test
})
```

### 2. **Use Descriptive Test Names**

```javascript
// ✅ Good: Clear what's being tested
it('should emit PEER_JOINED when client connects', async () => { ... })
it('should timeout after 5 seconds when server does not respond', async () => { ... })

// ❌ Bad: Vague
it('should work', async () => { ... })
it('test 1', async () => { ... })
```

### 3. **Arrange, Act, Assert Pattern**

```javascript
it('should route message to correct node', async () => {
  // Arrange
  nodeA = new Node({ id: 'node-a' })
  await nodeA.bind('tcp://127.0.0.1:8000')
  
  nodeB = new Node({ id: 'node-b' })
  await nodeB.connect({ address: 'tcp://127.0.0.1:8000' })
  
  let received = false
  nodeB.onRequest('test', () => { received = true; return {} })
  
  await wait(TIMING.RACE_CONDITION_BUFFER)
  
  // Act
  await nodeA.request({ to: 'node-b', event: 'test', data: {} })
  
  // Assert
  expect(received).to.be.true
})
```

### 4. **Test Both Success and Failure Paths**

```javascript
describe('connect()', () => {
  it('should connect successfully to valid server', async () => {
    // Success path
  })
  
  it('should timeout when server does not exist', async () => {
    // Failure path
  })
  
  it('should throw when address is invalid', async () => {
    // Validation path
  })
})
```

### 5. **Avoid Test Interdependence**

```javascript
// ✅ Good: Each test is independent
it('test 1', async () => {
  nodeA = new Node({ id: 'node-a' })
  await nodeA.bind('tcp://127.0.0.1:8000')
  // ...cleanup in afterEach
})

it('test 2', async () => {
  nodeA = new Node({ id: 'node-a' })  // ← Fresh node
  await nodeA.bind('tcp://127.0.0.1:8000')
  // ...cleanup in afterEach
})

// ❌ Bad: Test 2 depends on Test 1
let nodeA  // ← Shared state
it('test 1', async () => {
  nodeA = new Node({ id: 'node-a' })
  await nodeA.bind('tcp://127.0.0.1:8000')
})

it('test 2', async () => {
  // Assumes nodeA still exists from test 1
  await nodeA.connect(...)
})
```

---

## Common Patterns

### Pattern 1: Request/Reply Test

```javascript
it('should handle request/reply', async () => {
  // Server
  server = new Node({ id: 'server' })
  await server.bind('tcp://127.0.0.1:8000')
  
  server.onRequest('api:user', (envelope) => {
    return { id: envelope.data.userId, name: 'John' }
  })
  
  // Client
  client = new Node({ id: 'client' })
  await client.connect({ address: 'tcp://127.0.0.1:8000' })
  await wait(TIMING.RACE_CONDITION_BUFFER)
  
  // Request
  const response = await client.request({
    to: 'server',
    event: 'api:user',
    data: { userId: 123 }
  })
  
  expect(response.id).to.equal(123)
  expect(response.name).to.equal('John')
})
```

### Pattern 2: Tick (Fire-and-Forget) Test

```javascript
it('should handle tick messages', async () => {
  // Server
  server = new Node({ id: 'server' })
  await server.bind('tcp://127.0.0.1:8000')
  
  let tickReceived = false
  let tickData = null
  
  server.onTick('analytics', (envelope) => {
    tickReceived = true
    tickData = envelope.data
  })
  
  // Client
  client = new Node({ id: 'client' })
  await client.connect({ address: 'tcp://127.0.0.1:8000' })
  await wait(TIMING.RACE_CONDITION_BUFFER)
  
  // Send tick
  client.tick({
    to: 'server',
    event: 'analytics',
    data: { action: 'page_view' }
  })
  
  // Wait for delivery
  await wait(200)
  
  expect(tickReceived).to.be.true
  expect(tickData.action).to.equal('page_view')
})
```

### Pattern 3: Event Listener Test

```javascript
it('should emit PEER_JOINED event', async () => {
  server = new Node({ id: 'server' })
  await server.bind('tcp://127.0.0.1:8000')
  
  let peerJoined = false
  let peerData = null
  
  server.on(NodeEvent.PEER_JOINED, (data) => {
    peerJoined = true
    peerData = data
  })
  
  client = new Node({ id: 'client' })
  await client.connect({ address: 'tcp://127.0.0.1:8000' })
  await wait(TIMING.RACE_CONDITION_BUFFER)
  
  expect(peerJoined).to.be.true
  expect(peerData.peerId).to.equal('client')
  expect(peerData.direction).to.equal('downstream')
})
```

### Pattern 4: Error Handling Test

```javascript
it('should throw NODE_NOT_FOUND error', async () => {
  nodeA = new Node({ id: 'node-a' })
  await nodeA.bind('tcp://127.0.0.1:8000')
  
  try {
    await nodeA.request({
      to: 'nonexistent-node',
      event: 'test',
      data: {}
    })
    expect.fail('Should have thrown error')
  } catch (err) {
    expect(err).to.be.instanceOf(NodeError)
    expect(err.code).to.equal(NodeErrorCode.NODE_NOT_FOUND)
    expect(err.message).to.include('nonexistent-node')
  }
})
```

### Pattern 5: Filter-Based Routing Test

```javascript
it('should route to node matching filter', async () => {
  // Server
  server = new Node({ id: 'server' })
  await server.bind('tcp://127.0.0.1:8000')
  
  // Worker 1 (idle)
  worker1 = new Node({
    id: 'worker-1',
    options: { role: 'worker', status: 'idle' }
  })
  await worker1.connect({ address: 'tcp://127.0.0.1:8000' })
  
  let worker1Called = false
  worker1.onRequest('task', () => {
    worker1Called = true
    return { result: 'done' }
  })
  
  // Worker 2 (busy)
  worker2 = new Node({
    id: 'worker-2',
    options: { role: 'worker', status: 'busy' }
  })
  await worker2.connect({ address: 'tcp://127.0.0.1:8000' })
  
  let worker2Called = false
  worker2.onRequest('task', () => {
    worker2Called = true
    return { result: 'done' }
  })
  
  await wait(TIMING.RACE_CONDITION_BUFFER)
  
  // Request with filter (only idle workers)
  await server.requestAny({
    event: 'task',
    data: {},
    filter: { role: 'worker', status: 'idle' }
  })
  
  // Only worker1 should be called
  expect(worker1Called).to.be.true
  expect(worker2Called).to.be.false
})
```

---

## Troubleshooting

### Issue 1: Tests Timeout

**Symptom:** Tests hang and eventually timeout

**Causes:**
1. Forgetting `await` on async operations
2. Event listener never fires
3. Cleanup not working

**Solutions:**

```javascript
// ✅ Fix 1: Always await async operations
await node.bind('tcp://127.0.0.1:8000')  // ← Don't forget await!

// ✅ Fix 2: Use Promise.race for event listeners
const result = await Promise.race([
  new Promise((resolve) => {
    node.once(NodeEvent.PEER_JOINED, resolve)
  }),
  wait(5000).then(() => Promise.reject(new Error('Timeout')))
])

// ✅ Fix 3: Ensure cleanup happens
afterEach(async () => {
  await Promise.all([
    node1?.stop().catch(() => {}),  // ← Catch errors
    node2?.stop().catch(() => {})
  ])
  await wait(TIMING.CLEANUP)
})
```

### Issue 2: Flaky Tests

**Symptom:** Tests pass sometimes, fail other times

**Causes:**
1. Race conditions (insufficient waits)
2. Port conflicts
3. Improper cleanup

**Solutions:**

```javascript
// ✅ Fix 1: Use proper timing constants
await node.connect({ address: 'tcp://127.0.0.1:8000' })
await wait(TIMING.RACE_CONDITION_BUFFER)  // ← Wait for ZMQ stability

// ✅ Fix 2: Use dynamic ports
const port = 9000 + Math.floor(Math.random() * 1000)
await node.bind(`tcp://127.0.0.1:${port}`)

// ✅ Fix 3: Clean up between tests
afterEach(async () => {
  // Stop ALL nodes
  // Wait for cleanup
  // Reset variables
})
```

### Issue 3: "Address Already in Use" Error

**Symptom:** `Error: Address already in use`

**Solution:**

```javascript
// ✅ Use dynamic ports
const ports = {
  server: 9000 + Math.floor(Math.random() * 1000),
  monitor: 9000 + Math.floor(Math.random() * 1000)
}

await server.bind(`tcp://127.0.0.1:${ports.server}`)
```

### Issue 4: Coverage Not Accurate

**Symptom:** Coverage report shows 0% or incorrect values

**Solution:**

```bash
# Ensure you're using c8, not nyc
npm install --save-dev c8

# Check package.json
{
  "scripts": {
    "test": "c8 mocha --exit --timeout 10000 test/**/*.test.js"
  }
}

# Check .babelrc has source maps
{
  "sourceMaps": "inline"
}
```

---

## Conclusion

ZeroNode's test suite provides:

✅ **95%+ coverage** across all layers  
✅ **643+ tests** covering edge cases  
✅ **Fast execution** (~60 seconds for full suite)  
✅ **Reliable** (proper cleanup, timing, error handling)  
✅ **Maintainable** (clear structure, utilities, patterns)  

Follow these guidelines to write high-quality tests that ensure ZeroNode remains robust and production-ready!

