# Socket.js Coverage Analysis

## Current Coverage: 83.74%
**Target: 95%+**

## Uncovered Lines (from coverage report):
```
149-161: Malformed message handling (unexpected frame count)
170-171: EAGAIN error during socket close
203-210: sendBuffer when socket offline
226-239: Abstract method + detachSocketEventListeners edge cases
```

---

## Detailed Breakdown

### 1. **Lines 149-161: Malformed Message Handling**
```javascript
} else {
  // Unexpected message format - emit error but continue processing
  const transportError = new TransportError({
    code: TransportErrorCode.RECEIVE_FAILED,
    message: `Unexpected message format: received ${frames.length} frames...`,
    ...
  })
  this.emit('error', transportError)
  continue
}
```
**Missing Test:** Send message with 1 frame or 4+ frames (not 2 or 3)

---

### 2. **Lines 170-171: EAGAIN Error Handling**
```javascript
if (err.code === 'EAGAIN') {
  return  // Normal closure, nothing to report
}
```
**Missing Test:** Close socket during receive loop to trigger EAGAIN

---

### 3. **Lines 203-210: Send When Offline**
```javascript
if (!this.isOnline()) {
  throw new TransportError({
    code: TransportErrorCode.SEND_FAILED,
    message: `Cannot send - transport '${this.getId()}' is offline`,
    ...
  })
}
```
**Missing Test:** Call sendBuffer when socket is offline

---

### 4. **Lines 226-239: Edge Cases**

**Line 228: Abstract method error**
```javascript
getSocketMsgFromBuffer (buffer, recipient) {
  throw new Error('getSocketMsgFromBuffer is not implemented...')
}
```
**Missing Test:** Create socket subclass that doesn't override this method

**Lines 234-240: detachSocketEventListeners guards**
```javascript
if (socket && !socket.closed && socket.events && typeof socket.events.removeAllListeners === 'function') {
    socket.events.removeAllListeners()
}
```
**Missing Tests:**
- Socket with no events property
- Socket with events but no removeAllListeners function
- Socket that is already closed

---

## Test Implementation Strategy

### Test File: `socket-coverage.test.js` (new)

**Test 1: Malformed Message (1 frame)**
- Mock ZMQ socket that sends [single-frame] message
- Listen for 'error' event
- Verify TransportError with RECEIVE_FAILED

**Test 2: Malformed Message (4 frames)**
- Mock ZMQ socket that sends [frame1, frame2, frame3, frame4]
- Listen for 'error' event
- Verify error message includes "expected 2 (Dealer) or 3 (Router)"

**Test 3: EAGAIN During Close**
- Create dealer/router
- Connect/bind
- Trigger socket close during message receive
- Verify no error emitted (graceful)

**Test 4: Send When Offline**
- Create dealer socket
- Don't connect (stays offline)
- Call sendBuffer()
- Expect TransportError with SEND_FAILED

**Test 5: Abstract Method**
- Create minimal Socket subclass without overriding getSocketMsgFromBuffer
- Call the method
- Expect Error with "not implemented"

**Test 6: detachSocketEventListeners Edge Cases**
- Socket with no events property
- Socket with events = {}
- Socket already closed

---

## Expected Coverage Improvement
- Current: 83.74%
- After tests: **95%+**
- Gain: ~11% (~33 statements)

