/**
 * Created by root on 7/12/17.
 */
import Promise from 'bluebird'

class RequestsInfo {
    constructor () {
        this.count = {
            in: 0,
            out: 0
        };
        this.delay = {
            send: 0,
            reply: 0,
            all: 0
        }
    }

    sendRequest () {
        this.count.out++;
    }

    gotRequest () {
        this.count.in++;
    }

    addDelay({sendTime, getTime, replyTime, replyGetTime}) {
        this.delay.send = ((getTime - sendTime) + this.count.out*this.delay.send) / (this.count.out + 1);
        this.delay.reply = ((replyGetTime - replyTime) + this.count.out*this.delay.reply) / (this.count.out + 1);
        this.delay.all = this.delay.send + this.delay.reply
    }
}

export default class Metric {
    constructor ({id}) {
        this.id = id;
        this.requests = new Map();
        this.ticks = new Map();
        this.cpu = 0;
        this.memory = process.memoryUsage().heapTotal / 1000000;
    }
    async getCpu() {
        let startUsage = process.cpuUsage();
        await new Promise(res => setTimeout(res, 100));
        let actualUsage = process.cpuUsage(startUsage);
        return this.cpu = (actualUsage.user + actualUsage.system) / 10000;
    }
    sendRequest(id) {
        if (!this.requests.has(id)) {
            let requestInfo = new RequestsInfo();
            requestInfo.sendRequest();
            return this.requests.set(id, requestInfo);
        }
        this.requests.get(id).sendRequest()
    }

    gotRequest(id) {
        if (!this.requests.has(id)) {
            let requestInfo = new RequestsInfo();
            requestInfo.gotRequest();
            return this.requests.set(id, requestInfo);
        }
        this.requests.get(id).gotRequest()
    }

    gotReply({id, sendTime, getTime, replyTime, replyGetTime}) {
        if (!this.requests.has(id)) {
            return;
        }
        this.requests.get(id).addDelay({sendTime, getTime, replyTime, replyGetTime});
    }

    sendTick(id) {
        if (!this.ticks.get(id)) {
            let tickInfo = {
                in: 0,
                out: 1
            };
            return this.ticks.set(id, tickInfo);
        }
        this.ticks.get(id).out++;
    }

    gotTick(id) {
        if (!this.ticks.get(id)) {
            let tickInfo = {
                in: 1,
                out: 0
            };
            return this.ticks.set(id, tickInfo);
        }
        this.ticks.get(id).in++;
    }

    flush() {
        this.requests = new Map();
        this.ticks = new Map();
        this.cpu = 0;
        this.memory = process.memoryUsage().heapTotal / 1000000;
    }
}
