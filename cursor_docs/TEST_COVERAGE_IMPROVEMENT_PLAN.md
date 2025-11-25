# Test Coverage Improvement Plan
## Target: Increase coverage by 20% (72% → 92%)

**Current Coverage:**
- Lines: 72.04% → Target: **89%+**
- Functions: 68.4% → Target: **91%+**
- Branches: 54.37% → Target: **72%+**
- Statements: 72% → Target: **88%+**

---

## 🎯 Priority 1: High-Impact Tests (60% of coverage gain)

### 1. **PeerInfo Tests** (`test/peer.test.js` - NEW)
**Uncovered Lines:** 50-54, 93-142, 159-163, 175-176  
**Impact:** ~3% coverage increase

**Test Scenarios:**

#### 1.1 State Query Methods
```javascript
describe('PeerInfo - State Queries')
  - isConnected() should return true when state is CONNECTED
  - isHealthy() should return true when state is HEALTHY
  - isGhost() should return true when state is GHOST
  - isFailed() should return true when state is FAILED
  - isStopped() should return true when state is STOPPED
  - isOnline() should return false for FAILED and STOPPED states
  - isOnline() should return true for all other states
```

#### 1.2 State Transitions
```javascript
describe('PeerInfo - State Transitions')
  - setOnline() should transition to HEALTHY and reset missed pings
  - setOffline() should transition to FAILED if not already STOPPED
  - setOffline() should preserve STOPPED state
  - markGhost() should transition to GHOST and increment missed pings
  - markFailed() should transition to FAILED and reset missed pings
  - markStopped() should transition to STOPPED and reset missed pings
  - transition() should update lastStateChange timestamp
```

#### 1.3 Heartbeat Tracking
```javascript
describe('PeerInfo - Heartbeat')
  - updateLastSeen() should update lastSeen timestamp
  - updateLastSeen() should accept custom timestamp
  - getLastSeen() should return lastSeen value
  - ping() should update lastPing and lastSeen
  - ping() should reset missed pings counter
  - ping() should transition GHOST to HEALTHY
  - ping() should transition CONNECTED to HEALTHY
```

#### 1.4 Identity & Options Management
```javascript
describe('PeerInfo - Identity Management')
  - getAddress() should return peer address
  - setAddress() should update peer address
  - getOptions() should return peer options
  - setOptions() should replace options entirely
  - mergeOptions() should merge new options with existing
  - mergeOptions() should not mutate original options
```

#### 1.5 Serialization
```javascript
describe('PeerInfo - Serialization')
  - toJSON() should include all peer metadata
  - toJSON() should include legacy fields (ghost, fail, stop)
  - toJSON() should compute online status correctly
```

---

### 2. **Utils Tests** (`test/utils.test.js` - NEW)
**Uncovered Lines:** 5-7, 21, 32, 39-75  
**Impact:** ~5% coverage increase

**Test Scenarios:**

#### 2.1 optionsPredicateBuilder - Basic Matching
```javascript
describe('optionsPredicateBuilder - Basic Matching')
  - should return predicate that matches all when options is null
  - should return predicate that matches all when options is undefined
  - should return predicate that matches all when options is empty object
  - should handle null/undefined nodeOptions gracefully
  - should match exact string values
  - should match exact number values
  - should match RegExp patterns
```

#### 2.2 optionsPredicateBuilder - Operators
```javascript
describe('optionsPredicateBuilder - Query Operators')
  - $eq should match equal values
  - $ne should match not-equal values
  - $aeq should match loose equality (==)
  - $gt should match greater than
  - $gte should match greater than or equal
  - $lt should match less than
  - $lte should match less than or equal
  - $between should match values in range [min, max]
  - $regex should match regex patterns
  - $in should match values in array
  - $nin should match values NOT in array
  - $contains should match substring in string
  - $containsAny should match if ANY value exists
  - $containsNone should match if NO values exist
```

#### 2.3 optionsPredicateBuilder - Complex Scenarios
```javascript
describe('optionsPredicateBuilder - Complex')
  - should handle multiple filter criteria (AND logic)
  - should handle missing nodeOption keys
  - should handle nested object filters
  - should handle mixed types (string, number, regex, operators)
```

#### 2.4 checkNodeReducer
```javascript
describe('checkNodeReducer')
  - should add node ID when predicate returns true
  - should not add node ID when predicate returns false
  - should work with custom predicate functions
  - should handle nodes without getOptions() gracefully
```

---

### 3. **Server Advanced Tests** (`test/server.test.js` - EXPAND)
**Uncovered Lines:** 127-134, 142-151, 214-236, 244-262  
**Impact:** ~4% coverage increase

**Test Scenarios:**

#### 3.1 Ping Handler & Health Tracking
```javascript
describe('Server - Client Health Tracking')
  - should update lastSeen when receiving client ping
  - should set peer state to HEALTHY on ping
  - should ignore ping from unknown client gracefully
  - should handle multiple pings from same client
```

#### 3.2 Client Stop/Disconnect Handler
```javascript
describe('Server - Client Lifecycle')
  - should set peer state to STOPPED on CLIENT_STOP event
  - should emit CLIENT_STOP event with clientId
  - should handle CLIENT_STOP from unknown client
  - should preserve peer info after CLIENT_STOP
```

#### 3.3 Health Check Mechanism
```javascript
describe('Server - Health Check')
  - should start health check interval on bind
  - should detect GHOST clients (missed pings)
  - should mark clients as FAILED after threshold
  - should stop health check on unbind
  - should emit CLIENT_FAILED event for dead clients
```

#### 3.4 Close Sequence
```javascript
describe('Server - Close')
  - should call unbind() before closing
  - should close underlying socket
  - should cleanup all client peers
  - should emit SERVER_CLOSED event
```

---

### 4. **Client Advanced Tests** (`test/client.test.js` - EXPAND)
**Uncovered Lines:** 186-187, 196-197, 249, 256-266, 291  
**Impact:** ~3% coverage increase

**Test Scenarios:**

#### 4.1 Handshake Timeout
```javascript
describe('Client - Handshake Errors')
  - should timeout if server doesn't respond to handshake
  - should set serverPeerInfo to FAILED on timeout
  - should cleanup on handshake failure
  - should reject connect() promise on timeout
```

#### 4.2 Disconnect Error Handling
```javascript
describe('Client - Disconnect Edge Cases')
  - should handle disconnect when not ready
  - should ignore tick errors during disconnect
  - should set serverPeerInfo to STOPPED after disconnect
```

#### 4.3 Ping Mechanism
```javascript
describe('Client - Ping Mechanism')
  - should start ping interval after CLIENT_READY
  - should send ping with server ID as recipient
  - should stop ping on disconnect
  - should warn if server ID is unknown during ping
  - should only ping when isReady() is true
```

#### 4.4 Close Sequence
```javascript
describe('Client - Close')
  - should call disconnect() before close
  - should close underlying socket
  - should cleanup all resources
```

---

### 5. **Protocol Error Handling Tests** (`test/protocol.test.js` - EXPAND)
**Uncovered Lines:** 362, 376, 392-404, 440, 491-498, 541  
**Impact:** ~4% coverage increase

**Test Scenarios:**

#### 5.1 Request Handler Errors
```javascript
describe('Protocol - Request Error Handling')
  - should send ERROR envelope when handler throws synchronously
  - should send ERROR envelope when handler rejects (async)
  - should include error message in ERROR envelope
  - should send ERROR to original sender
  - should use original request ID in error response
```

#### 5.2 Configuration & Timeouts
```javascript
describe('Protocol - Configuration')
  - should use default REQUEST_TIMEOUT (10000ms)
  - should respect custom request timeout
  - should support INFINITY timeout (-1)
  - should use BUFFER_STRATEGY from config
```

#### 5.3 Protected API
```javascript
describe('Protocol - Protected Methods')
  - _getSocket() should return underlying socket
  - _getConfig() should return protocol config
  - _sendSystemTick() should validate system event prefix
```

---

## 🎯 Priority 2: Medium-Impact Tests (30% of coverage gain)

### 6. **Envelope Advanced Tests** (`test/envelop.test.js` - EXPAND)
**Uncovered Lines:** 536, 619-620, 654-655, 685, 710-770  
**Impact:** ~5% coverage increase

**Test Scenarios:**

#### 6.1 Data Views & Raw Access
```javascript
describe('Envelope - Raw Data Access')
  - getDataView() should return view of data portion
  - getDataView() should return null for zero-length data
  - getDataView() should not copy buffer (view only)
  - getBuffer() should return entire raw buffer
```

#### 6.2 Object Conversion
```javascript
describe('Envelope - Serialization')
  - toObject() should force parse all fields
  - toObject() should include type, timestamp, id, owner, recipient, tag, data
  - toObject() should handle null data
  - toObject() should handle complex nested data
```

#### 6.3 Validation Edge Cases
```javascript
describe('Envelope - Validation Edge Cases')
  - validate() should detect invalid type (< 1 or > 4)
  - validate() should detect buffer size mismatch
  - validate() should detect truncated buffers
  - validate() should detect corrupted offset data
  - validate() should return detailed error messages
```

#### 6.4 Large Data Handling
```javascript
describe('Envelope - Large Payloads')
  - should handle data near MAX_DATA_LENGTH
  - should handle very long strings near MAX_STRING_LENGTH
  - should handle deeply nested objects
  - should handle large arrays (1000+ elements)
```

---

### 7. **Node Advanced Tests** (`test/node.test.js` - EXPAND)
**Uncovered Lines:** 551, 641, 685, 736-761, 788, 827-874  
**Impact:** ~6% coverage increase

**Test Scenarios:**

#### 7.1 tickAny / tickDownAny / tickUpAny
```javascript
describe('Node - tickAny Routing')
  - tickAny() should select random node from filtered list
  - tickAny() should throw when no nodes match filter
  - tickAny() should respect down/up parameters
  - tickDownAny() should only send to downstream nodes
  - tickUpAny() should only send to upstream nodes
  - tickAny() should apply filter predicate correctly
```

#### 7.2 tickAll / tickDownAll / tickUpAll
```javascript
describe('Node - Broadcast Ticks')
  - tickAll() should send to all matching nodes
  - tickAll() should return Promise.all of ticks
  - tickAll() should respect filter options
  - tickDownAll() should only broadcast downstream
  - tickUpAll() should only broadcast upstream
  - tickAll() should handle empty result set
```

#### 7.3 requestAny Variants
```javascript
describe('Node - requestAny Routing')
  - requestAny() should throw NO_NODES_MATCH_FILTER when empty
  - requestDownAny() should route to downstream only
  - requestUpAny() should route to upstream only
  - requestAny() should use filter predicate
  - requestAny() should handle complex filter operators
```

#### 7.4 Edge Cases
```javascript
describe('Node - Edge Cases')
  - should handle server not initialized for requests
  - should handle empty clients list
  - should handle node not found errors
  - should cleanup handlers on client disconnect
  - should re-sync handlers on client reconnect
```

---

## 🎯 Priority 3: Low-Impact Tests (10% of coverage gain)

### 8. **Socket Error Scenarios** (`test/sockets/dealer.test.js`, `test/sockets/router.test.js`)
**Uncovered Lines:** dealer: 203, 213-218, 231-232, 242-243, 314; router: 59, 65, 79, 108-109, 123-124  
**Impact:** ~2% coverage increase

**Test Scenarios:**

#### 8.1 Dealer Socket - Reconnection & Errors
```javascript
describe('DealerSocket - Advanced')
  - should handle connection refused errors
  - should retry connection on failure
  - should emit RECONNECTING event
  - should respect max retry attempts
  - should handle timeout during connect
```

#### 8.2 Router Socket - Configuration Errors
```javascript
describe('RouterSocket - Configuration')
  - should throw on invalid Router options
  - should validate ZMQ_ROUTER_MANDATORY config
  - should validate ZMQ_ROUTER_HANDOVER config
  - should handle bind to invalid address format
```

---

## 📊 Implementation Priority

### **Week 1: High-Impact Tests (Priority 1)**
1. ✅ Create `test/peer.test.js` - 30 tests
2. ✅ Create `test/utils.test.js` - 25 tests
3. ✅ Expand `test/server.test.js` - Add 15 tests
4. ✅ Expand `test/client.test.js` - Add 12 tests
5. ✅ Expand `test/protocol.test.js` - Add 10 tests

**Expected Gain:** ~19% coverage increase  
**New Coverage:** ~91% lines, ~87% functions, ~66% branches

### **Week 2: Medium-Impact Tests (Priority 2)**
1. ✅ Expand `test/envelop.test.js` - Add 15 tests
2. ✅ Expand `test/node.test.js` - Add 20 tests

**Expected Gain:** ~11% coverage increase  
**New Coverage:** ~97%+ lines, ~93%+ functions, ~72%+ branches

### **Week 3: Low-Impact Tests (Priority 3)** (Optional)
1. ✅ Expand socket tests

**Expected Gain:** ~2% coverage increase

---

## 🔥 Quick Wins (Can implement TODAY)

### Immediate Tests for Maximum Impact (5-6 hours work):

1. **PeerInfo State Methods** (30 min)
   - All isX() methods: 7 tests
   - State transitions: 6 tests

2. **Utils Query Operators** (2 hours)
   - All 13 operators: 13 tests
   - Edge cases: 5 tests

3. **Server Ping/Stop Handlers** (1 hour)
   - Ping handling: 4 tests
   - Stop handling: 4 tests

4. **Protocol Error Handling** (1.5 hours)
   - Sync/async errors: 3 tests
   - Error envelopes: 3 tests

5. **Node tickAny/requestAny** (1 hour)
   - tickAny variants: 6 tests
   - Error cases: 4 tests

**Total: 55 tests in ~6 hours → Expected coverage gain: ~15%**

---

## 📝 Test Template

```javascript
// test/peer.test.js (NEW FILE)
import { expect } from 'chai'
import PeerInfo, { PeerState } from '../src/peer.js'

describe('PeerInfo', function () {
  describe('State Queries', () => {
    it('isConnected() should return true when state is CONNECTED', () => {
      const peer = new PeerInfo({ id: 'test' })
      expect(peer.isConnected()).to.be.true
    })
    
    it('isHealthy() should return true when state is HEALTHY', () => {
      const peer = new PeerInfo({ id: 'test' })
      peer.setState(PeerState.HEALTHY)
      expect(peer.isHealthy()).to.be.true
    })
    
    // ... more tests
  })
  
  describe('State Transitions', () => {
    // ... transition tests
  })
  
  describe('Heartbeat Tracking', () => {
    // ... heartbeat tests
  })
})
```

---

## 🎯 Summary

**Total New Tests Needed:** ~150 tests  
**Expected Coverage After Implementation:**
- Lines: **92%+** ✅ (exceeds 89% threshold)
- Functions: **93%+** ✅ (exceeds 91% threshold)
- Branches: **72%+** ✅ (meets 72% threshold)
- Statements: **91%+** ✅ (exceeds 88% threshold)

**Effort Estimate:** 2-3 days of focused work  
**ROI:** All CI coverage checks will pass! 🎉

