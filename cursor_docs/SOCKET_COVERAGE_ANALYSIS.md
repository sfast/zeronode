# Socket.js Coverage Analysis & Test Scenarios

## Current Coverage Status

```
socket.js: 77.73% Statements | 70.58% Branches | 93.75% Functions
Uncovered Lines: 167-183, 203-210, 215-216, 226-239
```

---

## Uncovered Code Analysis

### 1. **Lines 167-183: Message Listener Error Handling**

**Current Code (UNCOVERED):**
```javascript
} catch (err) {
  // Socket closed or error occurred
  // EAGAIN: Socket closed normally (expected during shutdown)
  if (err.code === 'EAGAIN') {
    return  // Normal closure, nothing to report  ← LINE 170 COVERED
  }
  
  // Unexpected error - emit transport error event
  const transportError = new TransportError({     ← LINES 174-178 UNCOVERED
    code: TransportErrorCode.RECEIVE_FAILED,
    message: `Socket message listener error: ${err.message}`,
    transportId: this.getId(),
    cause: err
  })
  
  this.emit('error', transportError)              ← LINE 182 UNCOVERED
}
```

**Why Uncovered:**
- The message listener loop (`for await (const frames of socket)`) only exits gracefully
- No tests trigger non-EAGAIN errors during message reception
- Native ZMQ socket exceptions are not simulated

**Missing Test Scenarios:**
1. ❌ **Corrupted socket stream error**
2. ❌ **Memory allocation failure during receive**
3. ❌ **Socket exception with non-EAGAIN error code**
4. ❌ **Unexpected ZMQ internal error**

---

### 2. **Lines 203-210: Send Buffer Error Handling**

**Current Code (UNCOVERED):**
```javascript
try {
  let msg = this.getSocketMsgFromBuffer(buffer, recipient)
  socket.send(msg)                                 ← LINE 200 COVERED
  return true
} catch (err) {
  // Wrap any ZMQ send errors (HWM reached, socket error, etc.)
  throw new TransportError({                       ← LINES 204-209 UNCOVERED
    code: TransportErrorCode.SEND_FAILED,
    message: `Failed to send on transport '${this.getId()}': ${err.message}`,
    transportId: this.getId(),
    cause: err
  })
}
```

**Why Uncovered:**
- All current tests send successfully
- High Water Mark (HWM) limits not tested
- Socket errors during `socket.send()` not triggered

**Missing Test Scenarios:**
1. ❌ **High Water Mark reached (queue full)**
2. ❌ **Socket closed during send**
3. ❌ **Native ZMQ send() failure**
4. ❌ **Buffer serialization error**

---

### 3. **Lines 215-216: Abstract Method Error**

**Current Code (UNCOVERED):**
```javascript
// Default implementation (overridden in Router/Dealer)
getSocketMsgFromBuffer (buffer, recipient) {
  throw new Error('getSocketMsgFromBuffer is not implemented...')  ← LINE 215 UNCOVERED
}
```

**Why Uncovered:**
- `Socket` is an abstract base class
- Never instantiated directly (only via `Dealer`/`Router`)
- Subclasses always override this method

**Missing Test Scenario:**
1. ❌ **Direct Socket instantiation test** (to verify abstract method throws)

---

### 4. **Lines 226-239: Listener Detachment Error Handling**

**Current Code (UNCOVERED):**
```javascript
detachSocketEventListeners () {
  let { socket } = _private.get(this)
  
  if (socket && !socket.closed && socket.events && 
      typeof socket.events.removeAllListeners === 'function') {
    try {
      socket.events.removeAllListeners()            ← LINE 227 COVERED
    } catch (err) {
      // Emit transport error if listener cleanup fails during close
      const transportError = new TransportError({   ← LINES 230-235 UNCOVERED
        code: TransportErrorCode.CLOSE_FAILED,
        message: `Failed to detach socket listeners: ${err.message}`,
        transportId: this.getId(),
        cause: err
      })
      
      this.emit('error', transportError)            ← LINE 237 UNCOVERED
    }
  }
}
```

**Why Uncovered:**
- `removeAllListeners()` always succeeds in tests
- No edge cases where cleanup fails

**Missing Test Scenarios:**
1. ❌ **Listener detachment throws exception**
2. ❌ **Socket events object in invalid state**
3. ❌ **Native event system corruption**

---

## Recommended Test Scenarios (Priority Order)

### ✅ HIGH PRIORITY (Easy to implement, high impact)

#### Test 1: High Water Mark Send Failure
```javascript
describe('sendBuffer() - Error Handling', () => {
  it('should throw SEND_FAILED when HWM is reached', async () => {
    const dealer = new DealerSocket({ 
      id: 'test-hwm',
      config: { 
        ZMQ_SNDHWM: 1,      // Set very low HWM
        ZMQ_SNDTIMEO: 10    // Set short timeout
      }
    })
    
    try {
      await dealer.connect('tcp://127.0.0.1:9999') // Non-existent endpoint
      
      // Fill the send queue (HWM = 1)
      dealer.sendBuffer(Buffer.from('msg1'))
      
      // This should fail (queue full)
      try {
        dealer.sendBuffer(Buffer.from('msg2'))
        expect.fail('Should have thrown SEND_FAILED')
      } catch (err) {
        expect(err.code).to.equal('TRANSPORT_SEND_FAILED')
        expect(err.message).to.include('Failed to send')
      }
    } finally {
      await dealer.close()
    }
  })
})
```

**Coverage Impact**: Lines 203-210 ✅

---

#### Test 2: Send While Offline
```javascript
describe('sendBuffer() - State Validation', () => {
  it('should throw SEND_FAILED when socket is offline', () => {
    const dealer = new DealerSocket({ id: 'test-offline' })
    
    // Don't connect - socket is offline
    expect(dealer.isOnline()).to.be.false
    
    try {
      dealer.sendBuffer(Buffer.from('test'))
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err.code).to.equal('TRANSPORT_SEND_FAILED')
      expect(err.message).to.include('offline')
    }
  })
})
```

**Coverage Impact**: Lines 190-196 ✅ (Already covered, but adds robustness)

---

#### Test 3: Abstract Method Verification
```javascript
describe('Socket Base Class - Abstract Methods', () => {
  it('should throw error if getSocketMsgFromBuffer not overridden', () => {
    // Create a minimal socket instance to test base class
    const socket = new Socket({
      socket: { routingId: 'test-base' },
      config: {}
    })
    
    expect(() => {
      socket.getSocketMsgFromBuffer(Buffer.from('test'), 'recipient')
    }).to.throw('getSocketMsgFromBuffer is not implemented')
  })
})
```

**Coverage Impact**: Lines 215-216 ✅

---

### ⚠️ MEDIUM PRIORITY (Requires mocking, moderate difficulty)

#### Test 4: Malformed Message Frames (Already Covered!)
```javascript
// This is ALREADY handled by socket.js lines 148-161
// But we can add explicit tests for it
describe('_startMessageListener() - Frame Validation', () => {
  it('should emit RECEIVE_FAILED for invalid frame count', (done) => {
    const router = new RouterSocket({ id: 'test-frames' })
    
    router.on('error', (err) => {
      expect(err.code).to.equal('TRANSPORT_RECEIVE_FAILED')
      expect(err.message).to.include('Unexpected message format')
      expect(err.context.frameCount).to.not.be.oneOf([2, 3])
      done()
    })
    
    // Simulate receiving invalid frames (requires mocking ZMQ socket)
    // This is complex - may need integration test
  })
})
```

**Coverage Impact**: Lines 149-161 (Already covered in integration tests)

---

#### Test 5: Message Listener Non-EAGAIN Error
```javascript
describe('_startMessageListener() - Error Handling', () => {
  it('should emit RECEIVE_FAILED for non-EAGAIN errors', async () => {
    const dealer = new DealerSocket({ id: 'test-listener-error' })
    
    // This requires mocking the socket's async iterator
    // to throw a non-EAGAIN error
    
    let errorEmitted = false
    dealer.on('error', (err) => {
      if (err.code === 'TRANSPORT_RECEIVE_FAILED') {
        errorEmitted = true
      }
    })
    
    // Trigger error (complex - requires mocking)
    // await triggerSocketIteratorError(dealer)
    
    expect(errorEmitted).to.be.true
  })
})
```

**Coverage Impact**: Lines 174-182 ✅

**Challenge**: Requires mocking `socket` async iterator to throw non-EAGAIN errors

---

### 🔴 LOW PRIORITY (Hard to test, edge cases)

#### Test 6: Listener Detachment Failure
```javascript
describe('detachSocketEventListeners() - Error Handling', () => {
  it('should emit CLOSE_FAILED if removeAllListeners throws', () => {
    const dealer = new DealerSocket({ id: 'test-detach-error' })
    
    // Mock socket.events.removeAllListeners to throw
    // This is very difficult without internal access
    
    let errorEmitted = false
    dealer.on('error', (err) => {
      if (err.code === 'TRANSPORT_CLOSE_FAILED') {
        errorEmitted = true
      }
    })
    
    dealer.detachSocketEventListeners()
    
    expect(errorEmitted).to.be.true
  })
})
```

**Coverage Impact**: Lines 228-238 ✅

**Challenge**: Requires mocking internal ZMQ event system to fail

---

## Practical Implementation Strategy

### Phase 1: Easy Wins (1-2 hours)
✅ **Implement Tests 1, 2, 3** (Abstract method, offline send, HWM)
- No mocking required
- Straightforward to write
- **Expected Coverage Increase**: 77.73% → **85%+**

### Phase 2: Integration Scenarios (2-4 hours)
✅ **Add integration tests for:**
- Connection failures during send
- Router receiving invalid frames
- Dealer reconnection with message loss

**Expected Coverage Increase**: 85% → **90%+**

### Phase 3: Deep Error Simulation (Optional, 4+ hours)
⚠️ **Mock-based tests** (if justified):
- Listener async iterator errors
- Event detachment failures
- Native ZMQ exceptions

**Expected Coverage Increase**: 90% → **95%+**

---

## Recommended Next Steps

### 1. Create `src/transport/zeromq/tests/socket-errors.test.js`
```javascript
/**
 * Socket Error Handling Tests
 * Tests error paths in the base Socket class
 */

import { expect } from 'chai'
import { Dealer as DealerSocket, Router as RouterSocket } from '../index.js'
import { TransportErrorCode } from '../../errors.js'

describe('Socket Base Class - Error Handling', () => {
  // Test 1: Abstract method
  // Test 2: Send while offline
  // Test 3: HWM reached
  // ... etc
})
```

### 2. Add to existing `dealer.test.js`
- Send failures (HWM, offline, closed socket)
- Connection errors during send

### 3. Add to existing `router.test.js`
- Bind failures during message handling
- Invalid frame scenarios (if not covered)

---

## Expected Final Coverage

After implementing **Phase 1** tests:
```
socket.js: 85-88% (from 77.73%)
Overall:   92-93% (from 91.23%)
```

After implementing **Phase 2** (integration):
```
socket.js: 90-93% (from 77.73%)
Overall:   93-94% (from 91.23%)
```

---

## Priority Recommendation

**START WITH PHASE 1:**
1. ✅ Test offline send
2. ✅ Test abstract method
3. ✅ Test HWM send failure

These are **low-hanging fruit** that will give you **~10% coverage increase** with **minimal effort** and **no complex mocking**.

**Phase 2 and 3 are optional** - current 77% is already excellent for a transport layer base class!

