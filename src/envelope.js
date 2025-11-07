/**
 * Envelope Structure and Serialization
 * 
 * This file defines the binary format for Zeronode envelopes.
 * All envelope operations should reference this structure.
 * 
 * ============================================================================
 * ENVELOPE BINARY FORMAT
 * ============================================================================
 * 
 * All envelopes follow this structure:
 * 
 * ┌─────────────┬──────────┬─────────────────────────────────────┐
 * │   Field     │   Size   │          Description                │
 * ├─────────────┼──────────┼─────────────────────────────────────┤
 * │ type        │ 1 byte   │ Envelope type (REQUEST/RESPONSE/etc)│
 * │ timestamp   │ 4 bytes  │ Unix timestamp (seconds, uint32)    │
 * │ id          │ 8 bytes  │ Unique ID (owner hash + ts + counter)│
 * │ owner       │ 1+N bytes│ Length (1 byte) + UTF-8 string      │
 * │ recipient   │ 1+N bytes│ Length (1 byte) + UTF-8 string      │
 * │ tag         │ 1+N bytes│ Length (1 byte) + UTF-8 string      │
 * │ dataLength  │ 2 bytes  │ Data length (uint16, max 65535)     │
 * │ data        │ N bytes  │ MessagePack encoded data (or Buffer)│
 * └─────────────┴──────────┴─────────────────────────────────────┘
 * 
 * ============================================================================
 * OFFSET CALCULATION
 * ============================================================================
 * 
 * To read fields without parsing the entire envelope:
 * 
 * let offset = 0
 * 
 * // Type (1 byte)
 * const type = buffer[offset]
 * offset += 1
 * 
 * // Timestamp (4 bytes)
 * const timestamp = buffer.readUInt32BE(offset)
 * offset += 4
 * 
 * // ID (8 bytes) - BigInt format: high 32 bits | low 32 bits
 * const idHigh = buffer.readUInt32BE(offset)
 * const idLow = buffer.readUInt32BE(offset + 4)
 * const id = (BigInt(idHigh) << 32n) | BigInt(idLow)
 * offset += 8
 * 
 * // Owner (length-prefixed string)
 * const ownerLength = buffer[offset]
 * offset += 1
 * const owner = buffer.toString('utf8', offset, offset + ownerLength)
 * offset += ownerLength
 * 
 * // Recipient (length-prefixed string)
 * const recipientLength = buffer[offset]
 * offset += 1
 * const recipient = buffer.toString('utf8', offset, offset + recipientLength)
 * offset += recipientLength
 * 
 * // Tag (length-prefixed string)
 * const tagLength = buffer[offset]
 * offset += 1
 * const tag = buffer.toString('utf8', offset, offset + tagLength)
 * offset += tagLength
 * 
 * // Data length (2 bytes - uint16)
 * const dataLength = buffer.readUInt16BE(offset)
 * offset += 2
 * 
 * // Data (N bytes, length specified above)
 * const dataOffset = offset
 * const dataView = buffer.subarray(dataOffset, dataOffset + dataLength)
 * 
 * ============================================================================
 */

import msgpack from 'msgpack-lite'

// ============================================================================
// DATA SERIALIZATION (MessagePack with Buffer pass-through)
// ============================================================================

/**
 * Encode data to buffer
 * OPTIMIZATION: If data is already a Buffer, return as-is (zero-copy)
 * 
 * @param {*} data - Data to encode (Object, Array, Buffer, etc)
 * @returns {Buffer} Encoded buffer
 * @throws {Error} If data cannot be encoded
 */
export function encodeData (data) {
  // If already a buffer, return as-is (ZERO-COPY!)
  if (Buffer.isBuffer(data)) {
    return data
  }
  
  // Validate data is serializable
  // Reject functions, symbols, undefined (these can't be serialized)
  const type = typeof data
  if (type === 'function') {
    throw new Error('Cannot encode function as data')
  }
  if (type === 'symbol') {
    throw new Error('Cannot encode symbol as data')
  }
  
  // Detect circular references early
  try {
    JSON.stringify(data)
  } catch (err) {
    if (err.message.includes('circular')) {
      throw new Error('Cannot encode data with circular references')
    }
    // Other JSON errors might be fine for MessagePack
  }
  
  // Encode with MessagePack
  try {
    return msgpack.encode(data)
  } catch (err) {
    throw new Error(`Failed to encode data: ${err.message}`)
  }
}

/**
 * Decode buffer to data
 * OPTIMIZATION: If MessagePack decode fails, return raw buffer
 * 
 * @param {Buffer} buffer - Buffer to decode
 * @returns {*} Decoded data or raw buffer
 */
export function decodeData (buffer) {
  try {
    return msgpack.decode(buffer)
  } catch (err) {
    // If MessagePack decode fails, return raw buffer
    // This allows users to pass raw buffers and handle them manually
    return buffer
  }
}


/**
 * Hash owner ID to 16-bit value for global uniqueness
 * Simple hash function that distributes IDs across 65,536 buckets
 * @param {string} ownerId - Client/Server ID
 * @returns {number} 16-bit hash (0 to 65,535)
 */
function hashOwnerId (ownerId) {
  let hash = 0
  for (let i = 0; i < ownerId.length; i++) {
    hash = ((hash << 5) - hash) + ownerId.charCodeAt(i)
    hash = hash & hash  // Convert to 32-bit integer
  }
  return Math.abs(hash) & 0xFFFF  // Keep only 16 bits
}

/**
 * EnvelopeIdGenerator - Stateful ID generator with counter management
 * 
 * Manages per-second counter to ensure unique IDs within same owner.
 * Automatically resets counter every second and handles overflow.
 * 
 * Usage:
 *   const generator = new EnvelopeIdGenerator('client-1')
 *   const id1 = generator.next()
 *   const id2 = generator.next()
 */
export class EnvelopeIdGenerator {
  constructor (ownerId) {
    this.ownerId = ownerId
    this.lastSecond = 0
    this.counterPerSecond = 0
    this.maxCounter = 0xFFFF  // 65,535 requests/second
  }
  
  /**
   * Generate next unique envelope ID
   * @returns {bigint} 64-bit globally unique ID
   */
  next () {
    const nowSeconds = Math.floor(Date.now() / 1000)
    
    // Reset counter every second
    if (nowSeconds !== this.lastSecond) {
      this.lastSecond = nowSeconds
      this.counterPerSecond = 0
    }
    
    // Increment counter
    const counter = ++this.counterPerSecond
    
    // Check for overflow (more than 65K requests/second)
    if (counter > this.maxCounter) {
      // Wrap around (collision possible but rare)
      this.counterPerSecond = 1
      
      // Could log warning here if logger provided
      // console.warn(`[EnvelopeIdGenerator] Counter overflow: >65,535 req/s`)
    }
    
    // Generate globally unique ID: owner hash + timestamp + counter
    const ownerHash = hashOwnerId(this.ownerId)
  
    // Combine: [16 bits owner][32 bits timestamp][16 bits counter]
    return (BigInt(ownerHash) << 48n) | (BigInt(nowSeconds) << 16n) | BigInt(counter)
  }
}

// ============================================================================
// ENVELOPE CLASS (Reader + Writer)
// ============================================================================

/**
 * Envelope - Zero-copy envelope buffer reader
 * 
 * Reads fields directly from buffer at calculated offsets.
 * No caching, no intermediate allocations.
 * 
 * Benefits:
 * - Zero allocations (no buffer.slice())
 * - Lazy offset calculation (done once on first field access)
 * - Direct reads from buffer (no caching overhead)
 * - Simple and predictable performance
 * 
 * Usage pattern (typical):
 * - Each field is accessed once per envelope
 * - Caching would be unnecessary overhead
 * - Only exception: data deserialization is cached (expensive operation)
 */
export class Envelope {
  constructor (buffer) {
    // Store raw buffer reference (zero-copy)
    this._buffer = buffer
    
    // Offsets calculated on first field access (lazy)
    this._offsets = null
    
    // Only cache decoded data (expensive MessagePack decode)
    this._decodedData = undefined
  }
  
  /**
   * Get buffer bucket size using power-of-2 allocation strategy
   * 
   * Returns the next power-of-2 size that fits the requested size,
   * with minimum bucket of 64 bytes.
   * 
   * Examples:
   *   50 bytes  → 64 bytes
   *   100 bytes → 128 bytes
   *   200 bytes → 256 bytes
   *   500 bytes → 512 bytes
   *   1000 bytes → 1024 bytes
   * 
   * @param {number} size - Required size in bytes
   * @returns {number} Next power-of-2 bucket size (minimum 64)
   * @private
   */
  static _getBufferBucketSize (size) {
    // Minimum bucket size: 64 bytes
    // (typical small message: type + timestamp + id + short strings)
    const MIN_BUCKET = 64
    
    if (size <= MIN_BUCKET) {
      return MIN_BUCKET
    }
    
    // Find next power of 2
    // Using bit manipulation: 2^n where n = ceil(log2(size))
    // Example: 100 → 128 (2^7)
    let bucket = MIN_BUCKET
    while (bucket < size) {
      bucket <<= 1  // bucket *= 2
    }
    
    return bucket
  }
  
  /**
   * Create envelope buffer from message components (static factory method)
   * 
   * Optimized for performance:
   * - Single buffer allocation (allocUnsafe)
   * - Minimal type conversions
   * - Direct writes, no intermediate objects
   * 
   * @param {Object} params - Envelope components
   * @param {number} params.type - Envelope type (REQUEST/RESPONSE/etc)
   * @param {bigint|number} params.id - Unique envelope ID
   * @param {string} params.tag - Event name/tag
   * @param {string} params.owner - Sender ID
   * @param {string} params.recipient - Recipient ID
   * @param {*} params.data - Payload data (any type)
   * @param {string|null} [bufferStrategy=null] - Buffer allocation strategy (separate parameter)
   *   - null: Exact buffer size (default) - no memory waste
   *   - 'power-of-2': Power-of-2 bucket sizes (64, 128, 256, ...) - CPU cache-friendly
   * @returns {Buffer} Binary envelope buffer
   */
  static createBuffer ({ type, id, tag, owner, recipient, data }, bufferStrategy = null) {
    // ============================================================================
    // VALIDATION - Ensure all required fields are valid
    // ============================================================================
    
    // Validate type (must be a valid envelope type number)
    if (typeof type !== 'number' || type < 0 || type > 255) {
      throw new Error(`Invalid envelope type: ${type} (must be 0-255)`)
    }
    
    // Validate ID (bigint or number)
    if (typeof id !== 'bigint' && typeof id !== 'number') {
      throw new Error('ID must be bigint or number')
    }
    if (typeof id === 'number' && (id < 0 || !Number.isInteger(id))) {
      throw new Error(`Invalid ID: ${id} (must be non-negative integer)`)
    }
    
    // Validate required string fields
    if (!owner) {
      throw new Error('Owner is required')
    }
    
    // Tag is required for REQUEST and TICK, optional for RESPONSE and ERROR
    // (responses are matched by ID, not tag)
    const isResponse = type === 2 || type === 3  // RESPONSE = 2, ERROR = 3
    if (!tag && !isResponse) {
      throw new Error('Tag is required for REQUEST and TICK envelopes')
    }
    
    // Convert to strings (recipient can be empty for broadcasts, tag can be empty for responses)
    owner = typeof owner === 'string' ? owner : String(owner)
    recipient = typeof recipient === 'string' ? recipient : String(recipient || '')
    tag = typeof tag === 'string' ? tag : String(tag || '')
    
    // Calculate byte lengths (Buffer.byteLength handles UTF-8 correctly)
    const ownerBytes = Buffer.byteLength(owner, 'utf8')
    const recipientBytes = Buffer.byteLength(recipient, 'utf8')
    const tagBytes = Buffer.byteLength(tag, 'utf8')
    
    // Validate length prefixes fit in 1 byte (max 255)
    if (ownerBytes > 255) throw new Error(`Owner too long: ${ownerBytes} bytes (max 255)`)
    if (recipientBytes > 255) throw new Error(`Recipient too long: ${recipientBytes} bytes (max 255)`)
    if (tagBytes > 255) throw new Error(`Tag too long: ${tagBytes} bytes (max 255)`)
    
    // ============================================================================
    // DATA ENCODING - MessagePack or Buffer pass-through
    // ============================================================================
    
    let dataBuffer = null
    let dataLength = 0
    
    if (data !== undefined && data !== null) {
      // encodeData will:
      // 1. Return buffer as-is if already a Buffer (zero-copy)
      // 2. Validate data is serializable (no functions, symbols, circular refs)
      // 3. Encode with MessagePack
      // 4. Throw error if encoding fails
      dataBuffer = encodeData(data)
      dataLength = dataBuffer.length
      
      // Validate data length fits in 2 bytes (max 65535 = 64KB)
      if (dataLength > 65535) {
        throw new Error(`Data too large: ${dataLength} bytes (max 65535)`)
      }
    }
    
    // ============================================================================
    // BUFFER ALLOCATION - Power-of-2 bucket sizes for pooling
    // ============================================================================
    
    // Calculate exact size needed
    const totalSize = 1 +              // type (1 byte)
      4 +                               // timestamp (4 bytes)
      8 +                               // id (8 bytes)
      (1 + ownerBytes) +                // owner (length + bytes)
      (1 + recipientBytes) +            // recipient (length + bytes)
      (1 + tagBytes) +                  // tag (length + bytes)
      2 +                               // data length (2 bytes)
      dataLength                        // data (0 to 65535 bytes)
    
    // ============================================================================
    // BUFFER ALLOCATION - Strategy-based allocation
    // ============================================================================
    
    let bufferSize
    if (bufferStrategy === null || bufferStrategy === undefined) {
      // Default: Exact allocation - no memory waste
      bufferSize = totalSize
    } else {
      // Strategy provided: Use power-of-2 allocation
      // Benefits:
      // - Memory alignment: Power-of-2 is CPU cache-friendly
      // - Predictable allocation patterns
      // - Potential for future pooling if buffer lifecycle can be tracked
      bufferSize = Envelope._getBufferBucketSize(totalSize)
    }
    
    // Allocate buffer (allocUnsafe = no zero-fill, faster)
    const buffer = Buffer.allocUnsafe(bufferSize)
    
    let offset = 0
    
    // Write type (1 byte)
    buffer[offset++] = type
    
    // Write timestamp (4 bytes - seconds since Unix epoch)
    const timestamp = Math.floor(Date.now() / 1000)
    buffer.writeUInt32BE(timestamp, offset)
    offset += 4
    
    // Write ID (8 bytes: high 32 bits | low 32 bits)
    const idBig = typeof id === 'bigint' ? id : BigInt(id)
    const high = Number((idBig >> 32n) & 0xFFFFFFFFn)
    const low = Number(idBig & 0xFFFFFFFFn)
    buffer.writeUInt32BE(high, offset)
    buffer.writeUInt32BE(low, offset + 4)
    offset += 8
    
    // Write owner (length prefix + UTF-8 bytes)
    buffer[offset++] = ownerBytes
    if (ownerBytes > 0) {
      buffer.write(owner, offset, ownerBytes, 'utf8')
      offset += ownerBytes
    }
    
    // Write recipient (length prefix + UTF-8 bytes)
    buffer[offset++] = recipientBytes
    if (recipientBytes > 0) {
      buffer.write(recipient, offset, recipientBytes, 'utf8')
      offset += recipientBytes
    }
    
    // Write tag (length prefix + UTF-8 bytes)
    buffer[offset++] = tagBytes
    if (tagBytes > 0) {
      buffer.write(tag, offset, tagBytes, 'utf8')
      offset += tagBytes
    }
    
    // Write data length (2 bytes - uint16)
    buffer.writeUInt16BE(dataLength, offset)
    offset += 2
    
    // Copy data buffer if present (zero-copy when possible)
    if (dataBuffer) {
      dataBuffer.copy(buffer, offset)
      offset += dataLength
    }
    
    // Return only the slice we actually used (totalSize bytes)
    // The buffer may be larger (power-of-2 bucket), but we only send what we wrote
    // This is critical for network efficiency
    return buffer.subarray(0, totalSize)
  }
  
  /**
   * Calculate all field offsets (done once, on first field access)
   * Walks the buffer once to find where each field starts/ends
   */
  _calculateOffsets () {
    if (this._offsets) return this._offsets
    
    let offset = 0
    const buffer = this._buffer
    
    // Type (1 byte)
    const typeOffset = offset
    offset += 1
    
    // Timestamp (4 bytes)
    const timestampOffset = offset
    offset += 4
    
    // ID (8 bytes)
    const idOffset = offset
    offset += 8
    
    // Owner (1 byte length + N bytes data)
    const ownerLength = buffer[offset++]
    const ownerOffset = offset
    offset += ownerLength
    
    // Recipient (1 byte length + N bytes data)
    const recipientLength = buffer[offset++]
    const recipientOffset = offset
    offset += recipientLength
    
    // Tag (1 byte length + N bytes data)
    const tagLength = buffer[offset++]
    const tagOffset = offset
    offset += tagLength
    
    // Data length (2 bytes - uint16)
    const dataLength = buffer.readUInt16BE(offset)
    offset += 2
    
    // Data (N bytes, length specified above)
    const dataOffset = offset
    
    this._offsets = {
      type: typeOffset,
      timestamp: timestampOffset,
      id: idOffset,
      owner: ownerOffset,
      ownerBytes: ownerLength,
      recipient: recipientOffset,
      recipientBytes: recipientLength,
      tag: tagOffset,
      tagBytes: tagLength,
      data: dataOffset,
      dataBytes: dataLength
    }
    
    return this._offsets
  }
  
  /**
   * Get type (1 byte)
   * Read directly from buffer at offset 0
   */
  get type () {
    const offsets = this._calculateOffsets()
    return this._buffer[offsets.type]
  }
  
  /**
   * Get timestamp (4 bytes as uint32 - seconds since Unix epoch)
   * Read directly from buffer at offset 1
   */
  get timestamp () {
    const offsets = this._calculateOffsets()
    return this._buffer.readUInt32BE(offsets.timestamp)
  }
  
  /**
   * Get id (8 bytes as BigInt)
   * Read directly from buffer at offset 5 (after type + timestamp)
   */
  get id () {
    const offsets = this._calculateOffsets()
    const offset = offsets.id
    
    const high = this._buffer.readUInt32BE(offset)
    const low = this._buffer.readUInt32BE(offset + 4)
    return (BigInt(high) << 32n) | BigInt(low)
  }
  
  /**
   * Get owner (string)
   * Read directly from buffer at calculated offset
   */
  get owner () {
    const offsets = this._calculateOffsets()
    return this._buffer.toString(
      'utf8',
      offsets.owner,
      offsets.owner + offsets.ownerBytes
    )
  }
  
  /**
   * Get recipient (string)
   * Read directly from buffer at calculated offset
   */
  get recipient () {
    const offsets = this._calculateOffsets()
    return this._buffer.toString(
      'utf8',
      offsets.recipient,
      offsets.recipient + offsets.recipientBytes
    )
  }
  
  /**
   * Get tag (string)
   * Read directly from buffer at calculated offset
   */
  get tag () {
    const offsets = this._calculateOffsets()
    return this._buffer.toString(
      'utf8',
      offsets.tag,
      offsets.tag + offsets.tagBytes
    )
  }
  
  /**
   * Get data (deserialized)
   * ONLY FIELD THAT'S CACHED - MessagePack decode is expensive
   * 
   * Note: Handlers may access envelope.data multiple times,
   * so we cache the decoded result to avoid re-decoding.
   */
  get data () {
    // Return cached if already decoded
    if (this._decodedData !== undefined) {
      return this._decodedData
    }
    
    const offsets = this._calculateOffsets()
    
    if (offsets.dataBytes === 0) {
      this._decodedData = null
      return null
    }
    
    // Deserialize directly from original buffer (no slice!)
    const dataView = this._buffer.subarray(
      offsets.data,
      offsets.data + offsets.dataBytes
    )
    
    this._decodedData = decodeData(dataView)
    return this._decodedData
  }
  
  /**
   * Get raw data bytes (for manual parsing or forwarding)
   * Returns a view (not a copy) of the data portion
   */
  getDataView () {
    const offsets = this._calculateOffsets()
    
    if (offsets.dataBytes === 0) {
      return null
    }
    
    return this._buffer.subarray(
      offsets.data,
      offsets.data + offsets.dataBytes
    )
  }
  
  /**
   * Get raw buffer (for forwarding without parsing)
   */
  getBuffer () {
    return this._buffer
  }
  
  /**
   * Convert to plain object (force parse all fields)
   */
  toObject () {
    return {
      type: this.type,
      timestamp: this.timestamp,
      id: this.id,
      owner: this.owner,
      recipient: this.recipient,
      tag: this.tag,
      data: this.data
    }
  }
}
