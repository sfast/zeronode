![Zeronode](https://i.imgur.com/NZVXZPo.png)
<br/>

[![JavaScript Style Guide](https://cdn.rawgit.com/standard/standard/master/badge.svg)](https://github.com/standard/standard)<br/><br/>
[![NPM](https://nodei.co/npm/zeronode.png)](https://nodei.co/npm/zeronode/)<br/><br/>

[<img src="https://img.shields.io/gitter/room/nwjs/nw.js.svg">](https://gitter.im/npm-zeronode/Lobby) 
[![Known Vulnerabilities](https://snyk.io/test/npm/zeronode/badge.svg)](https://snyk.io/test/npm/zeronode)


## Zeronode - minimal building block for NodeJS microservices
* [Why Zeronode?](#whyZeronode)
* [Basics](#basics)
* [Installation](#installation)
* [Benchmark](#benchmark)
* [API](#api)
* [Examples](#examples)
    * [Basic Examples](#basicExamples)
    * [Advanced Examples](#advancedExamples)
* [Contributing](#contributing)
* [License](#license)

<a name="whyZeronode"></a>
### Why you need ZeroNode ? 
Application backends are becoming complex these days and there are lots of moving parts talking to each other through network.
There is a great difference between sending a few bytes from A to B, and doing messaging in reliable way.
- How to handle dynamic components ? (i.e., pieces that come and/or go away temporarily, scaling a microservice instances )
- How to handle messages that we can't deliver immediately ? (e.g waiting for a component to come back online)
- How to route messages in complex microservice architecture ? (i.e. one to one, one to many, custom grouping)
- How we handle network errors ? (i.e., reconnecting of various pieces)

We created Zeronode on top of <a href="http://zeromq.org" target="_blank">zeromq</a> as to address <a href="http://zguide.zeromq.org/page:all#Why-We-Needed-ZeroMQ" target="_blank">these</a>
and some more common problems that developers will face once building solid systems.
<br/>
With zeronode its just super simple to create complex server-to-server communications (i.e. build network topologies).

<a name="basics"></a>
### Basics 
Zeronode allows to create complex network topologies (i.e. line, ring, partial or full mesh, star, three, hybrid ...) 
But lets start from the basics.
You want to send a message from __A__  to __B__ (:computer: --> :computer:) and that means you'll need to create 2 __nodes__.
Think of every __node__ as an actor (i.e. _participant, minimal building block_) in your networking system.

- __node__ can connect to multiple nodes (i.e  _node.connect(addressOfNodeB)_, _node.connect(addressOfnodeC)_)
- __node__-s can connect to particular __node__ if the latest is binded to some interface (i.e  _node.bind(interfaceAddress)_)
- if node __A__ is connected to node __B__ then we have a channel between them and both nodes can talk to each other
- __node__-s are __resilent__ to _restarts_, _network failures_, _connect/bind order_
- __node__-s can run on same or different machines, processes, containers etc ...
- data transfers between __node__-s via both _request/reply_ and _tick_ (fire forget) patterns

Much more interesting patterns and features you can discover by reading the document or try to reach us via Drift Chat under 
<a href="http://steadfast.tech" target="_blank">Steadfast.tech</a>

<a name="installation"></a>
### Installation & Important notes 
Zeronode depends on <a href="http://zeromq.org" target="_blank">zeromq</a>
<br/> For Debian, Ubuntu, MacOS you can just run
```bash
$ npm install zeronode --save
```
and it'll also install [zeromq](http://zeromq.org) for you. 
<br/>Kudos to <a href="https://github.com/davidharutyunyan" target="_blank">Dave</a> for adding install scripts.
For other platforms please open an issue or feel free to contribute.

<a name="benchmark"></a>
### Benchmark
All Benchmark tests are completed on Azure D4v2 vm (Intel Xeon® E5-2673 v3).

<table><tbody>
<tr><td>Request Count</td><td>Data Size</td><td>Average Time</td></tr>
<tr><td>1000</td><td>10 byte</td><td>212ms</td></tr>
<tr><td>1000</td><td>1 kbyte</td><td>304ms</td></tr>
<tr><td>50000</td><td>10 byte</td><td>7398ms</td></tr>
<tr><td>50000</td><td>1 kbyte</td><td>12524ms</td></tr>
</tbody></table>
<br/>
<table><tbody>
<tr><td>Tick Count</td><td>Data Size</td><td>Average Time</td></tr>
<tr><td>1000</td><td>10 byte</td><td>108ms</td></tr>
<tr><td>1000</td><td>1 kbyte</td><td>184ms</td></tr>
<tr><td>50000</td><td>10 byte</td><td>3852ms</td></tr>
<tr><td>50000</td><td>1 kbyte</td><td>6531ms</td></tr>
</tbody></table>


<a name="api"></a>
### API
#### Basic methods
* [<code>**Node()**</code>](#node)
* [<code>node.**bind()**</code>](#bind)
* [<code>node.**connect()**</code>](#connect)
* [<code>node.**unbind()**</code>](#unbind)
* [<code>node.**disconnect()**</code>](#disconnect)
* [<code>node.**stop()**</code>](#stop)

#### Simple messaging methods
* [<code>node.**request()</code>**](#request)
* [<code>node.**tick()</code>**](#tick)

#### Attaching/Detaching handlers to tick and request 

* [<code>node.**onRequest()**</code>](#onRequest)
* [<code>node.**onTick()**</code>](#onTick)
* [<code>node.**offRequest()**</code>](#offRequest)
* [<code>node.**offTick()**</code>](#offTick)

#### Load balancing methods

* [<code>node.**requestAny()**</code>](#requestAny)
* [<code>node.**requestDownAny()**</code>](#requestDownAny)
* [<code>node.**requestUpAny()**</code>](#requestUpAny)
* [<code>node.**tickAny()**</code>](#tickAny)
* [<code>node.**tickDownAny()**</code>](#tickDownAny)
* [<code>node.**tickUpAny()**</code>](#tickUpAny)
* [<code>node.**tickAll()**</code>](#tickAll)
* [<code>node.**tickDownAll()**</code>](#tickDownAll)
* [<code>node.**tickUpAll()**</code>](#tickUpAll)

#### Debugging and troubleshooting

* [<code>**node.enableMetrics()**</code>](#enableMetrics)
* [<code>**node.disableMetrics()**</code>](#disableMetrics)

<a name="node"></a>
#### new Node({ id: String, bind: Url, options: Object, config: Object })
Node class wraps many client instances and one server instance.
Node automatically handles:
* Client/Server ping/pong
* Reconnections

```javascript
import { Node } from 'zeronode';

let node = new Node({
    id: 'node',
    bind: 'tcp://127.0.0.1:6000',
    options: {}
    config: {}
});
```

All four arguments are optional.
* `id` is unique string which identifies Node.
* `options` is information about Node, witch this information Nodes can be filtered.
* `config` is object for configuring Node.
    * `logger` logger instance, default is Winston.
    * `REQUEST_TIMEOUT` duration after request Promise rejected.
    * `RECONNECT_TIMEOUT` duration of reconnecting failed server.
    * `CONNECT_TIMEOUT` duration for trying connect to server.

There are some events that triggered on Node instance:
* `NodeEvents.`**`CLIENT_FAILURE`** - triggered when connected client to this node fails.
* `NodeEvents.`**`CLIENT_CONNECTED`** - triggered when new client connects to this node.
* `NodeEvents.`**`CLIENT_STOP`** - triggered when client successfully disconnects from this node.
* `NodeEvents.`**`SERVER_FAILURE`** - triggered when server fails whom this node connected.
* `NodeEvents.`**`SERVER_STOP`** - triggered when server stops whom this node connected.
* `NodeEvents.`**`SERVER_RECONNECT`** - triggered when server comes back and node successfuly reconnects.
* `NodeEvents.`**`SERVER_RECONNECT_FAILURE`** - triggered when server doesn't come back in recnnectTimeout time.
* `NodeEvents.`**`CONNECT_TO_SERVER`** - triggered when Node successfully connects to new server.
* `NodeEvents.`**`METRICS`** - triggered when [metrics enabled](#enableMetrics).


<a name="bind"></a>
#### node.bind(address: Url)
Binds the node/actor to the specified interface and port and returns Promise. 
You can bind only in one address.
Address can be on following protocols: tcp, inproc(in-process/inter-thread), ipc(inter-process).

<a name="connect"></a>
#### node.connect({ address: Url, timeout: Number, reconnectionTimeout: Number })
Connects the node/actor to other node/actor with specified address and returns Promise. 
Node can connect to many other nodes.
If timeout is provided (in milliseconds) then the _connect promise_ will be rejected if connection is taking longer.<br/>
If timeout is not provided we'll wait for ages till it connects.
if Server fails then Node will try to reconnect in given reconnectionTimeout.

<a name="unbind"></a>
#### node.unbind()
Unbinds the node and returns Promise.
Unbinding doesn't stop node, it can still be connected to other nodes.

<a name="disconnect"></a>
#### node.disconnect(address: Url)
Disconnects Node from specified address and returns Promise.

<a name="stop"></a>
#### node.stop()
Unbinds Node, disconnects from all connected addresses and returns Promise.

<a name="request"></a>
#### node.request({ to: Id, event: String, data: Object, timeout: Number })
Makes request to Node with id(__to__) and returns Promise. <br/>
Promise resolves with data that requested Node replies. <br/>
If timeout is not provided it'll be config.REQUEST_TIMEOUT or default value: 10000 ms. <br/>
If there isn't node with given id, than Promise rejected with error code ErrorCodes.NODE_NOT_FOUND.

<a name="tick"></a>
#### node.tick({ to: Id, event: String, data: Object })
Ticks(emits) event to given node(__to__).</br>
If there isn't node with given id, than throws error with code ErrorCodes.NODE_NOT_FOUND.

<a name="onRequest"></a>
#### node.onRequest(requestEvent: String/Regex, handler: Function)
Adds request handler for given event.
```javascript
/**
* @param head: { id: String, event: String }
* @param body: {} - requestedData
* @param reply(replyData): Function
* @param next(error): Function 
*/
node.onRequest('foo', ({ head, body, reply, next}) => {
  // handle request
  next() // call next handler
})

node.onRequest(/^fo/, ({ head, body, reply, next}) => {
  // handle request
  reply(/*some data*/) // send back reply
})
```

<a name="onTick"></a>
#### node.onTick(event: String/Regex, handler: Function)
Adds tick(event) handler for given event.
```javascript
node.onTick('foo', (data) => {
// handle event
})
```

<a name="offRequest"></a>
#### node.offRequest(requestEvent: String/Regex, handler: Function)
Removes request handler for given event.<br/>
If handler is not provided then removes all the listeners.

<a name="offTick"></a>
#### node.offTick(event: String/Regex, handler: Function)
Removes given tick(event) handler from event listeners list. <br/>
If handler is not provided then removes all the listeners.

<a name="requestAny"></a>
#### node.requestAny({ event: String, data: Object, timeout: Number, filter: Object/Function, down: Bool, up: Bool })
General method to send request to __only one__ node satisfying the filter.<br/>
Filter can be an object or a predicate function.
```javascript
    //send request to one of nodes that have version 1.*.*
    node.requestAny({
        event: 'foo',
        data: { foo: 'bar' }),
        filter: { version: /^1.(\d+\.)?(\d+)$/ }
    })

    //send request to one of nodes that have even length name.
    node.requestAny({
        event: 'foo',
        data: { foo: 'bar' }),
        filter: (options) => !(options.name.length % 2)
    })

    //send request to one of node that connected to you
    node.requestAny({
        event: 'foo',
        data: { foo: 'bar' }),
        up: false
    })

    //send request to one of nodes that you are connected.
    node.requestAny({
        event: 'foo',
        data: { foo: 'bar' }),
        down: false
    })

```

<a name="requestDownAny"></a>
#### node.requestDownAny({ event: String, data: Object, timeout: Number, filter: Object/Function })
Send request to one of downstream nodes (nodes which has been connected to your node via _connect()_ ).


<a name="requestUpAny"></a>
#### node.requestUpAny({ event: String, data: Object, timeout: Number, filter: Object/Function })
Send request to one of upstream nodes (nodes to which ones your node has been connected via _connect()_ ).

<a name="tickAny"></a>
#### node.tickAny({ event: String, data: Object, filter: Object/Function, down: Bool, up: Bool })
General method to send tick-s to __only one__ node satisfying the filter.<br/>
Filter can be an object or a predicate function.
Usage is same as [`node.requestAny`](#requestAny)

<a name="tickDownAny"></a>
#### node.tickDownAny({ event: String, data: Object, filter: Object/Function })
Send tick-s to one of downstream nodes (nodes which has been connected to your node via _connect()_ ).

<a name="tickUpAny"></a>
#### node.tickUpAny({ event: String, data: Object, filter: Object/Function })
Send tick-s to one of upstream nodes (nodes which has been connected to your node via _connect())_ ).

<a name="tickAll"></a>
#### node.tickAll({ event: String, data: Object, filter: Object/Function, down: Bool, up: Bool })
Tick to **ALL** nodes satisfying the filter, up ( _upstream_ ) and down ( _downstream_ ).

<a name="tickDownAll"></a>
#### node.tickDownAll({ event: String, data: Object, filter: Object/Function })
Tick to **ALL** downstream nodes.

<a name="tickUpAll"></a>
#### node.tickUpAll({ event: String, data: Object, filter: Object/Function })
Tick to **ALL** upstream nodes.

<a name="enableMetrics"></a>
#### node.enableMetrics(interval)
Enables metrics, events will be triggered by given interval. Default interval is 1000 ms. <br/>

<a name="disableMetrics"></a>
#### node.disableMetrics()
Stops triggering events, and removes all collected data.

<a name="examples"></a>
### Examples
<a name="basicExamples"></a>
#### Simple client server example
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
   await myServiceClient.connect({ address: 'tcp://127.0.0.1:6000' });
   
   let serverNodeId = 'myServiceServer';
   
   // ** tick() is like firing an event to another node
   myServiceClient.tick({ to: serverNodeId, event: 'welcome', data:'Hi server!!!' });
   
   // ** you request to another node and getting a promise
   // ** which will be resolve after reply.
   let responseFromServer = await myServiceClient.request({ to: serverNodeId, event: 'welcome', data: 'Hi server, I am client !!!' });
   
   console.log(`response from server is "${responseFromServer}"`);
   // response from server is "Hello client."
}());

```

<a name="advancedExamples"></a>
#### More of layering and grouping of Nodes.
- __node__-s can be grouped in layers (and other options) and then send messages to only filtered nodes by layers or other options.
- the filtering is done on senders side which keeps all the information about the nodes (both connected to sender node and the ones that
sender node is connected to)

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
    
    // ** connect to server address and set connection timeout to 20 seconds
    await clientA1.connect({ address: 'tcp:://127.0.0.1:6000', 20000 });
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
    // ** connect to server address and set connection timeout infinite
    await clientA2.connect({ address: 'tcp:://127.0.0.1:6000') };
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
    
    // ** connect to server address and set connection timeout infinite
    await clientB1.connect({ address: 'tcp:://127.0.0.1:6000' });
}());
```

Now that all connections are set, we can send events.
```javascript
//this will tick only one node of the layer A nodes;
server.tickAny({ event: 'foobar', data: { foo: 'bar' }, filter: { layer: 'A' } });

//this will tick to all layer A nodes;
server.tickAll({ event: 'foobar', data: { foo: 'bar' }, filter: { layer: 'A' } });

//this will tick to all nodes that server connected to, or connected to server.
server.tickAll({ event: 'foobar', data: { foo: 'bar' } });


// you even can use regexp to filer nodes
// also you can pass a predicate function as a filter which will get node options as an argument
server.tickAll({ event: 'foobar', data: { foo: 'bar' }, filter: {layer: /[A-Z]/} })
```

### You still have questions ?
Try to reach us via Drift Chat under <a href="http://steadfast.tech" target="_blank">Steadfast.tech</a> <br/>
or ask a question under zeronode gitter <br/> [<img src="https://img.shields.io/gitter/room/nwjs/nw.js.svg">](https://gitter.im/npm-zeronode/Lobby) <br/>

<a name="contributing"></a>
### Contributing
Contributions are always welcome! Please read the [contribution guidelines](https://github.com/sfast/zeronode/blob/master/CONTRIBUTING.md) first.

### Contributors
* [Artak Vardanyan](https://github.com/artakvg)
* [David Harutyunyan](https://github.com/davidharutyunyan)

### What We Are Using
Under the hood we are using <a href="http://zeromq.org" target="_blank">zeromq</a>-s Dealer and Router sockets.

<a name="license"></a>
### License
[MIT](https://github.com/sfast/zeronode/blob/master/LICENSE)