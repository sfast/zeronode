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

Creating new Node.
```javascript
import Node from 'zeronode';

let node = new Node({
    id: 'node',
    bind: 'tcp://127.0.0.1:6000',
    options: {}
});
```

All three parameters are optional.

Methods:
1. `bind(address)` - Binds the node to the specified address. you can bind only in one address.
2. `connect(address)` - Connects the node to the specified address. you can connect to many nodes.
3. `unbind()` - Unbinds the node.
4. `disconnect(address)` - Disconnects the node from specified address.
5. `stop()` - Unbinds the node, and disconnects from all addresses.
6. `onRequest(endpoint, handler)` - adds request handler to given endpoint.
7. `onTick(event, handler)` - adds event handler to given event.
8. `offRequest(endpoint, handler)` - removes request handler from endpoint, if handler doesn't given then removes all handlers from endpoint.
9. `offTick(event, handler)` - removes event handlers from event, if handler doesn't givent then removes all handlers.
10. `request(id, endpoint, data, timeout)` - makes request to that endpoint of given node.
11. `tick(id, event, data)` - emits event to given node.
12. `requestAny(endpoint, data, timeout, filter)` - request one of the nodes that satisfies to given filter.
13. `tickAny(event, data, filter)` - ticks one of the nodes that satisfies to given filter.
14. `tickAll(event, data, filter)` - ticks to all nodes that satisfies to given filer.
15. `enableMetrics(interval)` - enables metrics, events will be triggered by given interval. Default interval is 1000 ms.
16. `disableMetrics()` - disables metrics.
17. `setLogLevel(level)` - sets log level to given level { error: 0, warn: 1, info: 2, verbose: 3, debug: 4, silly: 5 }.
18. `addFileToLog(filename, level)` - writes all logs above given level to given file.


### Examples

Simple example, nodeA -> nodeB. nodeB binds and listens some events, nodeA connects to nodeB and emits events.

nodeA.js
```javascript
import Node from 'zeronode'


(async function() {
   let nodeA = new Node({ options: { layer: 'A' } });
   let nodeB_id = 'nodeB';
   
   //** connect one node to another node with address
   await nodeA.connect('tcp://127.0.0.1:6000');
   
   // ** tick() is like firing an event to another node
   nodeA.tick(nodeB_id, 'welcome', 'Hi node B!!!');
   
   
   
   // ** you request to another node and getting a promise
   // ** which will be resolve after reply.
   let responseFromB = await nodeA.request(nodeB_id, 'welcome', 'Hi node B!!!');
   
   console.log(`response from B is "${responseFromB}"`);
   // response From B is "Hello A."
}());

```

nodeB.js
```javascript
import Node from 'zeronode';

(async function() {
   let nodeB = new Node({ id: 'nodeB',  bind: 'tcp://127.0.0.1:6000', options: { layer: 'B' } });
   
   // ** attach event listener to nodeB
   nodeB.onTick('welcome', (data) => {
       console.log('onTick - welcome', data);
   });
   
   
   // ** attach request listener to nodeB
   nodeB.onRequest('welcome', ({ body, reply }) => {
       console.log('onRequest - welcome', body);
       reply("Hello A.");
   });
   
   // ** bind node to given address
   await nodeB.bind();
}());

```

In this example, we will create one node that will bind in some address, and three nodes will connect to that node.
2 connected nodes will be in same group, 1 in another.

serverNode.js
```javascript
import Node from 'zeronode'

(async function() {
    let server = new Node({ bind: 'tcp://127.0.0.1:6000' });
    await server.bind();
}());


```


clientA1.js
```javascript
import Node from 'zeronode'

(async function() {
    let clientA1 = new Node({ options: { layer: 'A' } });
   
    clientA1.onTick('foobar', (msg) => {
        console.log(`go message in clientA1 ${msg}`);
    });
    
    await clientA1.connect('tcp:://127.0.0.1:6000');
}());
```


clientA2.js
```javascript
import Node from 'zeronode'

(async function() {
    let clientA2 = new Node({ options: { layer: 'A' } });
   
    clientA2.onTick('foobar', (msg) => {
        console.log(`go message in clientA2 ${msg}`);
    });
    
    await clientA2.connect('tcp:://127.0.0.1:6000');
}());
```

clientB1.js
```javascript
import Node from 'zeronode'

(async function() {
    let clientB1 = new Node({ options: { layer: 'B' } });
   
    clientB1.onTick('foobar', (msg) => {
        console.log(`go message in clientB1 ${msg}`);
    });
    
    await clientB1.connect('tcp:://127.0.0.1:6000');
}());
```

Now that all connections are set, we can send events.
```javascript
//this will tick one of the layer A nodes;
server.tickAny('foobar', { foo: 'bar' }, { layer: 'A' });

//this will tick to all layer A nodes;
server.tickAll('foobar', { foo: 'bar' }, { layer: 'A' });

//this will tick to all nodes that server connected to, or connected to server.
server.tickAll('foobar', { foo: 'bar' });


//you even can use regexp to filer nodes
server.tickAll('foobar', { foo: 'bar' }, {layer: /[A-Z]/})
```

### What We Are Using

Under the hood we are using [zeromq](http://zeromq.org)-s Dealer and Router sockets.