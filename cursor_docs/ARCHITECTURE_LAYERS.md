# Zeronode Architecture - Layer Separation

## Layer Organization

```
┌─────────────────────────────────────────────────────────┐
│                   APPLICATION LAYER                      │
│              (Client/Server/Node)                        │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                   PROTOCOL LAYER                         │
│         (Request/Response, Envelope Types)               │
│                                                          │
│  Files:                                                  │
│  - protocol.js       Protocol handler                   │
│  - envelope.js       Envelope format & serialization    │
│                                                          │
│  Protocol Exports (protocol.js):                        │
│  - ProtocolConfigDefaults  { REQUEST_TIMEOUT, ... }     │
│  - ProtocolEvent     Protocol state events              │
│  - ProtocolError     Protocol-level error class         │
│  - ProtocolErrorCode Protocol error codes               │
│                                                          │
│  Envelope Exports (envelope.js):                        │
│  - EnvelopType       { TICK, REQUEST, RESPONSE, ERROR } │
│  - Envelope          Envelope class (reader/writer)     │
│  - EnvelopeIdGenerator  ID generation with counter      │
│  - BufferStrategy    { EXACT, POWER_OF_2 }              │
│  - encodeData/decodeData  MessagePack serialization     │
│                                                          │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                   SOCKET LAYER                           │
│         (Router/Dealer ZeroMQ wrappers)                  │
│                                                          │
│  Files:                                                  │
│  - sockets/router.js   Router socket wrapper            │
│  - sockets/dealer.js   Dealer socket wrapper            │
│  - sockets/enum.js     Socket-level enums               │
│                                                          │
│  Exports:                                                │
│  - SocketTimeouts    { CONNECTION_TIMEOUT,              │
│                        RECONNECTION_TIMEOUT,             │
│                        MONITOR_TIMEOUT, etc. }           │
│  - DealerStateType   { CONNECTED, DISCONNECTED, ... }   │
│  - MetricType        Socket metrics                     │
│                                                          │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                 TRANSPORT LAYER                          │
│                  (ZeroMQ native)                         │
└─────────────────────────────────────────────────────────┘
```

## Key Principles

### 1. Protocol Layer owns Message Semantics
- **EnvelopType** (in envelope.js) defines message types (TICK, REQUEST, RESPONSE, ERROR)
- **ProtocolConfigDefaults** (in protocol.js) defines protocol timeout defaults (REQUEST_TIMEOUT)
- **ProtocolError** (in protocol-errors.js) defines protocol-level errors (not transport-specific)
- **BufferStrategy** (in envelope.js) defines envelope buffer allocation strategies
- Protocol layer handles request/response matching and timeouts
- Envelope layer handles binary format and serialization
- **Key principle**: Protocol errors are independent of transport implementation

### 2. Socket Layer owns Connection Management
- **SocketTimeouts** defines connection timeouts (CONNECTION_TIMEOUT, RECONNECTION_TIMEOUT)
- Socket layer handles connect/disconnect/reconnect logic
- Socket layer wraps ZeroMQ sockets with state management

### 3. Clear Dependencies
```javascript
// ✅ GOOD: Protocol imports from envelope (same layer)
import { BufferStrategy, EnvelopType } from './envelope.js'
import { ProtocolError, ProtocolErrorCode } from './protocol-errors.js'

// ✅ GOOD: Application imports from protocol (higher layer)
import { ProtocolConfigDefaults } from './protocol.js'
import { EnvelopType, BufferStrategy } from './envelope.js'
import { ProtocolError } from './protocol-errors.js'

// ❌ BAD: Socket importing from protocol (upward dependency)
// Socket layer should NOT depend on protocol layer
```

## Migration Guide

### Old Code
```javascript
import { EnvelopType, Timeouts } from './sockets/enum.js'

// Using envelope types
if (type === EnvelopType.REQUEST) { ... }

// Using timeouts
const timeout = config.REQUEST_TIMEOUT || Timeouts.REQUEST_TIMEOUT

// Creating envelopes
const buffer = Envelope.createBuffer({
  type, id, tag, owner, recipient, data,
  bufferStrategy: 'power-of-2'  // ❌ Was inside params object
})
```

### New Code
```javascript
// Protocol-level code
import { ProtocolConfigDefaults } from './protocol.js'
import { ProtocolError, ProtocolErrorCode } from './protocol-errors.js'
import { EnvelopType, BufferStrategy } from './envelope.js'

if (type === EnvelopType.REQUEST) { ... }
const timeout = config.REQUEST_TIMEOUT || ProtocolConfigDefaults.REQUEST_TIMEOUT

// Protocol errors (not transport-specific)
try {
  await protocol.request({ to, event, data })
} catch (err) {
  if (err instanceof ProtocolError) {
    if (err.code === ProtocolErrorCode.REQUEST_TIMEOUT) {
      // Handle timeout
    } else if (err.code === ProtocolErrorCode.NOT_READY) {
      // Handle not ready
    }
  }
}

// Creating envelopes - bufferStrategy is now SECOND parameter
const buffer = Envelope.createBuffer({
  type, id, tag, owner, recipient, data
}, BufferStrategy.POWER_OF_2)  // ✅ Separate parameter

// Socket-level code
import { SocketTimeouts } from './sockets/enum.js'

const connTimeout = config.CONNECTION_TIMEOUT || SocketTimeouts.CONNECTION_TIMEOUT
```

### Backward Compatibility

For existing code, `Timeouts` is still exported from `sockets/enum.js` as an alias to `SocketTimeouts`:

```javascript
// ✅ Still works (legacy)
import { Timeouts } from './sockets/enum.js'
if (timeout !== Timeouts.INFINITY) { ... }

// ✅ Preferred (new code)
import { SocketTimeouts } from './sockets/enum.js'
if (timeout !== SocketTimeouts.INFINITY) { ... }
```

## Benefits

1. **Clear Separation of Concerns**
   - Protocol layer: Message semantics and request/response logic
   - Socket layer: Connection management and ZeroMQ wrapper

2. **Better Maintainability**
   - Envelope types in envelope.js (where envelope format is defined)
   - Envelope format and serialization in envelope.js
   - BufferStrategy with envelope buffer allocation
   - Protocol defaults in protocol.js
   - Protocol errors separate from transport errors (not "ZeronodeError")
   - Socket timeouts in socket layer

3. **Easier Testing**
   - Can test protocol independently of sockets
   - Can test socket connection logic independently of protocol

4. **Clearer Intent**
   - `ProtocolError.REQUEST_TIMEOUT` - protocol-level error (transport-independent)
   - `ProtocolConfigDefaults.REQUEST_TIMEOUT` - clearly protocol-level default
   - `SocketTimeouts.CONNECTION_TIMEOUT` - clearly socket-level
   - `EnvelopType.REQUEST` - clearly envelope type
   - No ambiguity about where configurations and errors belong

