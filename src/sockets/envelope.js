import crypto from 'crypto'

// Constants
const LENGTH_SIZE = 1
const NULL_BYTE_REGEX = /\0/g
const METADATA_FIELD_COUNT = 4
const MIN_META_LENGTH = 2

class Parse {
  // serialize
  static dataToBuffer (data) {
    try {
      return Buffer.from(JSON.stringify({ data }))
    } catch (err) {
      console.error(err)
    }
  }

  // deserialize
  static bufferToData (data) {
    try {
      let ob = JSON.parse(data.toString())
      return ob.data
    } catch (err) {
      console.error(err)
    }
  }
}

export default class Envelop {
  constructor ({ type, id = '', tag = '', data, owner = '', recipient = '', mainEvent }) {
    if (type) {
      this.setType(type)
    }

    this.id = id || crypto.randomBytes(20).toString('hex')
    // Ensure string values, convert undefined/null to empty string
    this.tag = (tag !== undefined && tag !== null) ? String(tag) : ''
    this.owner = (owner !== undefined && owner !== null) ? String(owner) : ''
    this.recipient = (recipient !== undefined && recipient !== null) ? String(recipient) : ''
    this.mainEvent = mainEvent

    if (data) {
      this.data = data
    }
  }

  toJSON () {
    return {
      type: this.type,
      id: this.id,
      tag: this.tag,
      data: this.data,
      owner: this.owner,
      recipient: this.recipient,
      mainEvent: this.mainEvent
    }
  }

  /**
     *
     * @param buffer
     * @description {
     *      mainEvent: 1,
     *      type: 1,
     *      idLength: 4,
     *      id: idLength,
     *      ownerLength: 4,
     *      owner: ownerLength,
     *      recipientLength: 4,
     *      recipient: recipientLength,
     *      tagLength: 4,
     *      tag: tagLength
     * @return {{mainEvent: boolean, type, id: string, owner: string, recipient: string, tag: string}}
     */
  static readMetaFromBuffer (buffer) {
    let mainEvent = !!buffer.readInt8(0)

    let type = buffer.readInt8(1)

    let idStart = 2 + LENGTH_SIZE
    let idLength = buffer.readInt8(idStart - LENGTH_SIZE)
    let id = buffer.slice(idStart, idStart + idLength).toString('hex')

    let ownerStart = LENGTH_SIZE + idStart + idLength
    let ownerLength = buffer.readInt8(ownerStart - LENGTH_SIZE)
    let owner = buffer.slice(ownerStart, ownerStart + ownerLength).toString('utf8').replace(NULL_BYTE_REGEX, '')

    let recipientStart = LENGTH_SIZE + ownerStart + ownerLength
    let recipientLength = buffer.readInt8(recipientStart - LENGTH_SIZE)
    let recipient = buffer.slice(recipientStart, recipientStart + recipientLength).toString('utf8').replace(NULL_BYTE_REGEX, '')

    let tagStart = LENGTH_SIZE + recipientStart + recipientLength
    let tagLength = buffer.readInt8(tagStart - LENGTH_SIZE)
    let tag = buffer.slice(tagStart, tagStart + tagLength).toString('utf8').replace(NULL_BYTE_REGEX, '')

    return { mainEvent, type, id, owner, recipient, tag }
  }

  static readDataFromBuffer (buffer) {
    let dataBuffer = Envelop.getDataBuffer(buffer)
    return dataBuffer ? Parse.bufferToData(dataBuffer) : null
  }

  static getDataBuffer (buffer) {
    let metaLength = Envelop.getMetaLength(buffer)

    if (buffer.length > metaLength) {
      return buffer.slice(metaLength)
    }

    return null
  }

  static fromBuffer (buffer) {
    let { id, type, owner, recipient, tag, mainEvent } = Envelop.readMetaFromBuffer(buffer)
    let envelop = new Envelop({ type, id, tag, owner, recipient, mainEvent })

    let envelopData = Envelop.readDataFromBuffer(buffer)
    if (envelopData) {
      envelop.setData(envelopData)
    }

    return envelop
  }

  static stringToBuffer (str, encryption) {
    const strLength = Buffer.byteLength(str, encryption)
    const buffer = Buffer.allocUnsafe(LENGTH_SIZE + strLength) // Single allocation
    buffer.writeInt8(strLength, 0)
    buffer.write(str, LENGTH_SIZE, strLength, encryption)
    return buffer
  }

  static getMetaLength (buffer) {
    let length = MIN_META_LENGTH

    for (let i = 0; i < METADATA_FIELD_COUNT; i++) {
      length += LENGTH_SIZE + buffer.readInt8(length)
    }

    return length
  }

  getBuffer () {
    // Pre-calculate byte lengths for all string fields
    const idBytes = Buffer.byteLength(this.id, 'hex')
    const ownerBytes = Buffer.byteLength(this.owner, 'utf-8')
    const recipientBytes = Buffer.byteLength(this.recipient, 'utf-8')
    const tagBytes = Buffer.byteLength(this.tag, 'utf-8')
    
    // Calculate total buffer size
    let totalSize = 2 + // mainEvent (1 byte) + type (1 byte)
      (LENGTH_SIZE + idBytes) +
      (LENGTH_SIZE + ownerBytes) +
      (LENGTH_SIZE + recipientBytes) +
      (LENGTH_SIZE + tagBytes)
    
    // Include data buffer if present
    let dataBuffer = null
    if (this.data) {
      dataBuffer = Parse.dataToBuffer(this.data)
      if (dataBuffer) {
        totalSize += dataBuffer.length
      }
    }
    
    // Single allocation for entire envelope
    const buffer = Buffer.allocUnsafe(totalSize)
    let offset = 0
    
    // Write mainEvent and type
    buffer.writeInt8(+this.mainEvent, offset++)
    buffer.writeInt8(this.type, offset++)
    
    // Write id with length prefix
    buffer.writeInt8(idBytes, offset++)
    buffer.write(this.id, offset, idBytes, 'hex')
    offset += idBytes
    
    // Write owner with length prefix
    buffer.writeInt8(ownerBytes, offset++)
    buffer.write(this.owner, offset, ownerBytes, 'utf-8')
    offset += ownerBytes
    
    // Write recipient with length prefix
    buffer.writeInt8(recipientBytes, offset++)
    buffer.write(this.recipient, offset, recipientBytes, 'utf-8')
    offset += recipientBytes
    
    // Write tag with length prefix
    buffer.writeInt8(tagBytes, offset++)
    buffer.write(this.tag, offset, tagBytes, 'utf-8')
    offset += tagBytes
    
    // Copy data buffer if present
    if (dataBuffer) {
      dataBuffer.copy(buffer, offset)
    }
    
    return buffer
  }

  getId () {
    return this.id
  }

  getTag () {
    return this.tag
  }

  getOwner () {
    return this.owner
  }

  setOwner (owner) {
    this.owner = (owner !== undefined && owner !== null) ? String(owner) : ''
  }

  getRecipient () {
    return this.recipient
  }

  setRecipient (recipient) {
    this.recipient = (recipient !== undefined && recipient !== null) ? String(recipient) : ''
  }

  // ** type of envelop

  getType () {
    return this.type
  }

  setType (type) {
    this.type = type
  }

  // ** data of envelop

  getData () {
    return this.data
  }

  setData (data) {
    this.data = data
  }

  isMain () {
    return !!this.mainEvent
  }
}
