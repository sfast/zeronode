# Testing Guide

> **Comprehensive Testing Documentation for ZeroNode**

---

## Overview

ZeroNode maintains **95%+ test coverage** across all layers with **200+ passing tests**, ensuring production-ready reliability.

### Test Stack

- **Test Runner:** Mocha
- **Assertions:** Chai (`expect` style)
- **Coverage:** c8 (native V8 coverage)
- **Async:** Fully async/await compatible

---

## Test Coverage

### Coverage Summary

```
File                  | % Stmts | % Branch | % Funcs | % Lines |
----------------------|---------|----------|---------|---------|
All files             |   95.3% |    89.7% |   97.9% |   95.3% |
 src/                 |   95.5% |    90.6% |    100% |   95.5% |
 src/protocol/        |   92.8% |    83.1% |     96% |   92.8% |
 src/transport/zeromq/|   98.7% |    97.8% |    100% |   98.7% |
```

### Coverage by Layer

| Layer | Coverage | Critical Paths |
|-------|----------|----------------|
| **Node Layer** | 94.5% | Request/response, routing, filtering |
| **Protocol Layer** | 92.8% | Envelope serialization, middleware |
| **Transport Layer** | 98.7% | Socket lifecycle, reconnection |
| **Error Handling** | 100% | All error codes and propagation |

---

## Running Tests

### Quick Start

```bash
# Run all tests with coverage
npm test

# Run without coverage (faster)
npm run test:only

# Watch mode (re-run on changes)
npm run test:watch
```

### Specific Test Files

```bash
# Node layer tests
npm test test/node.test.js

# Middleware tests
npm test test/node-middleware.test.js

# Integration tests
npm test test/integration.test.js

# Transport layer tests
npm test src/transport/zeromq/tests/
```

### Coverage Reports

```bash
# Generate HTML coverage report
npm run coverage

# Open in browser
open coverage/index.html
```

---

## Test Structure

### Directory Layout

```
zeronode/
├── test/
│   ├── test-utils.js             # Shared utilities & timing
│   ├── node.test.js              # Core Node functionality
│   ├── node-middleware.test.js   # Middleware chain tests
│   ├── node-advanced.test.js     # Advanced routing
│   ├── node-coverage.test.js     # Edge case coverage
│   ├── integration.test.js       # End-to-end scenarios
│   ├── client.test.js            # Client protocol tests
│   ├── envelop.test.js           # Envelope serialization
│   └── *-errors.test.js          # Error handling tests
└── src/transport/zeromq/tests/
    ├── router.test.js            # Router socket tests
    ├── dealer.test.js            # Dealer socket tests
    ├── integration.test.js       # Transport integration
    └── reconnection.test.js      # Connection recovery
```

---

## Writing Tests

### 1. Use Test Utilities

```javascript
import { wait, TIMING } from './test-utils.js'

// Centralized timing constants
await nodeA.bind('tcp://127.0.0.1:8000')
await wait(TIMING.BIND_READY)  // 100ms for socket stability

await nodeB.connect({ address: 'tcp://127.0.0.1:8000' })
await wait(TIMING.PEER_REGISTRATION)  // 200ms for handshake
```

### 2. Proper Cleanup

```javascript
describe('My Tests', () => {
  let nodeA, nodeB
  
  afterEach(async () => {
    const nodes = [nodeA, nodeB].filter(Boolean)
    await Promise.all(nodes.map(n => n.stop().catch(() => {})))
    await wait(TIMING.CLEANUP)
    nodeA = nodeB = null
  })
})
```

### 3. Test Handler Signatures

```javascript
// Request handler: (envelope, reply)
server.onRequest('api:user', (envelope, reply) => {
  reply({ user: { id: envelope.data.id } })
})

// Middleware: (envelope, reply, next)
server.onRequest(/^api:/, (envelope, reply, next) => {
  if (!envelope.data.token) {
    return reply.error(new Error('Unauthorized'))
  }
  next()
})

// Tick handler: (envelope)
server.onTick('log:info', (envelope) => {
  console.log(envelope.data.message)
})
```

### 4. Handle Async Errors

```javascript
it('should timeout when no handler exists', async () => {
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
```

### 5. Use Dynamic Ports

```javascript
// Avoid port conflicts in parallel test runs
const port = 9000 + Math.floor(Math.random() * 1000)
await nodeA.bind(`tcp://127.0.0.1:${port}`)
```

---

## Common Test Patterns

### Pattern 1: Request/Reply

```javascript
it('should handle request/reply', async () => {
  // Server setup
  server = new Node({ id: 'server' })
  await server.bind('tcp://127.0.0.1:8000')
  
  server.onRequest('api:user', (envelope, reply) => {
    reply({ id: envelope.data.userId, name: 'John' })
  })
  
  // Client setup
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

### Pattern 2: Middleware Chain

```javascript
it('should execute middleware chain', async () => {
  server = new Node({ id: 'server' })
  await server.bind('tcp://127.0.0.1:8000')
  
  const order = []
  
  // Auth middleware
  server.onRequest(/^api:/, (envelope, reply, next) => {
    order.push('auth')
    if (!envelope.data.token) {
      return reply.error(new Error('Unauthorized'))
    }
    next()
  })
  
  // Validation middleware
  server.onRequest(/^api:/, (envelope, reply, next) => {
    order.push('validation')
    if (!envelope.data.id) {
      return reply.error(new Error('Missing ID'))
    }
    next()
  })
  
  // Handler
  server.onRequest('api:user', (envelope, reply) => {
    order.push('handler')
    reply({ success: true })
  })
  
  client = new Node({ id: 'client' })
  await client.connect({ address: 'tcp://127.0.0.1:8000' })
  await wait(TIMING.RACE_CONDITION_BUFFER)
  
  const response = await client.request({
    to: 'server',
    event: 'api:user',
    data: { token: 'abc', id: 123 }
  })
  
  expect(order).to.deep.equal(['auth', 'validation', 'handler'])
  expect(response.success).to.be.true
})
```

### Pattern 3: Event Listener

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
})
```

### Pattern 4: Error Handling

```javascript
it('should handle errors with 4-param handler', async () => {
  server = new Node({ id: 'server' })
  await server.bind('tcp://127.0.0.1:8000')
  
  // Middleware that throws
  server.onRequest(/^api:/, (envelope, reply, next) => {
    next(new Error('Auth failed'))
  })
  
  // Error handler (4 params)
  server.onRequest(/^api:/, (error, envelope, reply, next) => {
    reply.error({ message: error.message, code: 'AUTH_ERROR' })
  })
  
  client = new Node({ id: 'client' })
  await client.connect({ address: 'tcp://127.0.0.1:8000' })
  await wait(TIMING.RACE_CONDITION_BUFFER)
  
  try {
    await client.request({
      to: 'server',
      event: 'api:user',
      data: {}
    })
    expect.fail('Should have thrown')
  } catch (err) {
    expect(err.message).to.include('Auth failed')
  }
})
```

---

## Testing Best Practices

### 1. One Focus Per Test

```javascript
// ✅ Good: Focused on one thing
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
  // ... too much
})
```

### 2. Descriptive Test Names

```javascript
// ✅ Good
it('should emit PEER_JOINED when client connects', async () => { ... })
it('should timeout after 5 seconds when server does not respond', async () => { ... })

// ❌ Bad
it('should work', async () => { ... })
it('test 1', async () => { ... })
```

### 3. Arrange, Act, Assert

```javascript
it('should route message to correct node', async () => {
  // Arrange
  nodeA = new Node({ id: 'node-a' })
  await nodeA.bind('tcp://127.0.0.1:8000')
  
  nodeB = new Node({ id: 'node-b' })
  await nodeB.connect({ address: 'tcp://127.0.0.1:8000' })
  await wait(TIMING.RACE_CONDITION_BUFFER)
  
  // Act
  const response = await nodeA.request({
    to: 'node-b',
    event: 'test',
    data: {}
  })
  
  // Assert
  expect(response).to.exist
})
```

### 4. Test Both Success and Failure

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

---

## Troubleshooting

### Tests Timeout

**Causes:**
- Missing `await` on async operations
- Event listener never fires
- Cleanup not working

**Solutions:**

```javascript
// ✅ Always await async operations
await node.bind('tcp://127.0.0.1:8000')

// ✅ Use Promise.race for events with timeout
const result = await Promise.race([
  new Promise((resolve) => {
    node.once(NodeEvent.PEER_JOINED, resolve)
  }),
  wait(5000).then(() => Promise.reject(new Error('Timeout')))
])

// ✅ Ensure cleanup happens
afterEach(async () => {
  await Promise.all([
    node1?.stop().catch(() => {}),
    node2?.stop().catch(() => {})
  ])
  await wait(TIMING.CLEANUP)
})
```

### Flaky Tests

**Causes:**
- Race conditions (insufficient waits)
- Port conflicts
- Improper cleanup

**Solutions:**

```javascript
// ✅ Use proper timing
await node.connect({ address: 'tcp://127.0.0.1:8000' })
await wait(TIMING.RACE_CONDITION_BUFFER)

// ✅ Use dynamic ports
const port = 9000 + Math.floor(Math.random() * 1000)
await node.bind(`tcp://127.0.0.1:${port}`)

// ✅ Clean up between tests
afterEach(async () => {
  // Stop all nodes, wait, reset variables
})
```

### Address Already in Use

**Solution:**

```javascript
// Use dynamic ports for parallel test execution
const ports = {
  server: 9000 + Math.floor(Math.random() * 1000),
  monitor: 9000 + Math.floor(Math.random() * 1000)
}

await server.bind(`tcp://127.0.0.1:${ports.server}`)
```

---

## Performance Testing

For performance benchmarks and stress testing, see **[BENCHMARKS.md](./BENCHMARKS.md)**.

Quick summary:

```bash
# Run performance benchmarks
npm run benchmark

# Specific benchmark layers
npm run benchmark:node              # Application layer
npm run benchmark:client-server     # Protocol layer
npm run benchmark:router-dealer     # Transport layer
```

**Results:** 2,000+ msg/s throughput, 0.5ms average latency. See [BENCHMARKS.md](./BENCHMARKS.md) for detailed analysis.

---

## Continuous Integration

### GitHub Actions

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '22'
      - run: npm install
      - run: npm test
      - uses: codecov/codecov-action@v2
        with:
          files: ./coverage/lcov.info
```

---

## Conclusion

ZeroNode's test suite provides:

✅ **95%+ coverage** across all layers  
✅ **200+ tests** covering edge cases  
✅ **Fast execution** (~60 seconds for full suite)  
✅ **Reliable** (proper cleanup, timing, error handling)  
✅ **Maintainable** (clear structure, utilities, patterns)

Follow these guidelines to write high-quality tests that ensure ZeroNode remains robust and production-ready!
