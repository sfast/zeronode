# zeroNode

### About
 
With zeroNode it's easy to create server(s) <---> server(s) communication 
<br/>(e.g microservices).

### How To Install
First of all check if you have installed [zeromq](http://zeromq.org).

After that you can install zeronode.

```bash
$ npm install zeronode
```

### How To Use

```ecmascript 6
import Node from 'zeronode'

let nodeA = new Node({ bind: 'tcp://127.0.0.1:6001', options: {layer: 'A'}});
let nodeB = new Node({ bind: 'tcp://127.0.0.1:6002', options: {layer: 'B'}});

// ** bind nodes to a port to listen
await nodeB.bind();

//** connect one node to another node with address
await nodeA.connect(nodeB.getAddress());

// ** attach event listener to nodeB
nodeB.onTick('welcome', (data) => {
    console.log('onTick - welcome', data);
});

// ** tick() is like firing an event to another node
nodeA.tick(nodeB.getId(), 'welcome', 'B');

// ** attach request listener to nodeB
nodeB.onRequest('welcome', (data) => {
    console.log('onRequest - welcome', data.body);
    data.reply("Hello A");
});

// ** you request to another node and getting a promise
// ** which will be resolve after  data.reply("Hello A");
let responseFromB = await nodeA.request(nodeB.getId(), 'welcome', 'B');
console.log(responseFromB);
// responseFromB is "Hello A"
```

You can create various layers(groups) of nodes, connect nodes together, tick and request messages from node to another.

You can also listen events by patterns. 
```ecmascript 6
nodeB.onTick(/^foo/, handler);
nodeA.tick(nodeB.getId(), 'foobar', {foo: 'bar'})

```

### What We Are Using

Under the hood we are using [zeromq](http://zeromq.org)-s Dealer and Router sockets.