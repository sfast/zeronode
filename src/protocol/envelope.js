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
 * ┌──────────────┬──────────┬─────────────────────────────────────┐
 * │   Field      │   Size   │          Description                │
 * ├──────────────┼──────────┼─────────────────────────────────────┤
 * │ type         │ 1 byte   │ Envelope type (REQUEST/RESPONSE/etc)│
 * │ timestamp    │ 4 bytes  │ Unix timestamp (seconds, uint32)    │
 * │ id           │ 8 bytes  │ Unique ID (owner hash + ts + counter)│
 * │ owner        │ 1+N bytes│ Length (1 byte) + UTF-8 string      │
 * │ recipient    │ 1+N bytes│ Length (1 byte) + UTF-8 string      │
 * │ event        │ 1+N bytes│ Length (1 byte) + UTF-8 string      │
 * │ dataLength   │ 2 bytes  │ Data length (uint16, max 65535)     │
 * │ data         │ N bytes  │ MessagePack encoded user data       │
 * │ metaLength   │ 2 bytes  │ Metadata length (uint16, max 65535) │
 * │ metadata     │ N bytes  │ MessagePack encoded metadata        │
 * └──────────────┴──────────┴─────────────────────────────────────┘
 * 
 * NOTES:
 * - metadata field is OPTIONAL (metaLength = 0 for no metadata)
 * - Old envelopes without metadata are backward compatible
 * - User data stays in 'data', system info goes in 'metadata'
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
 * // Event (length-prefixed string)
 * const eventLength = buffer[offset]
 * offset += 1
 * const event = buffer.toString('utf8', offset, offset + eventLength)
 * offset += eventLength
 * 
 * // Data length (2 bytes - uint16)
 * const dataLength = buffer.readUInt16BE(offset)
 * offset += 2
 * 
 * // Data (N bytes, length specified above)
 * const dataOffset = offset
 * offset += dataLength
 * 
 * // Metadata length (2 bytes - uint16)
 * const metadataLength = buffer.readUInt16BE(offset)
 * offset += 2
 * 
 * // Metadata (N bytes, length specified above)
 * const metadataOffset = offset
 * const metadataView = buffer.subarray(metadataOffset, metadataOffset + metadataLength)
 * 
 * ============================================================================
 */

import msgpack from 'msgpack-lite'

// ============================================================================
// ENVELOPE TYPES
// ============================================================================

/**
 * Envelope type identifiers
 * These define the type of message being sent
 */
export const EnvelopType = {
  TICK: 1,        // Fire-and-forget message (no response expected)
  REQUEST: 2,     // Request message (expects RESPONSE or ERROR)
  RESPONSE: 3,    // Success response to a REQUEST
  ERROR: 4        // Error response to a REQUEST
}

// ============================================================================
// BUFFER ALLOCATION STRATEGY
// ============================================================================

/**
 * Buffer allocation strategy for envelope creation
 * 
 * EXACT (default):
 *   - Allocates exact buffer size needed
 *   - Zero memory waste
 *   - More GC pressure (varied sizes)
 * 
 * POWER_OF_2:
 *   - Allocates power-of-2 bucket sizes (64, 128, 256, 512, ...)
 *   - CPU cache-friendly (aligned allocations)
 *   - Ready for buffer pooling (if lifecycle can be tracked)
 *   - ~25% memory overhead on average
 */
export const BufferStrategy = {
  EXACT: null,              // Default: exact allocation (no strategy)
  POWER_OF_2: 'power-of-2'  // Power-of-2 bucket sizes
}

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
export function encodeDataToBuffer (data) {
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
export function decodeBufferToData (buffer) {
  try {
    return msgpack.decode(buffer)
  } catch (err) {
    // If MessagePack decode fails, return raw buffer
    // This allows users to pass raw buffers and handle them manually
    return buffer
  }
}


/**
 * Hash owner ID to 16-bit value using FNV-1a algorithm
 * Better distribution than simple djb2-style hash
 * @param {string} ownerId - Client/Server ID
 * @returns {number} 16-bit hash (0 to 65,535)
 */
function hashOwnerId (ownerId) {
  // FNV-1a parameters for 32-bit
  const FNV_PRIME = 0x01000193
  const FNV_OFFSET = 0x811c9dc5
  
  let hash = FNV_OFFSET
  for (let i = 0; i < ownerId.length; i++) {
    hash ^= ownerId.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME)
  }
  
  // Fold 32-bit hash to 16-bit for better distribution
  return ((hash >>> 16) ^ (hash & 0xFFFF)) & 0xFFFF
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
 * 
 * With optional logger:
 *   const generator = new EnvelopeIdGenerator('client-1', { logger: console })
 */
export class EnvelopeIdGenerator {
  constructor (ownerId, options = {}) {
    this.ownerId = ownerId
    this.lastSecond = 0
    this.counterPerSecond = 0
    this.maxCounter = 0xFFFF  // 65,535 requests/second
    this.logger = options.logger || null
    this.overflowCount = 0  // Track how often overflow happens per second
  }
  
  /**
   * Generate next unique envelope ID
   * @returns {bigint} 64-bit globally unique ID
   */
  next () {
    const nowSeconds = Math.floor(Date.now() / 1000)
    
    // Reset counter every second
    if (nowSeconds !== this.lastSecond) {
      // Log overflow stats if it happened in the previous second
      if (this.overflowCount > 0 && this.logger) {
        this.logger.warn(`[EnvelopeIdGenerator] Counter overflowed ${this.overflowCount} times in last second for owner "${this.ownerId}"`)
      }
      
      this.lastSecond = nowSeconds
      this.counterPerSecond = 0
      this.overflowCount = 0
    }
    
    // Increment counter
    const counter = ++this.counterPerSecond
    
    // Check for overflow (more than 65K requests/second)
    if (counter > this.maxCounter) {
      // Wrap around (collision possible but rare)
      this.counterPerSecond = 1
      this.overflowCount++
      
      // Log warning on first overflow in this second
      if (this.overflowCount === 1 && this.logger) {
        this.logger.warn(`[EnvelopeIdGenerator] Counter overflow: >65,535 req/s for owner "${this.ownerId}"`)
      }
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
  // Envelope size constants
  static MIN_BUFFER_BUCKET = 64
  static MAX_STRING_LENGTH = 255
  static MAX_DATA_LENGTH = 65535
  static MIN_ENVELOPE_SIZE = 18  // type(1) + ts(4) + id(8) + owner_len(1) + recipient_len(1) + tag_len(1) + data_len(2)
  
  constructor (buffer) {
    // Validate buffer
    if (!Buffer.isBuffer(buffer)) {
      throw new Error('Envelope requires a Buffer instance')
    }
    
    if (buffer.length < Envelope.MIN_ENVELOPE_SIZE) {
      throw new Error(`Envelope buffer too small: ${buffer.length} bytes (min ${Envelope.MIN_ENVELOPE_SIZE})`)
    }
    
    // Store raw buffer reference (zero-copy)
    this._buffer = buffer
    
    // Offsets calculated on first field access (lazy)
    this._offsets = null
    
    // Only cache decoded data/metadata (expensive MessagePack decode)
    this._decodedData = undefined
    this._decodedMetadata = undefined
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
    if (size <= Envelope.MIN_BUFFER_BUCKET) {
      return Envelope.MIN_BUFFER_BUCKET
    }
    
    // Find next power of 2
    // Using bit manipulation: 2^n where n = ceil(log2(size))
    // Example: 100 → 128 (2^7)
    let bucket = Envelope.MIN_BUFFER_BUCKET
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
  static createBuffer ({ type, id, event, owner, recipient, data, metadata }, bufferStrategy = null) {
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
    
    // Event is required for REQUEST and TICK, optional for RESPONSE and ERROR
    // (responses are matched by ID, not event)
    const isResponse = type === EnvelopType.RESPONSE || type === EnvelopType.ERROR
    if (!event && !isResponse) {
      throw new Error('Event is required for REQUEST and TICK envelopes')
    }
    
    // Convert to strings (recipient can be empty for broadcasts, event can be empty for responses)
    owner = typeof owner === 'string' ? owner : String(owner)
    recipient = typeof recipient === 'string' ? recipient : String(recipient || '')
    event = typeof event === 'string' ? event : String(event || '')
    
    // Calculate byte lengths (Buffer.byteLength handles UTF-8 correctly)
    const ownerBytes = Buffer.byteLength(owner, 'utf8')
    const recipientBytes = Buffer.byteLength(recipient, 'utf8')
    const eventBytes = Buffer.byteLength(event, 'utf8')
    
    // Validate length prefixes fit in 1 byte (max 255)
    if (ownerBytes > Envelope.MAX_STRING_LENGTH) {
      throw new Error(`Owner too long: ${ownerBytes} bytes (max ${Envelope.MAX_STRING_LENGTH})`)
    }
    if (recipientBytes > Envelope.MAX_STRING_LENGTH) {
      throw new Error(`Recipient too long: ${recipientBytes} bytes (max ${Envelope.MAX_STRING_LENGTH})`)
    }
    if (eventBytes > Envelope.MAX_STRING_LENGTH) {
      throw new Error(`Event too long: ${eventBytes} bytes (max ${Envelope.MAX_STRING_LENGTH})`)
    }
    
    // ============================================================================
    // DATA ENCODING - MessagePack or Buffer pass-through
    // ============================================================================
    
    let dataBuffer = null
    let dataLength = 0
    
    if (data !== undefined && data !== null) {
      // encodeDataToBuffer will:
      // 1. Return buffer as-is if already a Buffer (zero-copy)
      // 2. Validate data is serializable (no functions, symbols, circular refs)
      // 3. Encode with MessagePack
      // 4. Throw error if encoding fails
      dataBuffer = encodeDataToBuffer(data)
      dataLength = dataBuffer.length
      
      // Validate data length fits in 2 bytes (max 65535 = 64KB)
      if (dataLength > Envelope.MAX_DATA_LENGTH) {
        throw new Error(`Data too large: ${dataLength} bytes (max ${Envelope.MAX_DATA_LENGTH})`)
      }
    }
    
    // ============================================================================
    // METADATA ENCODING - MessagePack or Buffer pass-through
    // ============================================================================
    
    let metadataBuffer = null
    let metadataLength = 0
    
    if (metadata !== undefined && metadata !== null) {
      // Encode metadata same as data
      metadataBuffer = encodeDataToBuffer(metadata)
      metadataLength = metadataBuffer.length
      
      // Validate metadata length fits in 2 bytes (max 65535 = 64KB)
      if (metadataLength > Envelope.MAX_DATA_LENGTH) {
        throw new Error(`Metadata too large: ${metadataLength} bytes (max ${Envelope.MAX_DATA_LENGTH})`)
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
      (1 + eventBytes) +                // event (length + bytes)
      2 +                               // data length (2 bytes)
      dataLength +                      // data (0 to 65535 bytes)
      2 +                               // metadata length (2 bytes)
      metadataLength                    // metadata (0 to 65535 bytes)
    
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
    
    // Write event (length prefix + UTF-8 bytes)
    buffer[offset++] = eventBytes
    if (eventBytes > 0) {
      buffer.write(event, offset, eventBytes, 'utf8')
      offset += eventBytes
    }
    
    // Write data length (2 bytes - uint16)
    buffer.writeUInt16BE(dataLength, offset)
    offset += 2
    
    // Copy data buffer if present (zero-copy when possible)
    if (dataBuffer) {
      dataBuffer.copy(buffer, offset)
      offset += dataLength
    }
    
    // Write metadata length (2 bytes - uint16)
    buffer.writeUInt16BE(metadataLength, offset)
    offset += 2
    
    // Copy metadata buffer if present
    if (metadataBuffer) {
      metadataBuffer.copy(buffer, offset)
      offset += metadataLength
    }
    
    // Return only the slice we actually used (totalSize bytes)
    // The buffer may be larger (power-of-2 bucket), but we only send what we wrote
    // This is critical for network efficiency
    return buffer.subarray(0, totalSize)
  }
  
  /**
   * Calculate all field offsets (done once, on first field access)
   * Walks the buffer once to find where each field starts/ends
   * Includes bounds checking to prevent crashes on malformed envelopes
   */
  _calculateOffsets () {
    if (this._offsets) return this._offsets
    
    let offset = 0
    const buffer = this._buffer
    const bufferLength = buffer.length
    
    // Helper to check bounds before reading
    const checkBounds = (offset, size, fieldName) => {
      if (offset + size > bufferLength) {
        throw new Error(
          `Malformed envelope: ${fieldName} extends beyond buffer ` +
          `(offset ${offset}, size ${size}, buffer ${bufferLength})`
        )
      }
    }
    
    // Type (1 byte)
    checkBounds(offset, 1, 'type')
    const typeOffset = offset
    offset += 1
    
    // Timestamp (4 bytes)
    checkBounds(offset, 4, 'timestamp')
    const timestampOffset = offset
    offset += 4
    
    // ID (8 bytes)
    checkBounds(offset, 8, 'id')
    const idOffset = offset
    offset += 8
    
    // Owner (1 byte length + N bytes data)
    checkBounds(offset, 1, 'owner length')
    const ownerLength = buffer[offset++]
    checkBounds(offset, ownerLength, 'owner data')
    const ownerOffset = offset
    offset += ownerLength
    
    // Recipient (1 byte length + N bytes data)
    checkBounds(offset, 1, 'recipient length')
    const recipientLength = buffer[offset++]
    checkBounds(offset, recipientLength, 'recipient data')
    const recipientOffset = offset
    offset += recipientLength
    
    // Event (1 byte length + N bytes data)
    checkBounds(offset, 1, 'event length')
    const eventLength = buffer[offset++]
    checkBounds(offset, eventLength, 'event data')
    const eventOffset = offset
    offset += eventLength
    
    // Data length (2 bytes - uint16)
    checkBounds(offset, 2, 'data length')
    const dataLength = buffer.readUInt16BE(offset)
    offset += 2
    
    // Data (N bytes, length specified above)
    checkBounds(offset, dataLength, 'data')
    const dataOffset = offset
    offset += dataLength
    
    // Metadata length (2 bytes - uint16) - OPTIONAL for backward compatibility
    let metadataLength = 0
    let metadataOffset = 0
    
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
      type: typeOffset,
      timestamp: timestampOffset,
      id: idOffset,
      owner: ownerOffset,
      ownerBytes: ownerLength,
      recipient: recipientOffset,
      recipientBytes: recipientLength,
      event: eventOffset,
      eventBytes: eventLength,
      data: dataOffset,
      dataBytes: dataLength,
      metadata: metadataOffset,
      metadataBytes: metadataLength
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
   * Get event (string)
   * Read directly from buffer at calculated offset
   */
  get event () {
    const offsets = this._calculateOffsets()
    return this._buffer.toString(
      'utf8',
      offsets.event,
      offsets.event + offsets.eventBytes
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
    
    this._decodedData = decodeBufferToData(dataView)
    return this._decodedData
  }
  
  /**
   * Get metadata (lazy parsed)
   * Returns decoded metadata object or null if no metadata present
   */
  get metadata () {
    // Return cached if already decoded
    if (this._decodedMetadata !== undefined) {
      return this._decodedMetadata
    }
    
    const offsets = this._calculateOffsets()
    
    if (offsets.metadataBytes === 0) {
      this._decodedMetadata = null
      return null
    }
    
    // Deserialize metadata from buffer
    const metadataView = this._buffer.subarray(
      offsets.metadata,
      offsets.metadata + offsets.metadataBytes
    )
    
    this._decodedMetadata = decodeBufferToData(metadataView)
    return this._decodedMetadata
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
      event: this.event,
      data: this.data
    }
  }
  
  /**
   * Validate envelope structure without throwing
   * @returns {{ valid: boolean, error: string|null }}
   */
  validate () {
    try {
      // Try to calculate offsets (includes bounds checking)
      const offsets = this._calculateOffsets()
      
      // Validate type is in valid range (1-4: TICK, REQUEST, RESPONSE, ERROR)
      const type = this.type
      if (type < 1 || type > 4) {
        return { valid: false, error: `Invalid envelope type: ${type} (expected 1-4)` }
      }
      
      // Check total size matches
      const expectedSize = offsets.data + offsets.dataBytes
      if (expectedSize > this._buffer.length) {
        return { 
          valid: false, 
          error: `Envelope size mismatch: expected ${expectedSize}, got ${this._buffer.length}` 
        }
      }
      
      return { valid: true, error: null }
    } catch (err) {
      return { valid: false, error: err.message }
    }
  }
}
