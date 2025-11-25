# Node Tests

Comprehensive test suite for the Node orchestration layer.

## Running Tests

```bash
# Run all tests
npm test

# Run only Node tests
npm test -- --grep "Node - Orchestration"

# Run with coverage
npm run test
```

## Test Coverage

### 1. Identity & Options (5 tests)
- ✅ Custom node ID
- ✅ Auto-generated node ID
- ✅ Options with node ID binding (`_id`)
- ✅ Options update
- ✅ Node ID maintenance across option updates

### 2. Handler Registration (6 tests)
- ✅ Register request handler before server exists
- ✅ Register tick handler before server exists
- ✅ Apply handlers to server when bound
- ✅ Apply handlers to new clients on connect
- ✅ Remove specific handler
- ✅ Remove all handlers for pattern

### 3. Server Lifecycle (4 tests)
- ✅ Immediate server creation (with bind address)
- ✅ Lazy server creation (bind later)
- ✅ No duplicate server on multiple bind calls
- ✅ Server unbind

### 4. Client Connections (5 tests)
- ✅ Connect to remote node
- ✅ Return existing connection if already connected
- ✅ Disconnect from remote node
- ✅ Handle disconnect from non-existent connection
- ✅ Error on invalid address

### 5. Routing - Direct (3 tests)
- ✅ Route request to connected node (upstream)
- ✅ Route tick to connected node
- ✅ Error when node not found

### 6. Routing - Filtered (requestAny, tickAny) (4 tests)
- ✅ Route to any matching node by options
- ✅ Error when no nodes match filter
- ✅ Route downstream only (`requestDownAny`)
- ✅ Route upstream only (`requestUpAny`)

### 7. Routing - Broadcast (tickAll) (2 tests)
- ✅ Send tick to all matching nodes
- ✅ Send tick to all downstream nodes (`tickDownAll`)

### 8. Options Management (2 tests)
- ✅ Propagate options to server and clients
- ✅ Filter nodes by options

### 9. Lifecycle (1 test)
- ✅ Stop node and cleanup resources

### 10. Error Handling (1 test)
- ✅ Emit error events

## Test Architecture

```
Node Tests
├── Unit Tests (Identity, Handlers, Lifecycle)
│   └── Test individual node features in isolation
│
└── Integration Tests (Routing, Connections)
    └── Test multi-node communication and routing
```

## Key Test Patterns

### 1. Handler Registration Before Server/Client Creation

```javascript
const node = new Node({ id: 'test' })

// Register handlers BEFORE server exists
node.onRequest('user.get', handler)

// Bind server later - handlers automatically applied
await node.bind('tcp://localhost:5000')
```

### 2. Smart Routing

```javascript
// Direct routing
await node.request({ to: 'node-2', event: 'test' })

// Filter-based routing
await node.requestAny({ 
  event: 'task.process',
  filter: { options: { role: 'worker' } }
})

// Broadcast
await node.tickAll({ 
  event: 'metrics',
  filter: { options: { role: 'monitor' } }
})
```

### 3. Upstream/Downstream Routing

```javascript
// node1 → connects to → node2
//   ↑                      ↑
//  client               server

// Node1 perspective:
await node1.requestUpAny({ ... })    // Request to node2 (upstream)

// Node2 perspective:
await node2.requestDownAny({ ... })  // Request to node1 (downstream)
```

## Test Scenarios

### Scenario 1: Mesh Network
```
Node A ←→ Node B
  ↓
Node C

- A connects to B (upstream)
- C connects to A (downstream)
- Test routing in all directions
```

### Scenario 2: Worker Pool
```
Client Node
  ├→ Worker 1 (role: worker)
  ├→ Worker 2 (role: worker)
  └→ Worker 3 (role: worker)

- Client uses requestAny with filter
- Random selection from matching workers
```

### Scenario 3: Broadcast
```
Master Node
  ├→ Monitor 1
  ├→ Monitor 2
  └→ Monitor 3

- Master broadcasts metrics to all monitors
- Uses tickAll with filter
```

## Running Specific Test Suites

```bash
# Identity tests only
npm test -- --grep "Identity & Options"

# Handler tests only
npm test -- --grep "Handler Registration"

# Routing tests only
npm test -- --grep "Routing"

# Connection tests only
npm test -- --grep "Client Connections"
```

## Test Utilities

### waitForEvent(emitter, event, timeout)
Wait for an event to be emitted with timeout protection.

### wait(ms)
Simple promise-based delay for timing-sensitive tests.

## Notes

- Tests use localhost addresses (tcp://127.0.0.1:700X)
- Each test cleans up nodes in `afterEach`
- Tests wait 200-500ms for connections to stabilize
- All tests have 10-second timeout (configured in package.json)

## Coverage Goals

- ✅ 100% of public API methods
- ✅ All routing strategies
- ✅ Error conditions
- ✅ Edge cases (duplicate connections, non-existent nodes, etc.)

## Future Test Additions

- [ ] Reconnection scenarios
- [ ] Large-scale mesh networks (10+ nodes)
- [ ] Performance/stress tests
- [ ] Options sync propagation
- [ ] Custom load balancing strategies

