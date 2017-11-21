import crypto from 'crypto';
import BufferAlloc from 'buffer-alloc';

class Parse {
    // serialize
    static dataToBuffer (data) {
        try {
            return new Buffer(JSON.stringify({ data }));
        }
        catch(err) {
            console.error(err);
        }
    }

    // deserialize
    static bufferToData (data) {
        try {
            let ob =  JSON.parse(data.toString());
            return ob.data;
        } catch(err) {
            console.error(err);
        }
    }
}


export default class Envelop {
    constructor({type, id, tag, data, owner = null, recipient = ''}) {
        if(type) {
            this.setType(type);
        }

        this.id = id || crypto.randomBytes(20).toString("hex");
        this.tag = tag;

        if(data) {
            this.data = data;
        }

        this.owner = owner;
        this.recipient = recipient;
    }

    static readMetaFromBuffer(buffer) {
        let type = buffer.readInt8(0);
        let id = buffer.slice(1,21).toString("hex");
        let owner = buffer.slice(21,41).toString('utf8').replace(/\0/g, '');
        let recipient = buffer.slice(41,61).toString('utf8').replace(/\0/g, '');
        let tag = buffer.slice(61,81).toString('utf8').replace(/\0/g, '');
        return {type, id, owner, recipient, tag};
    }

    static readDataFromBuffer(buffer) {
        let dataBuffer = Envelop.getDataBuffer(buffer);
        return dataBuffer ? Parse.bufferToData(dataBuffer) : null;
    }

    static getDataBuffer(buffer) {
        if(buffer.length > 81){
            return buffer.slice(81);
        }

        return null;
    }

    static fromBuffer(buffer) {
        let {id, type, owner, recipient, tag} = Envelop.readMetaFromBuffer(buffer);
        let envelop =  new Envelop({type, id, tag, owner, recipient});

        let envelopData = Envelop.readDataFromBuffer(buffer);
        if(envelopData) {
            envelop.setData(envelopData);
        }

        return envelop;
    }

    getBuffer() {
        let bufferArray = [];

        let typeBuffer = BufferAlloc(1);
        typeBuffer.writeInt8(this.type);
        bufferArray.push(typeBuffer);

        let idBuffer = BufferAlloc(20);
        idBuffer.write(this.id, 0, 20, 'hex');
        bufferArray.push(idBuffer);

        let ownerBuffer = BufferAlloc(20);
        ownerBuffer.write(this.owner.toString());
        bufferArray.push(ownerBuffer);

        let recipientBuffer = BufferAlloc(20);
        recipientBuffer.write(this.recipient.toString());
        bufferArray.push(recipientBuffer);

        let tagBuffer = BufferAlloc(20, '');
        tagBuffer.write(this.tag.toString());
        bufferArray.push(tagBuffer);

        if(this.data) {
            bufferArray.push(Parse.dataToBuffer(this.data));
        }

        return Buffer.concat(bufferArray);
    }

    getId() {
        return this.id;
    }

    getTag() {
        return this.tag;
    }

    getOwner() {
        return this.owner;
    }

    setOwner(owner) {
        this.owner = owner;
    }

    getRecipient() {
        return this.recipient;
    }

    setRecipient(recipient) {
        this.recipient = recipient;
    }

    // ** type of envelop

    getType() {
        return this.type;
    }

    setType(type) {
        this.type = type;
    }

    // ** data of envelop

    getData(data) {
        return this.data;
    }

    setData(data) {
        this.data = data;
    }
}