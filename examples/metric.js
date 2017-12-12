import Promise from 'bluebird'
import {NodeEvents as nodeEvents} from '../src'
import Node from '../src'

let node1 = new Node({ bind: 'tcp://127.0.0.1:6001', options : {layer: 'A'}});
let node2 = new Node({ bind: 'tcp://127.0.0.1:6002', options : {layer: 'B'}});

async function run () {
    try {
        // node2.addFileToLog({filename: '/root/tandz.txt', level: 'info'});
        node2.on(nodeEvents.METRICS, (metricInfo) => {
            console.log(metricInfo.requests);
        });
        node2.enableMetrics(3000);
        await node1.bind();
        await node2.connect(node1.getAddress());
        await new Promise(res => setTimeout(res, 1000));
        await node1.request(node2.getId(), 'fefefe', "jfhjehfjehfjkehfjke");
    } catch (err) {
        console.error(err);
    }
}

run();