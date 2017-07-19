import Promise from 'bluebird'
import Node from '../src/node'

const MESSAGE_COUNT = 1000;

let runner = new Node({ bind: 'tcp://127.0.0.1:6000', layer: 'R'});

let layerA = new Node({ bind: 'tcp://127.0.0.1:6001', layer: 'A'});
let layerB = new Node({ bind: 'tcp://127.0.0.1:6002', layer: 'B'});
let layerC = new Node({ bind: 'tcp://127.0.0.1:6003', layer : 'C' });

let errPrint = (err) => {console.log("error" , err)};

let all = [];

all.push(runner.bind());
all.push(layerA.bind());
all.push(layerB.bind());
all.push(layerC.bind());

let start = null;


let runnerbomb = null;

let _clearIntervals = () => {
    layerA.offTick('WELCOME');
    layerB.offTick('WELCOME');
    layerC.offTick('WELCOME');
};

let run = async () => {
    console.log("RUN");

    let i = 0;

    await Promise.all(all);
    console.log("All nodes are binded");
    await layerA.connect(layerB.getAddress());
    console.log("Layer A connected to B");
    await layerB.connect(layerC.getAddress());
    console.log("Layer B connected C");
    await layerC.connect(layerA.getAddress());
    console.log("Layer C connected to A");

    await runner.connect(layerA.getAddress());
    console.log("Runner connected to A");

    layerA.proxyTick('WELCOME', layerB.getId());
    layerB.proxyTick('WELCOME', layerC.getId());
    layerC.proxyTick('WELCOME', layerA.getId());

    layerA.onTick("WELCOME", (data) => {
        i++;
        console.log("A", i);
        if(i > MESSAGE_COUNT) {
            _clearIntervals();
            console.log(`Time passed: ` , Date.now() - start);
        }
    });

    start = Date.now();
    runner.tick(layerA.getId(), "WELCOME", 1).catch(errPrint);
};

run();