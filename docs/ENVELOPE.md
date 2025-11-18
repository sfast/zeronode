# Envelope Format

## Overview

Every message in ZeroNode is a **binary-encoded envelope** containing metadata (sender, receiver, event, timestamp, unique ID) and data payload. The envelope uses an efficient binary format with MessagePack encoding for data serialization.

**Key Features:**
- **Compact Binary Format**: Minimal overhead (~20-30 bytes + data)
- **Lazy Parsing**: Only parse fields when accessed
- **Zero-Copy Optimization**: Pass Buffers through without re-encoding
- **Type-Safe**: Strong typing for envelope types (TICK, REQUEST, RESPONSE, ERROR)

---

## Binary Structure

```
┌─────────────┬──────────┬─────────────────────────────────────┐
│   Field     │   Size   │          Description                │
├─────────────┼──────────┼─────────────────────────────────────┤
│ type        │ 1 byte   │ Envelope type (1-4)                 │
│ timestamp   │ 4 bytes  │ Unix timestamp (seconds, uint32)    │
│ id          │ 8 bytes  │ Unique ID (BigInt)                  │
│ owner       │ 1+N bytes│ Length (1 byte) + UTF-8 string      │
│ recipient   │ 1+N bytes│ Length (1 byte) + UTF-8 string      │
│ event       │ 1+N bytes│ Length (1 byte) + UTF-8 string      │
│ dataLength  │ 2 bytes  │ Data length (uint16, max 65535)     │
│ data        │ N bytes  │ MessagePack encoded data            │
└─────────────┴──────────┴─────────────────────────────────────┘
```

**Total Size:**
- **Fixed overhead**: 16 bytes (type + timestamp + id + dataLength)
- **Variable overhead**: 3-765 bytes (owner + recipient + event lengths + strings)
- **Typical overhead**: ~25-35 bytes for short IDs and event names

---

## Envelope Types

```javascript
export const EnvelopType = {
  TICK: 1,        // Fire-and-forget message (no response expected)
  REQUEST: 2,     // Request message (expects RESPONSE or ERROR)
  RESPONSE: 3,    // Success response to a REQUEST
  ERROR: 4        // Error response to a REQUEST
}
```

### Type Usage

| Type | Direction | Response Expected | Use Case |
|------|-----------|-------------------|----------|
| **TICK** | One-way | No | Events, notifications, broadcasts |
| **REQUEST** | Client → Server | Yes (RESPONSE or ERROR) | RPC calls, queries |
| **RESPONSE** | Server → Client | No | Successful reply to REQUEST |
| **ERROR** | Server → Client | No | Error reply to REQUEST |

---

## Envelope Properties

### Core Properties

```javascript
envelope.type         // EnvelopType (1-4)
envelope.timestamp    // Unix timestamp (seconds)
envelope.id           // BigInt - globally unique ID
envelope.owner        // String - sender node ID
envelope.recipient    // String - receiver node ID
envelope.event        // String - event/method name
envelope.data         // Any - parsed MessagePack data (read-only)
```

### Property Details

#### `envelope.type`
Envelope type constant (1-4). Use `EnvelopType` constants for clarity:
```javascript
if (envelope.type === EnvelopType.REQUEST) {
  // Handle request
}
```

#### `envelope.timestamp`
Unix timestamp in **seconds** (not milliseconds). Created when envelope is serialized.
```javascript
const age = Math.floor(Date.now() / 1000) - envelope.timestamp
console.log(`Message is ${age} seconds old`)
```

#### `envelope.id`
Unique BigInt identifier combining:
- Owner hash (for uniqueness across nodes)
- Timestamp (for ordering)
- Counter (for multiple messages in same millisecond)

```javascript
console.log(envelope.id)  // 123456789012345678n
```

#### `envelope.owner`
Node ID of the sender (original requester).
```javascript
console.log(`Request from: ${envelope.owner}`)
```

#### `envelope.recipient`
Target node ID (can be empty for broadcasts).
```javascript
if (envelope.recipient === node.getId()) {
  // Addressed to this node
}
```

#### `envelope.event`
Event name or method to invoke. Supports pattern matching with RegExp.
```javascript
// Handler registration
server.onRequest('user:get', handler)
server.onRequest(/^api:/, middleware)

// Event in envelope
console.log(envelope.event)  // 'user:get'
```

#### `envelope.data`
Parsed message data. **Read-only** - modifications won't affect the envelope.
```javascript
// ✅ Good: Read data
const userId = envelope.data.userId

// ❌ Bad: Modifying data (has no effect)
envelope.data.userId = 999  // Throws error (read-only)

// ✅ Good: Create new object if needed
const modifiedData = { ...envelope.data, processed: true }
```

---

## Buffer Strategies

ZeroNode supports two allocation strategies for envelope buffers:

### EXACT (Default)

```javascript
const node = new Node({
  config: {
    PROTOCOL_BUFFER_STRATEGY: BufferStrategy.EXACT
  }
})
```

**Characteristics:**
- ✅ Zero memory waste
- ✅ Exact size allocation
- ⚠️ More GC pressure (varied buffer sizes)

**Best for:** Low-memory environments, predictable message sizes

### POWER_OF_2

```javascript
import { BufferStrategy } from 'zeronode'

const node = new Node({
  config: {
    PROTOCOL_BUFFER_STRATEGY: BufferStrategy.POWER_OF_2
  }
})
```

**Characteristics:**
- ✅ CPU cache-friendly (aligned allocations)
- ✅ Potential for buffer pooling
- ✅ Less GC pressure (fewer distinct sizes)
- ⚠️ ~25% memory overhead on average

**Best for:** High-throughput systems, performance-critical applications

**Buffer sizes:** 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536 bytes

---

## Data Encoding

### MessagePack

ZeroNode uses **MessagePack** for efficient binary serialization:

```javascript
// These types are automatically encoded:
envelope.data = { user: 'john', age: 30 }        // Object
envelope.data = [1, 2, 3, 4, 5]                  // Array
envelope.data = 'Hello World'                     // String
envelope.data = 123456                            // Number
envelope.data = true                              // Boolean
envelope.data = null                              // Null
```

### Buffer Pass-Through (Zero-Copy)

**Optimization**: If data is already a Buffer, it's passed through without re-encoding:

```javascript
// ✅ Zero-copy optimization
const imageBuffer = fs.readFileSync('image.png')
node.tick({
  event: 'image:upload',
  data: imageBuffer  // Passed through without encoding!
})
```

### Unsupported Types

```javascript
// ❌ These will throw errors:
envelope.data = function() {}      // Functions can't be serialized
envelope.data = Symbol('test')     // Symbols can't be serialized
envelope.data = undefined          // Undefined is not serializable
```

---

## Lazy Parsing

**Performance Optimization**: Envelopes support lazy parsing - fields are only decoded when accessed.

```javascript
// When envelope arrives, only the buffer exists
// No parsing has happened yet

// First access triggers parsing of that field
console.log(envelope.event)  // Parses 'event' field only

// Accessing data triggers full data parsing
const data = envelope.data   // Parses MessagePack data

// Subsequent accesses use cached values (no re-parsing)
console.log(envelope.event)  // Uses cached value
```

**Benefits:**
- ⚡ Skip parsing fields you don't need
- ⚡ Parse only once per field
- ⚡ Reduce CPU usage for routing/filtering

---

## Creating Envelopes

### Automatic Creation

Most of the time, you don't create envelopes manually - ZeroNode does it for you:

```javascript
// ZeroNode creates REQUEST envelope automatically
await node.request({
  to: 'server-node',
  event: 'user:get',
  data: { userId: 123 }
})

// ZeroNode creates TICK envelope automatically
node.tick({
  event: 'notification',
  data: { message: 'Hello' }
})
```

### Manual Creation (Advanced)

For advanced use cases, you can create envelopes manually:

```javascript
import { Envelope, EnvelopType } from 'zeronode'

const envelope = Envelope.createRequest({
  owner: 'node-1',
  recipient: 'node-2',
  event: 'custom:event',
  data: { custom: 'data' }
})

// Serialize to buffer
const buffer = envelope.toBuffer()

// Send buffer over transport
socket.send(buffer)
```

---

## Reading Raw Envelopes

For low-level operations, you can read envelope fields without full parsing:

```javascript
// Read type (first byte)
const type = buffer[0]

// Read timestamp (4 bytes at offset 1)
const timestamp = buffer.readUInt32BE(1)

// Read ID (8 bytes at offset 5)
const idHigh = buffer.readUInt32BE(5)
const idLow = buffer.readUInt32BE(9)
const id = (BigInt(idHigh) << 32n) | BigInt(idLow)

// For owner/recipient/event, use Envelope.parse()
const envelope = Envelope.parse(buffer)
```

---

## Size Limits

### Field Limits

| Field | Max Length | Type | Notes |
|-------|------------|------|-------|
| `owner` | 255 bytes | String | Length prefix is 1 byte (uint8) |
| `recipient` | 255 bytes | String | Length prefix is 1 byte (uint8) |
| `event` | 255 bytes | String | Length prefix is 1 byte (uint8) |
| `data` | 65,535 bytes | Buffer | Length prefix is 2 bytes (uint16) |

### Recommendations

```javascript
// ✅ Good: Short, descriptive event names
event: 'user:get'
event: 'order:create'

// ⚠️ Acceptable: Longer events
event: 'analytics:user:session:created'

// ❌ Bad: Extremely long events (wastes bandwidth)
event: 'this:is:a:very:long:event:name:that:wastes:bytes'

// ✅ Good: Compact data
data: { id: 123, name: 'John' }

// ⚠️ Large data (consider splitting or compression)
data: { results: [...10000 items] }  // 65KB limit!
```

---

## Performance Tips

### 1. Use Buffer Pass-Through

```javascript
// ✅ Best: Pass Buffer directly (zero-copy)
const buffer = getSomeBuffer()
node.tick({ event: 'data', data: buffer })

// ❌ Slower: Encode/decode cycle
const buffer = getSomeBuffer()
node.tick({ event: 'data', data: buffer.toString() })  // Encodes string, then decodes
```

### 2. Keep Event Names Short

```javascript
// ✅ Good: 8 bytes
event: 'user:get'

// ❌ Wasteful: 35 bytes
event: 'api:v1:production:user:get:by:id'
```

### 3. Use Lazy Parsing

```javascript
// ✅ Good: Only access what you need
server.onRequest('ping', (envelope, reply) => {
  reply({ pong: true })  // Never accessed envelope.data
})

// ❌ Unnecessary: Accessing unused fields
server.onRequest('ping', (envelope, reply) => {
  const data = envelope.data  // Parsed but never used
  const event = envelope.event  // Already known from routing
  reply({ pong: true })
})
```

### 4. Choose Right Buffer Strategy

```javascript
// High throughput + large messages = POWER_OF_2
const node = new Node({
  config: {
    PROTOCOL_BUFFER_STRATEGY: BufferStrategy.POWER_OF_2
  }
})

// Low memory + small messages = EXACT (default)
const node = new Node({
  config: {
    PROTOCOL_BUFFER_STRATEGY: BufferStrategy.EXACT
  }
})
```

---

## Example: Complete Flow

```javascript
import Node, { EnvelopType } from 'zeronode'

const server = new Node({ id: 'server' })
await server.bind('tcp://127.0.0.1:3000')

// Register handler
server.onRequest('user:get', (envelope, reply) => {
  console.log('Envelope Type:', envelope.type)        // 2 (REQUEST)
  console.log('From:', envelope.owner)                // 'client'
  console.log('To:', envelope.recipient)              // 'server'
  console.log('Event:', envelope.event)               // 'user:get'
  console.log('Data:', envelope.data)                 // { userId: 123 }
  console.log('ID:', envelope.id)                     // 123456789012345678n
  console.log('Timestamp:', envelope.timestamp)       // 1700000000
  
  // Reply (creates RESPONSE envelope automatically)
  return { name: 'John', email: 'john@example.com' }
})

const client = new Node({ id: 'client' })
await client.connect({ address: 'tcp://127.0.0.1:3000' })

// Send request (creates REQUEST envelope automatically)
const user = await client.request({
  to: 'server',
  event: 'user:get',
  data: { userId: 123 }
})

console.log(user)  // { name: 'John', email: 'john@example.com' }
```

---

## Summary

✅ **Binary format**: Compact and efficient  
✅ **Lazy parsing**: Parse only what you need  
✅ **Zero-copy**: Pass Buffers through without re-encoding  
✅ **Type-safe**: Strong typing with EnvelopType  
✅ **MessagePack**: Efficient data serialization  
✅ **Flexible strategies**: EXACT or POWER_OF_2 buffer allocation  
✅ **Size limits**: 255 bytes for strings, 65KB for data  

**The envelope is the foundation of ZeroNode's efficient messaging system!** 📦

