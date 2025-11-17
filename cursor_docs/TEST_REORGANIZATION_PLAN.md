# Test Reorganization Plan

## Current State Analysis

### Test Files Overview (20 files)

#### 1. **Node Layer Tests** (5 files - NEEDS CONSOLIDATION)
- `node.test.js` (766 lines) - Basic node orchestration
- `node-advanced.test.js` (607 lines) - Advanced routing & utilities
- `node-coverage.test.js` (343 lines) - Coverage completion
- `node-middleware.test.js` (894 lines) - Node-to-node middleware
- `node-errors.test.js` (358 lines) - Node error handling

**Issue**: Node functionality is scattered across 5 files, making it hard to find specific tests.

#### 2. **Protocol Layer Tests** (4 files - OK)
- `protocol.test.js` (207 lines) - Protocol orchestration
- `client.test.js` (177 lines) - Client-specific
- `server.test.js` (772 lines) - Server-specific
- `integration.test.js` (727 lines) - Client ↔ Server integration

**Status**: Well organized

#### 3. **Middleware Tests** (2 files - NEEDS CONSOLIDATION)
- `middleware.test.js` (504 lines) - Protocol-level middleware
- `node-middleware.test.js` (894 lines) - Node-level middleware

**Issue**: Middleware tests split unnecessarily

#### 4. **Error Tests** (2 files - OK)
- `node-errors.test.js` (358 lines) - Node errors
- `protocol-errors.test.js` (432 lines) - Protocol errors

**Status**: Well organized (by layer)

#### 5. **Transport Layer Tests** (2 files - OK)
- `transport-errors.test.js` (514 lines) - Transport errors
- `transport.test.js` (0 lines) - Empty placeholder

**Status**: OK, but remove empty file

#### 6. **Utility Tests** (2 files - OK)
- `utils.test.js` (341 lines) - Core utilities
- `utils-extended.test.js` (333 lines) - Extended utilities

**Status**: OK

#### 7. **Supporting Tests** (3 files - OK)
- `envelop.test.js` (628 lines) - Envelope serialization
- `peer.test.js` (408 lines) - Peer management
- `lifecycle-resilience.test.js` (158 lines) - Lifecycle edge cases

**Status**: Well organized

#### 8. **Meta Tests** (1 file - OK)
- `index.test.js` (259 lines) - Public API exports
- `test-utils.js` (244 lines) - Test helpers

**Status**: OK

---

## Proposed Reorganization

### ✅ Goal: Logical grouping with clear naming and informative logging

### Phase 1: Consolidate Node Tests (5 → 1 file)

**New File**: `node.test.js` (comprehensive)

**Structure**:
```
Node - Complete Test Suite
├── 1. Constructor & Identity
│   ├── ID generation
│   ├── Options management
│   └── Config passing
├── 2. Server Management (Bind)
│   ├── TCP binding
│   ├── Lazy initialization
│   ├── Multiple bind attempts
│   └── Server events
├── 3. Client Management (Connect)
│   ├── Single connection
│   ├── Multiple connections
│   ├── Duplicate detection
│   └── Connection events
├── 4. Handler Registration
│   ├── onRequest handlers
│   ├── onTick handlers
│   ├── Early registration (before bind/connect)
│   └── Late registration (after bind/connect)
├── 5. Request Routing
│   ├── Direct routing (to specific node)
│   ├── Any routing (load balancing)
│   ├── All routing (broadcasting)
│   ├── Up routing (to server)
│   ├── Down routing (to clients)
│   └── Routing errors
├── 6. Tick Messages
│   ├── Direct ticks
│   ├── Broadcast ticks
│   └── Pattern matching
├── 7. Middleware Chain
│   ├── Basic middleware (auto-continue)
│   ├── Explicit next() calls
│   ├── Error handling (next(error))
│   ├── Early termination (reply without next)
│   └── Multiple pattern matching
├── 8. Filtering & Selection
│   ├── Filter by options
│   ├── getPeers() with filters
│   ├── hasPeer() checks
│   └── Edge cases (no matches)
├── 9. Error Handling
│   ├── NodeError creation
│   ├── Error codes
│   ├── Error events
│   └── Request failures
└── 10. Lifecycle & Cleanup
    ├── stop() - graceful shutdown
    ├── disconnect() - single client
    ├── disconnectAll() - all clients
    └── Memory cleanup
```

**Files to Merge**:
- ✅ Keep: `node.test.js` (as base)
- ❌ Merge into node.test.js: `node-advanced.test.js`
- ❌ Merge into node.test.js: `node-coverage.test.js`
- ❌ Merge into node.test.js: `node-middleware.test.js`
- ✅ Keep separate: `node-errors.test.js` (error class tests)

---

### Phase 2: Consolidate Middleware Tests (2 → 1 file)

**New File**: `middleware.test.js` (comprehensive)

**Structure**:
```
Middleware - Express-style Chain Execution
├── 1. Protocol-Level Middleware
│   ├── Basic chain execution
│   ├── next() explicit calls
│   ├── Error propagation
│   └── Early termination
├── 2. Node-Level Middleware
│   ├── Node-to-node middleware
│   ├── Cross-node error handling
│   ├── Broadcasting with middleware
│   └── Mixed handler types
└── 3. Advanced Patterns
    ├── Conditional middleware
    ├── Async middleware
    ├── Error recovery
    └── Pattern matching
```

**Files to Merge**:
- ✅ Keep: `middleware.test.js` (as base)
- ❌ Merge into middleware.test.js: `node-middleware.test.js`

---

### Phase 3: Add Consistent Logging

**Logging Strategy**:
```javascript
// ✅ Good: Informative logging
describe('Request Routing - Direct', () => {
  it('should route request to specific peer by ID', async () => {
    console.log('  📤 [Node A] Sending request to Node B...')
    const result = await nodeA.request({
      to: 'node-b',
      event: 'test',
      data: { value: 42 }
    })
    console.log('  ✅ [Node A] Received response:', result)
    expect(result.success).to.be.true
  })
})

// ❌ Bad: No logging or too verbose
it('test routing', async () => {
  // Silent test - hard to debug
})
```

**Logging Levels**:
- 📦 **Setup**: `console.log('  📦 [Setup] Creating nodes...')`
- 📤 **Action**: `console.log('  📤 [Node A] Sending request...')`
- ✅ **Success**: `console.log('  ✅ [Node A] Response received')`
- ❌ **Error**: `console.log('  ❌ [Node A] Request failed:', err)`
- 🧹 **Cleanup**: `console.log('  🧹 [Cleanup] Stopping nodes...')`

---

### Phase 4: Clean Up

**Files to Remove**:
- ❌ `transport.test.js` (empty placeholder)

**Files to Keep As-Is** (already well organized):
- ✅ `protocol.test.js`
- ✅ `client.test.js`
- ✅ `server.test.js`
- ✅ `integration.test.js`
- ✅ `protocol-errors.test.js`
- ✅ `transport-errors.test.js`
- ✅ `envelop.test.js`
- ✅ `peer.test.js`
- ✅ `lifecycle-resilience.test.js`
- ✅ `utils.test.js`
- ✅ `utils-extended.test.js`
- ✅ `index.test.js`
- ✅ `test-utils.js`

---

## Final Test Structure (15 files)

### By Layer:
```
├── Node Layer (2 files)
│   ├── node.test.js ⭐ CONSOLIDATED
│   └── node-errors.test.js
│
├── Protocol Layer (4 files)
│   ├── protocol.test.js
│   ├── client.test.js
│   ├── server.test.js
│   └── integration.test.js
│
├── Middleware (1 file)
│   └── middleware.test.js ⭐ CONSOLIDATED
│
├── Transport Layer (1 file)
│   └── transport-errors.test.js
│
├── Errors (2 files)
│   ├── node-errors.test.js
│   └── protocol-errors.test.js
│
├── Core Components (3 files)
│   ├── envelop.test.js
│   ├── peer.test.js
│   └── lifecycle-resilience.test.js
│
├── Utilities (2 files)
│   ├── utils.test.js
│   └── utils-extended.test.js
│
└── Meta (2 files)
    ├── index.test.js
    └── test-utils.js
```

---

## Benefits

1. ✅ **Easier Navigation**: All node tests in one place
2. ✅ **Logical Grouping**: Tests grouped by functionality
3. ✅ **Better Debugging**: Informative logging at each step
4. ✅ **Reduced Duplication**: Merge overlapping tests
5. ✅ **Clear Structure**: Consistent describe() nesting
6. ✅ **Maintainability**: Easier to add new tests

---

## Implementation Order

1. ✅ Phase 1: Consolidate Node tests (5 → 1)
2. ✅ Phase 2: Consolidate Middleware tests (2 → 1)
3. ✅ Phase 3: Add consistent logging to all tests
4. ✅ Phase 4: Remove empty files, verify all tests pass

---

## Logging Examples

### Good Test Logging

```javascript
describe('Request Routing', () => {
  describe('Direct Routing (to specific peer)', () => {
    it('should route request to peer by ID', async () => {
      console.log('  📦 [Setup] Node A (server) + Node B (client)')
      
      nodeA = new Node({ id: 'node-a' })
      await nodeA.bind('tcp://127.0.0.1:9000')
      
      nodeB = new Node({ id: 'node-b' })
      await nodeB.connect({ address: 'tcp://127.0.0.1:9000' })
      
      console.log('  📤 [Node B → Node A] Sending request "test"')
      const result = await nodeB.request({
        to: 'node-a',
        event: 'test',
        data: { value: 42 }
      })
      
      console.log('  ✅ [Node B] Response:', result)
      expect(result.success).to.be.true
    })
  })
})
```

### Output:
```
Request Routing
  Direct Routing (to specific peer)
    📦 [Setup] Node A (server) + Node B (client)
    📤 [Node B → Node A] Sending request "test"
    ✅ [Node B] Response: { success: true }
    ✓ should route request to peer by ID (125ms)
```

---

## Next Steps

1. Should I proceed with **Phase 1** (consolidate node tests)?
2. Do you want to review the structure before I start?
3. Any specific logging preferences or changes to the plan?

