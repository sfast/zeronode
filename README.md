[<img src="https://img.shields.io/gitter/room/nwjs/nw.js.svg">](https://gitter.im/npm-zeronode/Lobby) <br/>
## Zeronode - minimal building block for NodeJS microservices 
![Zeronode](https://i.imgur.com/NZVXZPo.png)

### Why you need ZeroNode ? 
Application backends are becaming complex these days and there are lots of moving parts talking to each other through network.
There is a great difference between sending a few bytes from A to B, and doing messaging in reliable way. :heavy_exclamation_mark::heavy_exclamation_mark::heavy_exclamation_mark:
- How to handle dynamic components :question: (i.e., pieces that come and/or go away temporarily, scaling a microservice instances )
- How to handle messages that we can't deliver immediately :question: (e.g waiting for a component to come back online)
- How to route messages in complex microservice architechture :question: (i.e. one to one, one to many, custom grouping messaging)
- How we handle network errors :question: (i.e., reconnecting of various pieces)

We created Zeronode on top of <a href="http://zeromq.org" target="_blank">zeromq</a> as to address <a href="http://zguide.zeromq.org/page:all#Why-We-Needed-ZeroMQ" target="_blank">these</a>
and some more common problems that developers will face once building solid systems.
<br/>
With zeronode its just super simple to create complex server-to-server communications (i.e. build network topologies).

### Basics 
Zeronode allows to create complex network topologies (i.e. line, ring, partial or full mesh, star, three, hybrid ...) 
But lets start from the basics.
You want to send a message from __A__  to __B__ (:computer: --> :computer:) and that means you'll need to create 2 __nodes__.
Think of every __node__ as an actor (i.e. _participant, minimal building block_) in your networking system.

- :point_right: __node__ can connect to multiple nodes (i.e  _node.connect(addressOfNodeB)_, _node.connect(addressOfnodeC)_)
- :point_right: nodes can connect to particular __node__ if the latest is binded to some interface (i.e  _node.bind(interfaceAddress)_)
- :point_right: if node __A__ is connected to node __B__ then we have a channel between them and both nodes can talk to each other
- :point_right: __node__-s are __resilent__ to _restarts_, _network failures_, _connect/bind order_ :muscle::metal::thumbsup:
- :point_right: __node__-s can run on same or different machines, processes, containers etc ...
- :point_right: data transfers between __node__-s via both _request/reply_ and _tick_ (fire forget) patterns

:mortar_board::mortar_board::mortar_board: <br/>
Much more interesting patterns and features you can discover by reading the document or try to reach us via Drift Chat under 
<a href="http://steadfast.tech" target="_blank">Steadfast.tech</a>

### Installation & Important notes 
Zeronode depends on <a href="http://zeromq.org" target="_blank">zeromq</a>
<br/>:loudspeaker::loudspeaker: For Debian, Ubuntu, MacOS, Fedora, Redhat, Centos you can just run
```bash
$ npm install zeronode
```
and it'll also install [zeromq](http://zeromq.org) for you. 
<br/>Kudos :raised_hands: to <a href="https://github.com/davidharutyunyan" target="_blank">Dave</a> for adding install scripts.
For other platforms please open an issue or feel free to contrubute.

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

#### Basic methods
1. `bind(address)` - Binds the node/actor to the specified interface and port. You can bind only in one address.
2. `connect(address)` - Connects the node/actor to other nodes/actors the specified address. You can connect to many nodes.
3. `unbind()` - Unbinds the node.
4. `disconnect(address)` - Disconnects the node from specified address.
5. `stop()` - Unbinds the node, and disconnects from all addresses.

#### Simple messaging methods

6. `onRequest(endpoint: String, handler)` - adds request handler to given endpoint.
7. `onTick(event: String, handler)` - adds event handler to given event.
8. `offRequest(endpoint:String, handler)` - removes request handler from endpoint.<br/>
_If handler is not provided then removes all the listeners._

9. `offTick(event: String, handler)` - removes given event handler from event listeners list. <br/>
_If handler is not provided then removes all the listeners._
10. `request(id, endpoint, data, timeout)` - makes request to that endpoint of given node.
11. `tick(id, event, data)` - emits event to given node.

#### Load balancing methods

12. `requestAny(endpoint, data, timeout, filter)` - send request to "only one" node from the nodes that satisfy given filter.

13. `tickAny(event, data, filter)` - ticks to "only one" node from the nodes that satisfy given filter.

14. `tickAll(event, data, filter)` - ticks to all nodes that satisfies to given filer.

#### Debugging and troubleshooting

15. `enableMetrics(interval)` - enables metrics, events will be triggered by given interval. Default interval is 1000 ms.

16. `disableMetrics()` - disables metrics.

17. `setLogLevel(level)` - sets log level to given level { error: 0, warn: 1, info: 2, verbose: 3, debug: 4, silly: 5 }.

18. `addFileToLog(filename, level)` - writes all logs above given level to given file.

### Default events
__Important__
- default event names not recommended to use for custom events
- all event names must not exceed **20** symbols.

1. CLIENT_CONNECTED
    1. event name - "1"
    2. description - fired when client connected.
2. CLIENT_FAILURE
    1. event name - "2"
    2. description - fired when client fails.
3. CLIENT_STOP
    1. event name - "3"
    2. description - fired when client stops.
4. CLIENT_PING
    1. event name - "4"
    2. description - fired when client pings.
5. OPTIONS_SYNC
    1. event name = "5"
    2. description - fired client/server options updated.
6. SERVER_FAILURE
    1. event name - "6"
    2. description - fired when server fails.
7. SERVER_STOP
    1. event name = "7"
    2. description - fired when server stops.
8. METRICS
    1. event name - "8"
    2. description - new metric information. Fired when metric tracking is enabled.


### Simple client server example
NodeServer is listening for events, NodeClient connects to NodeServer and sends events: <br/>
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
- __node__-s can be grouped in layers (and other options) and then send messages to only filtered nodes by layers or other options.
- the filtering is done on senders side which keeps all the information about the nodes (both connected to sender node and the ones that
sender node is conencted to)

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

### You still have questions ?
Try to reach us via Drift Chat under <a href="http://steadfast.tech" target="_blank">Steadfast.tech</a> <br/>
or ask a question under zeronode gitter <br/> [<img src="https://img.shields.io/gitter/room/nwjs/nw.js.svg">](https://gitter.im/npm-zeronode/Lobby) <br/>

### What We Are Using
Under the hood we are using <a href="http://zeromq.org" target="_blank">zeromq</a>-s Dealer and Router sockets.
