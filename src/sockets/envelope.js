import _ from 'underscore'
import crypto from 'crypto'
import BufferAlloc from 'buffer-alloc'
import BufferFrom from 'buffer-from'

class Parse {
  // serialize
  static dataToBuffer (data) {
    try {
      return BufferFrom(JSON.stringify({ data }))
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

const lengthSize = 2

export default class Envelop {
  constructor ({ type, id = '', tag = '', data, owner = '', recipient = '', mainEvent, context }) {
    if (type) {
      this.setType(type)
    }

    this.id = id || crypto.randomBytes(20).toString('hex')
    this.tag = tag
    this.mainEvent = mainEvent
    this.context = context || {}

    if (data) {
      this.data = data
    }

    this.owner = owner
    this.recipient = recipient
  }

  toJSON () {
    return {
      type: this.type,
      id: this.id,
      tag: this.tag,
      context: this.context,
      data: this.data,
      owner: this.owner,
      recipient: this.recipient,
      mainEvent: this.mainEvent
    }
  }

  toMetaJSON () {
    return {
      type: this.type,
      id: this.id,
      tag: this.tag,
      context: this.context,
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
     *      tag: tagLength,
     *      contextLength: 4,
     *      context: contextLength
     * @return {{mainEvent: boolean, type, id: string, owner: string, recipient: string, tag: string}}
     */
  static readMetaFromBuffer (buffer) {
    let mainEvent = !!buffer.readInt8(0)

    let type = buffer.readInt8(1)

    let idStart = 2 + lengthSize
    let idLength = buffer.readUInt16BE(idStart - lengthSize)
    let id = buffer.slice(idStart, idStart + idLength).toString('hex')

    let ownerStart = lengthSize + idStart + idLength
    let ownerLength = buffer.readUInt16BE(ownerStart - lengthSize)
    let owner = buffer.slice(ownerStart, ownerStart + ownerLength).toString('utf8').replace(/\0/g, '')

    let recipientStart = lengthSize + ownerStart + ownerLength
    let recipientLength = buffer.readUInt16BE(recipientStart - lengthSize)
    let recipient = buffer.slice(recipientStart, recipientStart + recipientLength).toString('utf8').replace(/\0/g, '')

    let tagStart = lengthSize + recipientStart + recipientLength
    let tagLength = buffer.readUInt16BE(tagStart - lengthSize)
    let tag = buffer.slice(tagStart, tagStart + tagLength).toString('utf8').replace(/\0/g, '')

    // ** parsing context
    let contextStart = lengthSize + tagStart + tagLength
    let contextLength = buffer.readUInt16BE(contextStart - lengthSize)
    
    let context = {}
    try {
      context = JSON.parse(buffer.slice(contextStart, contextStart + contextLength).toString('utf8').replace(/\0/g, ''))
    } catch (err) {
       console.log("2222222AVAR::readMetaFromBuffer ERRORORORORO")
       // if its not parsable than assign an empty object
       context = {}
    }

    let dataSize = Envelop.getDataBufferSize(buffer)

    return { mainEvent, type, id, owner, recipient, tag, context, size: dataSize }
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

  static getDataBufferSize(buffer) {
    let metaLength = Envelop.getMetaLength(buffer)
    return buffer.length - metaLength;
  }

  static fromBuffer (buffer) {
    let { id, type, owner, recipient, tag, mainEvent, context } = Envelop.readMetaFromBuffer(buffer)
    let envelop = new Envelop({ type, id, tag, owner, recipient, mainEvent, context })

    let envelopData = Envelop.readDataFromBuffer(buffer)
    if (envelopData) {
      envelop.setData(envelopData)
    }

    envelop.size = buffer.length
    return envelop
  }

  static stringToBuffer (str, encryption) {
    let strLength = Buffer.byteLength(str, encryption)
    let lengthBuffer = BufferAlloc(lengthSize)
    lengthBuffer.writeUInt16BE(strLength)
    let strBuffer = BufferAlloc(strLength)
    strBuffer.write(str, 0, strLength, encryption)
    return Buffer.concat([lengthBuffer, strBuffer])
  }

  static getMetaLength (buffer) {
    let length = 2

    _.each(_.range(5), () => {
      length += lengthSize + buffer.readUInt16BE(length)
    })

    return length
  }

  getBuffer () {
    let bufferArray = []

    let mainEventBuffer = BufferAlloc(1)
    mainEventBuffer.writeInt8(+this.mainEvent)
    bufferArray.push(mainEventBuffer)

    let typeBuffer = BufferAlloc(1)
    typeBuffer.writeInt8(this.type)
    bufferArray.push(typeBuffer)

    let idBuffer = Envelop.stringToBuffer(this.id.toString(), 'hex')
    bufferArray.push(idBuffer)

    let ownerBuffer = Envelop.stringToBuffer(this.owner.toString(), 'utf-8')
    bufferArray.push(ownerBuffer)

    let recipientBuffer = Envelop.stringToBuffer(this.recipient.toString(), 'utf-8')
    bufferArray.push(recipientBuffer)

    let tagBuffer = Envelop.stringToBuffer(this.tag.toString(), 'utf-8')
    bufferArray.push(tagBuffer)

    let contextBuffer = Envelop.stringToBuffer(JSON.stringify(this.context || {}))
    bufferArray.push(contextBuffer)

    if (this.data) {
      bufferArray.push(Parse.dataToBuffer(this.data))
    }

    return Buffer.concat(bufferArray)
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
    this.owner = owner
  }

  getRecipient () {
    return this.recipient
  }

  setRecipient (recipient) {
    this.recipient = recipient
  }

  // ** type of envelop

  getType () {
    return this.type
  }

  setType (type) {
    this.type = type
  }

  getContext() {
    return this.context
  }

  setContext(context = {}) {
    this.context = { ...this.context, ...context }
  }

  // ** data of envelop

  getData (data) {
    return this.data
  }

  setData (data) {
    this.data = data
  }

  isMain () {
    return !!this.mainEvent
  }
}
