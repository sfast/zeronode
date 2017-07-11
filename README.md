# nodik-zmq

### About
 
With nodik-zmq its easy to create server(s) <---> server(s) communication 
<br/>(e.g microservices).

### Dependencies 
You need to install zeromq lib for using Nodik.

### How To Install

```bash
$ npm install nodik-zmq
```

### Run Tests
```bash
$ npm test
```

### How To Use

```ecmascript 6

let layerA = new Node({ bind: 'tcp://127.0.0.1:6001', layer: 'A'});
let layerB = new Node({ bind: 'tcp://127.0.0.1:6002', layer: 'B'});

// ** bind nodiks to a port to listen
await layerA.bind();
await layerB.bind();

//** connect one nodik to another nodik with address
await layerA.connect(layerB.getAddress());

// ** attach event listener to nodik layerB
layerB.onTick('welcome', (data) => {
    console.log('onTick - welcome', data);
});

// ** tick() is like firing an event to another node
layerA.tick(layerB.getId(), 'welcome', 'B');

// ** attach request listener to nodik layerB
layerB.onRequest('welcome', (data) => {
    console.log('onRequest - welcome', data.body);
    data.reply("Hello A");
});

// ** you request to another nodik and getting a promise
// ** which will be resolve after  data.reply("Hello A");
let responseFromB = await layerA.request(layerB.getId(), 'welcome', 'B');
console.log(responseFromB);
// responseFromB is "Hello A"
```

You can create various layers(groups) of nodik-s, connect nodiks together,
proxy events and request from one nodik to another.

```ecmascript 6

layerA.proxyRequest(fromEndpoint, tonNodeId, toEndpoint, timeout);

layerA.proxyTick(eventToProxy, tonNodeId, timeout);

```

### What We Are Using

Under the hood we are using http://zeromq.org/ -s Dealer and Router sockets.