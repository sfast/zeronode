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

### Abstract - What is a Node ?
- Think of every Node as an actor (participant) in a networking of entire system (server, vm, process, container etc ...)
- Data transfers between Node-s via both request/reply and tick (fire forget) manner.
- Node (as a server) can bind to a port and listen to requests and ticks from other Nodes
- Node (as a client) can connect to other server Node and send requests and ticks.
- Much more interesting patterns and features you can discover by reading the document or try to reach us via Drift Chat under [Steadfast.tech]: http://steadfast.tech  

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

Basic methods
1. `bind(address)` - Binds the node to the specified address. you can bind only in one address.
2. `connect(address)` - Connects the node to the specified address. you can connect to many nodes.
3. `unbind()` - Unbinds the node.
4. `disconnect(address)` - Disconnects the node from specified address.
5. `stop()` - Unbinds the node, and disconnects from all addresses.

Simple messaging methods

6. `onRequest(endpoint: String, handler)` - adds request handler to given endpoint.

7. `onTick(event: String, handler)` - adds event handler to given event.

8. `offRequest(endpoint:String, handler)` - removes request handler from endpoint
if handler is not provided then removes all the listeners.

9. `offTick(event: String, handler)` - removes given event handler from event listeners list
if handler is not provided then removes all the listeners.

10. `request(id, endpoint, data, timeout)` - makes request to that endpoint of given node.

11. `tick(id, event, data)` - emits event to given node.

Load balancing methods

12. `requestAny(endpoint, data, timeout, filter)` - send request to "only one" node from the nodes that satisfy given filter.

13. `tickAny(event, data, filter)` - ticks to "only one" node from the nodes that satisfy given filter.

14. `tickAll(event, data, filter)` - ticks to all nodes that satisfies to given filer.

Debugging and troubleshooting

15. `enableMetrics(interval)` - enables metrics, events will be triggered by given interval. Default interval is 1000 ms.

16. `disableMetrics()` - disables metrics.

17. `setLogLevel(level)` - sets log level to given level { error: 0, warn: 1, info: 2, verbose: 3, debug: 4, silly: 5 }.

18. `addFileToLog(filename, level)` - writes all logs above given level to given file.


### Simple client server example
NodeServer is listening for events, NodeClient connects to NodeServer and sends events: 
(myServiceClient) ----> (myServiceServer)

Lets create server first

myServiceServer.js
```javascript
import Node from 'zeronode';

(async function() {
   let myServiceServer = new Node({ id: 'myServiceServer',  bind: 'tcp://127.0.0.1:6000', options: { layer: 'LayerA' } });
   
   // ** attach event listener to myServiceServer
   myServiceServer.onTick('welcome', (data) => {
       console.log('onTick - welcome', data);
   });
   
   // ** attach request listener to myServiceServer
   myServiceServer.onRequest('welcome', ({ body, reply }) => {
       console.log('onRequest - welcome', body);
       reply("Hello client");
   });
   
   // ** bind node to given address
   await myServiceServer.bind();
}());

```
Now lets create a client

myServiceClient.js
```javascript
import Node from 'zeronode'

(async function() {
   let myServiceClient = new Node({ options: { layer: 'LayerA' } });
   
   //** connect one node to another node with address
   await myServiceClient.connect('tcp://127.0.0.1:6000');
   
   let serverNodeId = 'myServiceServer';
   
   // ** tick() is like firing an event to another node
   myServiceClient.tick(serverNodeId, 'welcome', 'Hi server!!!');
   
   // ** you request to another node and getting a promise
   // ** which will be resolve after reply.
   let responseFromServer = await myServiceClient.request(serverNodeId, 'welcome', 'Hi server, I am client !!!');
   
   console.log(`response from server is "${responseFromServer}"`);
   // response from server is "Hello client."
}());

```

### More of layering and grouping of Nodes. 
- Nodes can be grouped in layers (and other options) and then send messages to only filtered nodes by layers or other options.
- The filtering is done on senders side which keeps all the information about the nodes (both connected to sender node and the ones that
sender Node is conencted to)

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
    
    // ** connect to server address
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
//this will tick only one node of the layer A nodes;
server.tickAny('foobar', { foo: 'bar' }, { layer: 'A' });

//this will tick to all layer A nodes;
server.tickAll('foobar', { foo: 'bar' }, { layer: 'A' });

//this will tick to all nodes that server connected to, or connected to server.
server.tickAll('foobar', { foo: 'bar' });


//you even can use regexp to filer nodes
server.tickAll('foobar', { foo: 'bar' }, {layer: /[A-Z]/})
```

### You still have some questions ? Try to reach us
Try to reach us via Drift Chat under [Steadfast.tech]: http://steadfast.tech 

### What We Are Using

Under the hood we are using [zeromq](http://zeromq.org)-s Dealer and Router sockets.
