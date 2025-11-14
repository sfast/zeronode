# Socket Layer Analysis 🔍

## Issues Found

### 1. **Socket.js - Wrong Export**
**Line 212-215:**
```javascript
export default {
  SocketEvent,  // ❌ Not defined! Should be TransportEvent
  Socket
}
```

**Fix:** Remove this export or fix to `TransportEvent`

---

### 2. **Dealer.js - Inconsistent Method Names**

**Lines 143, 254, 280, 282:**
```javascript
// Dealer calls:
this.attachTransportEventListeners()   // ❌ Wrong name
this.detachTransportEventListeners()   // ❌ Wrong name

// But base Socket has:
attachSocketEventListeners()           // ✅ Correct
detachSocketEventListeners()           // ✅ Correct
```

**Fix:** Rename to match base class

---

### 3. **Dealer.js - Duplicate Event Handler Function**

**Lines 301-308:**
```javascript
// Dealer defines its own buildTransportEventHandler
function buildTransportEventHandler (eventName) {
  return (fd, endpoint) => {
    if (this.debug) {
      this.logger.info(`Emitted '${eventName}' on socket '${this.getId()}'`)
    }
    this.emit(eventName, { fd, endpoint })
  }
}
```

**But Socket.js already has `buildSocketEventHandler` (lines 28-35)!**

**Problem:** Inconsistent naming, duplicate code

**Fix:** Reuse from parent or make it a shared utility

---

### 4. **Router.js - Also Duplicates Event Handler**

**Lines 190-197:**
```javascript
// Router ALSO defines buildSocketEventHandler (correct name though)
function buildSocketEventHandler (eventName) {
  return (fd, endpoint) => {
    if (this.debug) {
      this.logger.info(`Emitted '${eventName}' on socket '${this.getId()}'`)
    }
    this.emit(eventName, { fd, endpoint })
  }
}
```

**Problem:** Same function duplicated 3 times!

**Fix:** Share from Socket.js

---

### 5. **Missing Sender in Message Event**

**Socket.js line 18:**
```javascript
// Dealer emits message without sender
this.emit('message', { buffer })  // ❌ No sender!
```

**But Protocol needs to know who sent it (for Router)!**

Router receives: `[senderIdentity, '', payload]`
Dealer receives: `[payload]`

**Current:** Socket treats both the same - loses sender info!

**Fix:** Extract sender from Router messages

---

### 6. **Unused Methods?**

Checking if any methods are unused...

**Socket.js:**
- `getId()` ✅ Used
- `setOnline()` ✅ Used
- `setOffline()` ✅ Used
- `isOnline()` ✅ Used
- `getConfig()` ✅ Used
- `setLogger()` ✅ Used
- `debug` (getter/setter) ✅ Used
- `sendBuffer()` ✅ Used
- `getSocketMsgFromBuffer()` ✅ Used (overridden)
- `attachSocketEventListeners()` ✅ Used
- `detachSocketEventListeners()` ✅ Used
- `close()` ✅ Used
- `_configureCommonSocketOptions()` ✅ Used

**Dealer.js:**
- `getAddress()` ✅ Used
- `setAddress()` ✅ Used
- `getState()` ❓ **Potentially unused** - only internal
- `setOnline()` ✅ Used (overridden)
- `connect()` ✅ Used
- `_setupConnectionHandlers()` ✅ Used
- `_clearConnectionTimeout()` ✅ Used
- `_clearReconnectionTimeout()` ✅ Used
- `disconnect()` ✅ Used
- `close()` ✅ Used
- `attachTransportEventListeners()` ✅ Used (wrong name though)
- `getSocketMsgFromBuffer()` ✅ Used (overridden)

**Router.js:**
- `getAddress()` ✅ Used
- `setAddress()` ✅ Used
- `bind()` ✅ Used
- `unbind()` ✅ Used
- `close()` ✅ Used
- `attachSocketEventListeners()` ✅ Used
- `getSocketMsgFromBuffer()` ✅ Used (overridden)

**All methods are used! ✅**

---

## Missing TransportEvent Emissions?

Let me check what TransportEvents should be emitted:

**Required:**
1. `READY` - ✅ Dealer: 'connect', Router: 'listen'
2. `NOT_READY` - ✅ Dealer: 'disconnect'
3. `MESSAGE` - ✅ Socket: startMessageListener
4. `CLOSED` - ✅ Socket: 'close'

**Missing:**
- Router never emits `NOT_READY` ❌
  - Router doesn't have a disconnect event in ZMQ
  - Only unbinds when explicitly called
  - **This is correct!** Server doesn't "disconnect"

**All required events are emitted! ✅**

---

## Summary

### Critical Issues (Must Fix):
1. ❌ **Socket.js export** - `SocketEvent` not defined
2. ❌ **Dealer.js method names** - `attachTransportEventListeners` should be `attachSocketEventListeners`
3. ❌ **Message sender missing** - Router messages don't pass sender ID to Protocol

### Code Quality Issues (Should Fix):
4. ⚠️ **Duplicate code** - `buildSocketEventHandler` / `buildTransportEventHandler` duplicated 3 times
5. ⚠️ **Inconsistent naming** - Event handler functions have different names in each file

### Non-Issues (OK):
6. ✅ All methods are used
7. ✅ All TransportEvents are emitted correctly
8. ✅ Router doesn't need NOT_READY event

---

## Recommendations

### Fix 1: Socket.js Export
```javascript
// Remove or fix
export default {
  TransportEvent,  // ✅ Correct
  Socket
}
```

### Fix 2: Dealer Method Names
```javascript
// Dealer.js - rename ALL occurrences
attachSocketEventListeners()    // ✅ Match parent
detachSocketEventListeners()    // ✅ Match parent
```

### Fix 3: Message Sender Extraction

**Socket.js needs to be aware of socket type to extract sender:**

```javascript
async function startMessageListener (socket) {
  try {
    for await (const msg of socket) {
      // Extract sender for Router sockets
      let buffer, sender
      
      if (Array.isArray(msg) && msg.length >= 3) {
        // Router message: [sender, delimiter, payload]
        [sender, , buffer] = msg
      } else if (Array.isArray(msg) && msg.length === 2) {
        // Dealer message with ZMQ 6 delimiter: [delimiter, payload]
        [, buffer] = msg
        sender = null
      } else {
        // Simple buffer
        buffer = msg
        sender = null
      }
      
      this.emit('message', { buffer, sender })
    }
  } catch (err) {
    if (this.logger && err.code !== 'EAGAIN') {
      this.logger.error('Socket message listener error:', err)
    }
  }
}
```

### Fix 4: Share Event Handler Function

**Move to Socket.js and export:**
```javascript
// Socket.js
export function buildSocketEventHandler (eventName) {
  return (fd, endpoint) => {
    if (this.debug) {
      this.logger.info(`Emitted '${eventName}' on socket '${this.getId()}'`)
    }
    this.emit(eventName, { fd, endpoint })
  }
}

// Dealer.js - import and use
import { Socket, TransportEvent, buildSocketEventHandler } from './socket.js'

// Router.js - import and use  
import { Socket, TransportEvent, buildSocketEventHandler } from './socket.js'
```

---

## Architecture Validation ✅

**The ZeroMQ layer correctly:**
1. ✅ Emits `TransportEvent.READY` when connected/bound
2. ✅ Emits `TransportEvent.NOT_READY` when disconnected (Dealer only)
3. ✅ Emits `TransportEvent.CLOSED` when permanently closed
4. ✅ Emits `message` with buffer for Protocol
5. ✅ Thin wrappers around ZMQ (no business logic)
6. ✅ Only transport concerns (connect/bind/send/receive)

**Protocol correctly:**
1. ✅ Listens to TransportEvents
2. ✅ Translates to ProtocolEvents
3. ✅ Never touches ZMQ directly

**Clean separation! Good architecture! 🎯**

---

## Next Steps

1. Fix critical issues (export, method names, message sender)
2. Clean up duplicate code
3. Test to ensure no regressions
4. Update documentation if needed

