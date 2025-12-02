# Envelope Metadata Design

## 📋 **Current State Analysis**

### **Current Envelope Structure**
```
┌─────────────┬──────────┬─────────────────────────────────────┐
│   Field     │   Size   │          Description                │
├─────────────┼──────────┼─────────────────────────────────────┤
│ type        │ 1 byte   │ Envelope type (REQUEST/RESPONSE/etc)│
│ timestamp   │ 4 bytes  │ Unix timestamp (seconds, uint32)    │
│ id          │ 8 bytes  │ Unique ID (owner hash + ts + counter)│
│ owner       │ 1+N bytes│ Length (1 byte) + UTF-8 string      │
│ recipient   │ 1+N bytes│ Length (1 byte) + UTF-8 string      │
│ event       │ 1+N bytes│ Length (1 byte) + UTF-8 string      │
│ dataLength  │ 2 bytes  │ Data length (uint16, max 65535)     │
│ data        │ N bytes  │ MessagePack encoded data (or Buffer)│
└─────────────┴──────────┴─────────────────────────────────────┘
```

**Characteristics:**
- Binary format with length-prefixed strings
- MessagePack encoding for data field
- Max data size: 65KB (uint16)
- String fields limited to 255 bytes each

---

## 🎯 **Proposed Enhancement: Add Metadata Field**

### **Why Add Metadata?**

1. **Separation of Concerns**
   - User data (`data`) remains pure and untouched
   - System/routing info goes in `metadata`
   - No confusion between user payload and system metadata

2. **Future-Proof Routing**
   - Router forwarding information
   - Tracing/correlation IDs
   - Quality of Service (QoS) hints
   - Compression flags
   - Encryption metadata

3. **Backward Compatible**
   - Metadata is optional (can be null/undefined)
   - Zero overhead when not used
   - Graceful degradation for old clients

---

## 🏗️ **New Envelope Structure**

```
┌──────────────┬──────────┬─────────────────────────────────────┐
│   Field      │   Size   │          Description                │
├──────────────┼──────────┼─────────────────────────────────────┤
│ type         │ 1 byte   │ Envelope type (REQUEST/RESPONSE/etc)│
│ timestamp    │ 4 bytes  │ Unix timestamp (seconds, uint32)    │
│ id           │ 8 bytes  │ Unique ID                           │
│ owner        │ 1+N bytes│ Length (1 byte) + UTF-8 string      │
│ recipient    │ 1+N bytes│ Length (1 byte) + UTF-8 string      │
│ event        │ 1+N bytes│ Length (1 byte) + UTF-8 string      │
│ dataLength   │ 2 bytes  │ Data length (uint16, max 65535)     │
│ data         │ N bytes  │ MessagePack encoded user data       │
│ metaLength   │ 2 bytes  │ Metadata length (uint16, max 65535) │ ← NEW
│ metadata     │ N bytes  │ MessagePack encoded metadata        │ ← NEW
└──────────────┴──────────┴─────────────────────────────────────┘
```

**Key Points:**
- Metadata comes **after** data (maintains offset compatibility for readers who don't need it)
- Separate length field (`metaLength`) - allows zero-copy skipping
- Same size limits as data (uint16 = 64KB max)
- Same encoding (MessagePack)

---

## 💡 **Implementation Strategy**

### **Phase 1: Envelope Layer** (Non-Breaking)

#### **1. Update `Envelope.createBuffer()`**

```javascript
static createBuffer({ 
  type, 
  id, 
  event, 
  owner, 
  recipient, 
  data,
  metadata  // ← NEW optional parameter
}, bufferStrategy = null) {
  
  // ... existing validation ...
  
  // Encode metadata (optional)
  let metadataBuffer = null
  let metadataLength = 0
  
  if (metadata !== undefined && metadata !== null) {
    metadataBuffer = encodeDataToBuffer(metadata)
    metadataLength = metadataBuffer.length
    
    if (metadataLength > Envelope.MAX_DATA_LENGTH) {
      throw new Error(`Metadata too large: ${metadataLength} bytes`)
    }
  }
  
  // Calculate total size
  const totalSize = 1 +              // type
    4 +                               // timestamp
    8 +                               // id
    (1 + ownerBytes) +                // owner
    (1 + recipientBytes) +            // recipient
    (1 + eventBytes) +                // event
    2 + dataLength +                  // dataLength + data
    2 + metadataLength                // metaLength + metadata ← NEW
  
  // ... allocate buffer ...
  
  // Write data
  buffer.writeUInt16BE(dataLength, offset)
  offset += 2
  if (dataLength > 0) {
    dataBuffer.copy(buffer, offset)
    offset += dataLength
  }
  
  // Write metadata (NEW)
  buffer.writeUInt16BE(metadataLength, offset)
  offset += 2
  if (metadataLength > 0) {
    metadataBuffer.copy(buffer, offset)
    offset += metadataLength
  }
  
  return buffer.subarray(0, totalSize)
}
```

#### **2. Update `Envelope` Class Getter**

```javascript
class Envelope {
  // ... existing getters ...
  
  /**
   * Get metadata (lazy parsed)
   * @returns {*} Decoded metadata or null
   */
  get metadata() {
    // Check cache
    if (this._metadata !== undefined) {
      return this._metadata
    }
    
    // Calculate offsets if needed
    this._calculateOffsets()
    
    const { metadataOffset, metadataLength } = this._offsets
    
    // No metadata
    if (metadataLength === 0) {
      this._metadata = null
      return null
    }
    
    // Decode metadata
    const metadataView = this._buffer.subarray(
      metadataOffset,
      metadataOffset + metadataLength
    )
    
    this._metadata = decodeDataFromBuffer(metadataView)
    return this._metadata
  }
}
```

#### **3. Update `_calculateOffsets()`**

```javascript
_calculateOffsets() {
  // ... existing offset calculations for type, timestamp, id, owner, recipient, event ...
  
  // Data (2 byte length + N bytes)
  checkBounds(offset, 2, 'data length')
  const dataLength = buffer.readUInt16BE(offset)
  offset += 2
  checkBounds(offset, dataLength, 'data')
  const dataOffset = offset
  offset += dataLength
  
  // Metadata (2 byte length + N bytes) - NEW
  let metadataOffset = 0
  let metadataLength = 0
  
  if (offset + 2 <= bufferLength) {
    // Metadata field exists
    metadataLength = buffer.readUInt16BE(offset)
    offset += 2
    
    if (metadataLength > 0) {
      checkBounds(offset, metadataLength, 'metadata')
      metadataOffset = offset
    }
  }
  
  this._offsets = {
    // ... existing offsets ...
    dataOffset,
    dataLength,
    metadataOffset,  // NEW
    metadataLength   // NEW
  }
  
  return this._offsets
}
```

---

### **Phase 2: Protocol Layer** (Add Metadata Support)

#### **1. Update Protocol Methods**

**Option A: Add `metadata` parameter (explicit)**
```javascript
// Protocol.request()
request({ to, event, data, metadata, timeout }) {
  // ... validation ...
  
  const buffer = Envelope.createBuffer({
    type: EnvelopType.REQUEST,
    id,
    event,
    data,
    metadata,  // ← Pass through
    owner: this.getId(),
    recipient: to
  }, config.BUFFER_STRATEGY)
  
  socket.sendBuffer(buffer, to)
}

// Protocol.tick()
tick({ to, event, data, metadata }) {
  // ... validation ...
  
  const buffer = Envelope.createBuffer({
    type: EnvelopType.TICK,
    id,
    event,
    data,
    metadata,  // ← Pass through
    owner: this.getId()
  }, config.BUFFER_STRATEGY)
  
  socket.sendBuffer(buffer, to)
}
```

**Option B: Metadata in separate namespace (namespaced)**
```javascript
// User calls with explicit metadata object
node.request({
  to: 'worker-1',
  event: 'process',
  data: { jobId: 123 },
  metadata: {
    traceId: 'abc-123',
    priority: 'high',
    timeout: 5000
  }
})
```

---

### **Phase 3: Node Layer** (Expose Metadata API)

#### **1. Update Node.request()**

```javascript
async request({ to, event, data, metadata, timeout } = {}) {
  const route = this._findRoute(to)
  
  // Pass metadata to protocol
  return await route.target.request({
    to,
    event,
    data,
    metadata,  // ← NEW
    timeout
  })
}
```

#### **2. Update Node.tick()**

```javascript
tick({ to, event, data, metadata } = {}) {
  const route = this._findRoute(to)
  
  // Pass metadata to protocol
  route.target.tick({
    to,
    event,
    data,
    metadata  // ← NEW
  })
}
```

#### **3. Handlers Receive Metadata**

```javascript
// User handlers get envelope with metadata
node.onRequest('process', (envelope, reply) => {
  console.log('User data:', envelope.data)
  console.log('Metadata:', envelope.metadata)  // ← NEW
  
  reply({ status: 'ok' })
})
```

---

## 🔍 **Use Cases for Metadata**

### **1. Distributed Tracing**
```javascript
node.request({
  to: 'service-a',
  event: 'process',
  data: { jobId: 123 },
  metadata: {
    traceId: 'trace-abc-123',
    spanId: 'span-xyz-456',
    parentSpanId: 'span-parent-789'
  }
})
```

### **2. Quality of Service (QoS)**
```javascript
node.request({
  to: 'worker',
  event: 'compute',
  data: { task: 'heavy-computation' },
  metadata: {
    priority: 'high',
    maxRetries: 3,
    deadline: Date.now() + 30000  // 30 seconds
  }
})
```

### **3. Router Forwarding** (Future)
```javascript
// Internal use by Router class
protocol.request({
  to: 'router-1',
  event: 'proxy_request',
  data: { originalEvent: 'process', originalData: {...} },
  metadata: {
    routing: {
      filter: { service: 'worker' },
      down: true,
      up: true,
      originalRequestor: 'client-abc'
    }
  }
})
```

### **4. Compression/Encryption Hints**
```javascript
node.request({
  to: 'storage',
  event: 'store',
  data: largeBuffer,
  metadata: {
    compression: 'gzip',
    encrypted: false,
    originalSize: 1024000
  }
})
```

---

## ⚖️ **Backward Compatibility**

### **Reading Old Envelopes (without metadata)**
```javascript
// Old envelope (no metadata field)
// _calculateOffsets() gracefully handles:
// - If buffer ends after data, metadataLength = 0
// - envelope.metadata returns null

const oldEnvelope = new Envelope(oldBuffer)
console.log(oldEnvelope.metadata)  // → null
```

### **Writing Envelopes (optional metadata)**
```javascript
// Without metadata (backward compatible)
Envelope.createBuffer({
  type: EnvelopType.REQUEST,
  id: 123n,
  event: 'test',
  owner: 'node-1',
  recipient: 'node-2',
  data: { hello: 'world' }
  // metadata: not provided → metadataLength = 0
})

// With metadata (new feature)
Envelope.createBuffer({
  type: EnvelopType.REQUEST,
  id: 123n,
  event: 'test',
  owner: 'node-1',
  recipient: 'node-2',
  data: { hello: 'world' },
  metadata: { traceId: 'abc-123' }  // ← NEW
})
```

---

## 📊 **Performance Impact**

### **Overhead When NOT Using Metadata**
- **Size**: +2 bytes (metadataLength = 0)
- **Parse**: No decoding (metadataLength = 0, skip)
- **Impact**: Negligible (~0.1% overhead)

### **Overhead When Using Metadata**
- **Size**: +2 bytes + encoded metadata size
- **Parse**: Lazy (only decoded when `envelope.metadata` accessed)
- **Impact**: Depends on metadata size

### **Example Sizes**
```javascript
// No metadata
{ traceId: 'abc-123' }
// → 18 bytes (MessagePack encoded)

// Router forwarding
{ routing: { filter: {...}, down: true, up: true } }
// → ~50-100 bytes depending on filter complexity
```

---

## ✅ **Recommended Implementation Order**

1. **Envelope Layer** (`src/protocol/envelope.js`)
   - Update `createBuffer()` to accept optional `metadata`
   - Update `_calculateOffsets()` to parse metadata field
   - Add `metadata` getter
   - Add tests for metadata encoding/decoding

2. **Protocol Layer** (`src/protocol/protocol.js`)
   - Add `metadata` parameter to `request()` and `tick()`
   - Pass metadata to `Envelope.createBuffer()`
   - Add tests for metadata in protocol messages

3. **Node Layer** (`src/node.js`)
   - Add `metadata` parameter to `request()` and `tick()`
   - Pass metadata to protocol
   - Update documentation
   - Add integration tests

4. **Router Implementation** (Future Phase)
   - Use metadata for routing information
   - Keep user data clean

---

## 🤔 **Open Questions for Discussion**

1. **Metadata Size Limit**
   - Keep at 64KB (uint16)?
   - Or reduce to encourage small metadata?

2. **Metadata Schema**
   - Freeform object (current proposal)?
   - Or define standard fields?

3. **Metadata in Responses**
   - Should responses also have metadata?
   - Use case: Return trace info, timing, etc.

4. **Metadata Validation**
   - Should we validate metadata structure?
   - Or leave it completely flexible?

---

## 📋 **Next Steps**

Ready to implement? Here's what we'll do:

1. ✅ Review this design
2. ⏳ Implement envelope layer changes
3. ⏳ Add protocol layer support
4. ⏳ Expose in Node API
5. ⏳ Write comprehensive tests
6. ⏳ Update TypeScript definitions
7. ⏳ Document usage examples

What do you think? Should we proceed with this design? Any changes you'd like to make?

