# Test Coverage Analysis & Improvement Plan

## Current Coverage Summary

```
Overall: 93.45%
├─ Statements:   93.45% (4541/4859)
├─ Branches:     87.29% (529/606)
├─ Functions:    96.37% (186/193)
└─ Lines:        93.45% (4541/4859)
```

---

## 🎯 Priority Areas for Coverage Improvement

### 1. **client.js** - 84.59% Coverage (HIGHEST PRIORITY)
**Target: 95%+ | Gain: ~40 statements**

#### Uncovered Scenarios:

**A. Error Handling During Disconnect (Lines 221-222)**
```javascript
} catch (err) {
  // Ignore if offline
}
```
**Test Needed:** Client disconnect while already offline/errored

**B. Ping Interval Guard (Lines 256-257)**
```javascript
if (_scope.pingInterval) {
  return
}
```
**Test Needed:** Call `_startPing()` multiple times (idempotency test)

**C. Ping Logic Edge Cases (Lines 263-281)**
```javascript
if (this.isReady()) {
  const { serverPeerInfo } = _private.get(this)
  const serverId = serverPeerInfo?.getId()
  
  if (!serverId) {
    this.logger?.warn('Cannot send ping: server ID unknown')
    return
  }
  // ... send ping
}
```
**Tests Needed:**
- Ping when client not ready (should skip)
- Ping when server ID not yet known (edge case during handshake)
- Ping with logger set (verify warning logged)

**D. Send Guard (Lines 298-299)**
```javascript
if (!socket.isOnline()) {
  return
}
```
**Test Needed:** Call `_sendClientConnected()` when socket offline

---

### 2. **socket.js** - 83.74% Coverage (SECOND PRIORITY)
**Target: 95%+ | Gain: ~40 statements**

#### Uncovered Scenarios:

**A. Malformed Message Handling (Lines 149-161)**
```javascript
// Unexpected message format - emit error but continue processing
const transportError = new TransportError({
  code: TransportErrorCode.RECEIVE_FAILED,
  message: `Unexpected message format: received ${frames.length} frames...`,
  ...
})
this.emit('error', transportError)
continue
```
**Test Needed:** Send message with unexpected frame count (1 frame, 4+ frames)

**B. EAGAIN Error Handling (Lines 170-171)**
```javascript
if (err.code === 'EAGAIN') {
  return  // Normal closure, nothing to report
}
```
**Test Needed:** Close socket during receive (should handle EAGAIN gracefully)

**C. Send Error Handling (Lines 203-210)**
```javascript
} catch (err) {
  throw new TransportError({
    code: TransportErrorCode.SEND_FAILED,
    message: `Failed to send on transport...`,
    ...
  })
}
```
**Test Needed:** Send when HWM reached, or socket in error state

**D. Socket Error Event (Lines 226-239)**
```javascript
socket.events.on('error', (err) => {
  const transportError = new TransportError({ ... })
  this.emit('error', transportError)
})
```
**Test Needed:** Trigger ZeroMQ socket error event

---

### 3. **envelope.js** - 88.35% Coverage
**Target: 95%+ | Gain: ~30 statements**

#### Uncovered Scenarios:

**A. getBuffer() Method (Lines 726-727)**
```javascript
getBuffer () {
  return this._buffer
}
```
**Test Needed:** Call `getBuffer()` on parsed envelope

**B. toObject() Method (Lines 733-742)**
```javascript
toObject () {
  return {
    type: this.type,
    timestamp: this.timestamp,
    ...
  }
}
```
**Test Needed:** Call `toObject()` and verify all fields

**C. validate() Invalid Type (Lines 762-766)**
```javascript
if (type < 1 || type > 4) {
  return { valid: false, error: `Invalid envelope type: ${type}...` }
}
```
**Test Needed:** Create envelope with invalid type (0, 5, etc.)

**D. validate() Error Catch (Lines 770-771)**
```javascript
} catch (err) {
  return { valid: false, error: err.message }
}
```
**Test Needed:** Create envelope with malformed buffer (truncated, corrupted)

---

### 4. **node.js** - 93.27% Coverage
**Target: 97%+ | Gain: ~20 statements**

#### Uncovered Scenarios:

**A. offTick() - Remove All Listeners (Line 511)**
```javascript
handlerRegistry.tick.removeAllListeners(pattern)
```
**Test Needed:** Call `node.offTick(pattern)` without handler (removes all)

**B. offTick() - Client Cleanup (Line 520)**
```javascript
nodeClients.forEach(client => {
  client.offTick(pattern, handler)
})
```
**Test Needed:** offTick when multiple clients are connected

**C. Empty NodeIds Handling (Lines 566-570, 667-668)**
```javascript
if (!nodeIds || nodeIds.length === 0) {
  return null
}
```
**Tests Needed:**
- `requestAny()` with filter that matches no nodes
- `tickAny()` with filter that matches no nodes  
- `_selectNode()` with empty array

**D. tickUpAll() Method (Lines 824-825)**
```javascript
tickUpAll ({ event, data, filter } = {}) {
  return this.tickAll({ event, data, filter, down: false, up: true })
}
```
**Test Needed:** Call `tickUpAll()` with upstream nodes

---

### 5. **server.js** - 95.84% Coverage
**Target: 98%+ | Gain: ~10 statements**

#### Uncovered Scenarios:

**A. Transport Not Ready Event (Lines 78-79)**
```javascript
this.on(ProtocolEvent.TRANSPORT_NOT_READY, () => {
  this._stopHealthChecks()
  this.emit(ServerEvent.NOT_READY)
})
```
**Test Needed:** Simulate transport disconnect/failure

**B. Ping for Unknown Client (Lines 143-146)**
```javascript
if (peerInfo) {
  peerInfo.updateLastSeen()
  peerInfo.setState('HEALTHY')
}
```
**Test Needed:** Receive ping from unregistered client (shouldn't crash)

**C. Client Timeout Check (Line 254)**
```javascript
if (now - lastSeen > timeout) {
  // ... emit timeout
}
```
**Test Needed:** Mock time to trigger client timeout

---

### 6. **router.js** - 93.79% Coverage
**Target: 98%+ | Gain: ~10 statements**

#### Uncovered Scenarios:

**A. Unbind Error Handling (Lines 198-210)**
```javascript
} catch (err) {
  if (err.code !== 'ENOENT') {
    const transportError = new TransportError({
      code: TransportErrorCode.UNBIND_FAILED,
      ...
    })
    this.emit('error', transportError)
    return
  }
}
```
**Test Needed:** Unbind with ZeroMQ error (non-ENOENT)

**B. Socket Events Guard (Lines 246-248)**
```javascript
if (socket.events) {
  socket.events.on('listening', ...)
}
```
**Test Needed:** Router with socket that has no `events` property (edge case)

---

### 7. **protocol.js** - 92.81% Coverage
**Target: 97%+ | Gain: ~20 statements**

#### Uncovered Scenarios:

**A. Message Envelope Parsing Errors (Lines 409-415)**
```javascript
} catch (err) {
  // Invalid envelope - ignore but log
  this.logger?.warn(...)
  return
}
```
**Test Needed:** Send malformed/corrupted message to protocol layer

**B. setTickTimeout() Edge Cases (Lines 454-455, 505-512)**
**Tests Needed:**
- Set tick timeout to non-integer
- Set very large/small timeout values

**C. Error Event Handler (Lines 555-556)**
**Test Needed:** Trigger transport error event propagation

---

## 📊 Projected Impact

| File | Current | Target | Gain | Effort |
|------|---------|--------|------|--------|
| **client.js** | 84.59% | 95%+ | +10% | Medium |
| **socket.js** | 83.74% | 95%+ | +11% | High |
| **envelope.js** | 88.35% | 95%+ | +7% | Low |
| **node.js** | 93.27% | 97%+ | +4% | Low |
| **server.js** | 95.84% | 98%+ | +2% | Low |
| **router.js** | 93.79% | 98%+ | +4% | Medium |
| **protocol.js** | 92.81% | 97%+ | +4% | Medium |

**Overall Projected Coverage: 96-97%** (from current 93.45%)

---

## 🚀 Recommended Implementation Order

### Phase 1: Quick Wins (1-2 hours)
**Target: 94.5% → 95.5%**

1. **envelope.js** - Add utility method tests
   - `getBuffer()`, `toObject()`, `validate()` edge cases
   - **Effort: Low | Impact: +7%**

2. **node.js** - Add routing edge case tests
   - `offTick()` variants, `tickUpAll()`, empty filter results
   - **Effort: Low | Impact: +4%**

3. **server.js** - Add transport event tests
   - NOT_READY event, unknown client ping
   - **Effort: Low | Impact: +2%**

### Phase 2: Error Handling (2-3 hours)
**Target: 95.5% → 96.5%**

4. **client.js** - Add client lifecycle edge cases
   - Disconnect while offline, ping edge cases, offline send
   - **Effort: Medium | Impact: +10%**

5. **router.js** - Add error scenarios
   - Unbind failures, socket events guard
   - **Effort: Medium | Impact: +4%**

6. **protocol.js** - Add message parsing errors
   - Malformed envelopes, timeout edge cases
   - **Effort: Medium | Impact: +4%**

### Phase 3: Advanced Scenarios (3-4 hours)
**Target: 96.5% → 97%+**

7. **socket.js** - Add transport-level error tests
   - Malformed messages, EAGAIN, HWM errors, socket errors
   - **Effort: High | Impact: +11%**
   - **Note:** Requires careful ZeroMQ mock/integration setup

---

## 🔍 Key Testing Patterns

### Pattern 1: Error Path Testing
```javascript
describe('Error Scenarios', () => {
  it('should handle offline disconnect gracefully', async () => {
    await client.disconnect()
    await client.disconnect() // Should not throw
  })
})
```

### Pattern 2: Edge Case Testing
```javascript
it('should handle empty filter results', async () => {
  const error = await node.requestAny({
    event: 'test',
    filter: (node) => false // Matches nothing
  }).catch(e => e)
  
  expect(error.code).to.equal(NodeErrorCode.NO_NODES_MATCH_FILTER)
})
```

### Pattern 3: State Transition Testing
```javascript
it('should not restart ping if already running', async () => {
  client._startPing()
  const interval1 = client._private.get(client).pingInterval
  
  client._startPing() // Should be no-op
  const interval2 = client._private.get(client).pingInterval
  
  expect(interval1).to.equal(interval2)
})
```

### Pattern 4: Malformed Input Testing
```javascript
it('should validate envelope with invalid type', () => {
  const buffer = Buffer.alloc(100)
  buffer.writeUInt8(99, 0) // Invalid type
  
  const envelope = Envelope.fromBuffer(buffer)
  const result = envelope.validate()
  
  expect(result.valid).to.be.false
  expect(result.error).to.include('Invalid envelope type')
})
```

---

## 💡 Notes

1. **Don't Chase 100%**: Some uncovered lines are legitimate edge cases (EAGAIN, race conditions) that are hard to test reliably.

2. **Focus on Meaningful Tests**: Each test should verify actual behavior, not just execute code for coverage sake.

3. **Use TIMING Constants**: For any new async tests, use `TIMING.*` from `test-utils.js` to prevent flakiness.

4. **Integration > Unit**: For transport layer (socket.js, router.js), integration tests are more valuable than mocked unit tests.

5. **Error Serialization**: Always test error `.toJSON()` methods to ensure proper logging/debugging.

---

## 📋 Implementation Checklist

- [ ] Phase 1: Quick Wins (envelope, node, server)
- [ ] Phase 2: Error Handling (client, router, protocol)
- [ ] Phase 3: Advanced Scenarios (socket)
- [ ] Run full test suite after each phase
- [ ] Update coverage report
- [ ] Document any intentionally uncovered code

**Estimated Total Time: 6-9 hours**  
**Expected Final Coverage: 96-97%**

