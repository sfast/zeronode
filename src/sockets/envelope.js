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

const lengthSize = 1

export default class Envelop {
  constructor ({type, id = '', tag = '', data, owner = '', recipient = '', mainEvent}) {
    if (type) {
      this.setType(type)
    }

    this.id = id || crypto.randomBytes(20).toString('hex')
    this.tag = tag
    this.mainEvent = mainEvent

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

    let idStart = 2 + lengthSize
    let idLength = buffer.readInt8(idStart - lengthSize)
    let id = buffer.slice(idStart, idStart + idLength).toString('hex')

    let ownerStart = lengthSize + idStart + idLength
    let ownerLength = buffer.readInt8(ownerStart - lengthSize)
    let owner = buffer.slice(ownerStart, ownerStart + ownerLength).toString('utf8').replace(/\0/g, '')

    let recipientStart = lengthSize + ownerStart + ownerLength
    let recipientLength = buffer.readInt8(recipientStart - lengthSize)
    let recipient = buffer.slice(recipientStart, recipientStart + recipientLength).toString('utf8').replace(/\0/g, '')

    let tagStart = lengthSize + recipientStart + recipientLength
    let tagLength = buffer.readInt8(tagStart - lengthSize)
    let tag = buffer.slice(tagStart, tagStart + tagLength).toString('utf8').replace(/\0/g, '')

    return {mainEvent, type, id, owner, recipient, tag}
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
    let {id, type, owner, recipient, tag, mainEvent} = Envelop.readMetaFromBuffer(buffer)
    let envelop = new Envelop({type, id, tag, owner, recipient, mainEvent})

    let envelopData = Envelop.readDataFromBuffer(buffer)
    if (envelopData) {
      envelop.setData(envelopData)
    }

    return envelop
  }

  static stringToBuffer (str, encryption) {
    let strLength = Buffer.byteLength(str, encryption)
    let lengthBuffer = BufferAlloc(lengthSize)
    lengthBuffer.writeInt8(strLength)
    let strBuffer = BufferAlloc(strLength)
    strBuffer.write(str, 0, strLength, encryption)
    return Buffer.concat([lengthBuffer, strBuffer])
  }

  static getMetaLength (buffer) {
    let length = 2

    _.each(_.range(4), () => {
      length += lengthSize + buffer.readInt8(length)
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
