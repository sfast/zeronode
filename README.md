![Zeronode](https://i.imgur.com/NZVXZPo.png)
<br/>

[![JavaScript Style Guide](https://cdn.rawgit.com/standard/standard/master/badge.svg)](https://github.com/standard/standard)<br/><br/>
[![NPM](https://nodei.co/npm/zeronode.png)](https://nodei.co/npm/zeronode/)<br/><br/>

[<img src="https://img.shields.io/gitter/room/nwjs/nw.js.svg">](https://gitter.im/npm-zeronode/Lobby) 
[![Known Vulnerabilities](https://snyk.io/test/npm/zeronode/badge.svg)](https://snyk.io/test/npm/zeronode)


## Zeronode - minimal building block for NodeJS microservices
* [Why Zeronode?](#whyZeronode)
* [Installation](#installation)
* [Basics](#basics)
* [Benchmark](#benchmark)
* [API](#api)
* [Examples](#examples)
    * [Basic Examples](#basicExamples)
    * [Advanced Examples](#advancedExamples)
* [Contributing](#contributing)
* [Have a question ?](#askzeronode)
* [License](#license)

<a name="whyZeronode"></a>
### Why you need ZeroNode ? 
Application backends are becoming complex these days and there are lots of moving parts talking to each other through network.
There is a great difference between sending a few bytes from A to B, and doing messaging in reliable way.
- How to handle dynamic components ? (i.e., pieces that come and/or go away temporarily, scaling a microservice instances )
- How to handle messages that we can't deliver immediately ? (i.e waiting for a component to come back online)
- How to route messages in complex microservice architecture ? (i.e. one to one, one to many, custom grouping)
- How we handle network errors ? (i.e., reconnecting of various pieces)

We created Zeronode on top of <a href="http://zeromq.org" target="_blank">zeromq</a> as to address <a href="http://zguide.zeromq.org/page:all#Why-We-Needed-ZeroMQ" target="_blank">these</a>
and some more common problems that developers will face once building solid systems.
<br/>
With zeronode its just super simple to create complex server-to-server communications (i.e. build network topologies).

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

<a name="basics"></a>
### Basics 
Zeronode allows to create complex network topologies (i.e. line, ring, partial or full mesh, star, three, hybrid ...) 
Each participant/actor in your network topology we call __znode__, which can act as a sever, as a client or hybrid.

```javascript
import Node from 'zeronode';

let znode = new Node({
    id: 'steadfast',
    options: {}, 
    config: {}
});

// ** If znode is binded to some interface then other znodes can connect to it
// ** In this case znode acts as a server, but it's not limiting znode to connect also to other znodes (hybrid)
(async () => {
    await znode.bind('tcp://127.0.0.1:6000');
})();

// ** znode can connect to multiple znodes
znode.connect({address: 'tcp://127.0.0.1:6001'})
znode.connect({address: 'tcp://127.0.0.1:6002'})

// ** If 2 znodes are connected together then we have a channel between them 
// ** and both znodes can talk to each other via various messeging patterns - i.e. request/reply, tick (fire and forgot) etc ...

```

Much more interesting patterns and features you can discover by reading the [API](#api) document.
In case you have a question or suggestion you can talk to authors on [Zeronode Gitter chat](#askzeronode)



<a name="benchmark"></a>
### Benchmark
All Benchmark tests are completed on Intel(R) Core(TM) i5-6200U CPU @ 2.30GHz.

<table><tbody>
<tr><td></td><td>Zeronode</td><td>Seneca (tcp)</td><td>Pigato</td></tr>
<tr><td>1000 msg, 1kb data</td><td>394ms</td><td>2054ms</td><td>342ms</td></tr>
<tr><td>50000 msg, 1kb data</td><td>11821ms<td>140934ms</td><td>FAIL(100s timeout)</td></tr>
</tbody></table>
<br/>


<a name="api"></a>
### API
#### Basic methods
* [<code>**new Node()**</code>](#node)
* [<code>znode.**bind()**</code>](#bind)
* [<code>znode.**connect()**</code>](#connect)
* [<code>znode.**unbind()**</code>](#unbind)
* [<code>znode.**disconnect()**</code>](#disconnect)
* [<code>znode.**stop()**</code>](#stop)

#### Simple messaging methods
* [<code>znode.**request()</code>**](#request)
* [<code>znode.**tick()</code>**](#tick)

#### Attaching/Detaching handlers to tick and request 

* [<code>znode.**onRequest()**</code>](#onRequest)
* [<code>znode.**onTick()**</code>](#onTick)
* [<code>znode.**offRequest()**</code>](#offRequest)
* [<code>znode.**offTick()**</code>](#offTick)

#### Load balancing methods

* [<code>znode.**requestAny()**</code>](#requestAny)
* [<code>znode.**requestDownAny()**</code>](#requestDownAny)
* [<code>znode.**requestUpAny()**</code>](#requestUpAny)
* [<code>znode.**tickAny()**</code>](#tickAny)
* [<code>znode.**tickDownAny()**</code>](#tickDownAny)
* [<code>znode.**tickUpAny()**</code>](#tickUpAny)
* [<code>znode.**tickAll()**</code>](#tickAll)
* [<code>znode.**tickDownAll()**</code>](#tickDownAll)
* [<code>znode.**tickUpAll()**</code>](#tickUpAll)

#### Debugging and troubleshooting

* [<code>**znode.enableMetrics()**</code>](#enableMetrics)
* [<code>**znode.disableMetrics()**</code>](#disableMetrics)

<a name="node"></a>
#### let znode = new Node({ id: String, bind: Url, options: Object, config: Object })
Node class wraps many client instances and one server instance.
Node automatically handles:
* Client/Server ping/pong
* Reconnections

```javascript
import { Node } from 'zeronode';

let znode = new Node({
    id: 'node',
    bind: 'tcp://127.0.0.1:6000',
    options: {}
    config: {}
});
```

All four arguments are optional.
* `id` is unique string which identifies znode.
* `options` is information about znode which is shared with other connected znoded. It could be used for advanced use cases of load balancing and messege routing.
* `config` is an object for configuring znode
    * `logger` - logger instance, default is Winston.
    * `REQUEST_TIMEOUT` - duration after which request()-s promise will be rejected, default is 10,000 ms.
    * `RECONNECTION_TIMEOUT` (for client znodes) - zeronode's default is -1 , which means zeronode is always trying to reconnect to failed znode server. Once `RECONNECTION_TIMEOUT` is passed and recconenction doesn't happen zeronode will fire `SERVER_RECONNECT_FAILURE`. 
    * `CONNECTION_TIMEOUT` (for client znodes) - duration for trying to connect to server after which connect()-s promise will be rejected.

There are some events that triggered on znode instances:
* `NodeEvents.`**`CLIENT_FAILURE`** - triggered on server znode when client connected to it fails.
* `NodeEvents.`**`CLIENT_CONNECTED`** - triggered on server znode when new client connects to it.
* `NodeEvents.`**`CLIENT_STOP`** - triggered on server znode when client successfully disconnects from it.

* `NodeEvents.`**`SERVER_FAILURE`** - triggered on client znode when server znode fails.
* `NodeEvents.`**`SERVER_STOP`** - triggered on client znode when server successfully stops.
* `NodeEvents.`**`SERVER_RECONNECT`** - triggered on client znode when server comes back and client znode successfuly reconnects.
* `NodeEvents.`**`SERVER_RECONNECT_FAILURE`** - triggered on client znode when server doesn't come back in `reconnectionTimeout` time provided during connect(). If `reconnectionTimeout` is not provided it uses `config.RECONNECTION_TIMEOUT` which defaults to -1 (means client znode will try to reconnect to server znode for ages).
* `NodeEvents.`**`CONNECT_TO_SERVER`** - triggered on client znode when it successfully connects to new server.
* `NodeEvents.`**`METRICS`** - triggered when [metrics enabled](#enableMetrics).


<a name="bind"></a>
#### znode.bind(address: Url)
Binds the znode to the specified interface and port and returns promise. 
You can bind only to one address.
Address can be of the following protocols: `tcp`, `inproc`(in-process/inter-thread), `ipc`(inter-process).

<a name="connect"></a>
#### znode.connect({ address: Url, timeout: Number, reconnectionTimeout: Number })
Connects the znode to server znode with specified address and returns promise. 
znode can connect to multiple znodes.
If timeout is provided (in milliseconds) then the _connect()-s_ promise will be rejected if connection is taking longer.<br/>
If timeout is not provided it will wait for ages till it connects.
If server znode fails then client znode will try to reconnect in given `reconnectionTimeout` (defaults to `RECONNECTION_TIMEOUT`) after which the `SERVER_RECONNECT_FAILURE` event will be triggered.

<a name="unbind"></a>
#### znode.unbind()
Unbinds the server znode and returns promise.
Unbinding doesn't stop znode, it can still be connected to other nodes if there are any, it just stops the server behaviour of znode, and on all the client znodes (connected to this server znode) `SERVER_STOP` event will be triggered.

<a name="disconnect"></a>
#### znode.disconnect(address: Url)
Disconnects znode from specified address and returns promise.

<a name="stop"></a>
#### znode.stop()
Unbinds znode, disconnects from all connected addresses (znodes) and returns promise.

<a name="request"></a>
#### znode.request({ to: Id, event: String, data: Object, timeout: Number })
Makes request to znode with id(__to__) and returns promise. <br/>
Promise resolves with data that the requested znode replies. <br/>
If timeout is not provided it'll be `config.REQUEST_TIMEOUT` (defaults to 10000 ms). <br/>
If there is no znode with given id, than promise will be rejected with error code `ErrorCodes.NODE_NOT_FOUND`.

<a name="tick"></a>
#### znode.tick({ to: Id, event: String, data: Object })
Ticks(emits) event to given znode(__to__).</br>
If there is no znode with given id, than throws error with code `ErrorCodes.NODE_NOT_FOUND`.

<a name="onRequest"></a>
#### znode.onRequest(requestEvent: String/Regex, handler: Function)
Adds request handler for given event on znode.
```javascript
/**
* @param head: { id: String, event: String }
* @param body: {} - requestedData
* @param reply(replyData: Object): Function
* @param next(error): Function 
*/
// ** listening for 'foo' event
znode.onRequest('foo', ({ head, body, reply, next }) => {
  // ** request handling logic 
  // ** move forward to next handler or stop the handlers chain with 'next(err)'
  next() 
})

// ** listening for any events matching Regexp
znode.onRequest(/^fo/, ({ head, body, reply, next }) => {
  // ** request handling logic 
  // ** send back reply to the requester znode
  reply(/* Object data */) 
})
```

<a name="onTick"></a>
#### znode.onTick(event: String/Regex, handler: Function)
Adds tick(event) handler for given event.
```javascript
znode.onTick('foo', (data) => {
   // ** tick handling logic 
})
```

<a name="offRequest"></a>
#### znode.offRequest(requestEvent: String/Regex, handler: Function)
Removes request handler for given event.<br/>
If handler is not provided then removes all of the listeners.

<a name="offTick"></a>
#### znode.offTick(event: String/Regex, handler: Function)
Removes given tick(event) handler from event listeners' list. <br/>
If handler is not provided then removes all of the listeners.

<a name="requestAny"></a>
#### znode.requestAny({ event: String, data: Object, timeout: Number, filter: Object/Function, down: Bool, up: Bool })
General method to send request to __only one__ znode satisfying the filter.<br/>
Filter can be an object or a predicate function. Each filter key can be object itself, with this keys.
- **$eq** - strict equal to provided value.
- **$ne** - not equal to provided value.
- **$aeq** - loose equal to provided value.
- **$gt** - greater than provided value.
- **$gte** - greater than or equal to provided value.
- **$lt** - less than provided value.
- **$lte** - less than or equal to provided value.
- **$between** - between provided values (value must be tuple. eg [10, 20]).
- **$regex** - match to provided regex.
- **$in** - matching any of the provided values.
- **$nin** - not matching any of the provided values.
- **$contains** - contains provided value.
- **$containsAny** - contains any of the provided values.
- **$containsNone** - contains none of the provided values.

```javascript
    // ** send request to one of znodes that have version 1.*.*
    znode.requestAny({
        event: 'foo',
        data: { foo: 'bar' },
        filter: { version: /^1.(\d+\.)?(\d+)$/ }
    })
    
    // ** send request to one of znodes whose version is greater than 1.0.0
    znode.requestAny({
        event: 'foo',
        data: { foo: 'bar' },
        filter: { version: { $gt: '1.0.0' } }
    })
    
    // ** send request to one of znodes whose version is between 1.0.0 and 2.0.0
    znode.requestAny({
        event: 'foo',
        data: { foo: 'bar' },
        filter: { version: { $between: ['1.0.0', '2.0.0.'] } }
    })

    // ** send request to one of znodes that have even length of name.
    znode.requestAny({
        event: 'foo',
        data: { foo: 'bar' },
        filter: (options) => !(options.name.length % 2)
    })

    // ** send request to one of znodes that connected to your znode (downstream client znodes)
    znode.requestAny({
        event: 'foo',
        data: { foo: 'bar' },
        up: false
    })

    // ** send request to one of znodes that your znode is connected to (upstream znodes).
    znode.requestAny({
        event: 'foo',
        data: { foo: 'bar' },
        down: false
    })
```

<a name="requestDownAny"></a>
#### znode.requestDownAny({ event: String, data: Object, timeout: Number, filter: Object/Function })
Send request to one of downstream znodes (znodes which has been connected to your znode via _connect()_ ).


<a name="requestUpAny"></a>
#### znode.requestUpAny({ event: String, data: Object, timeout: Number, filter: Object/Function })
Send request to one of upstream znodes (znodes to which your znode has been connected via _connect()_ ).

<a name="tickAny"></a>
#### znode.tickAny({ event: String, data: Object, filter: Object/Function, down: Bool, up: Bool })
General method to send tick-s to __only one__ znode satisfying the filter.<br/>
Filter can be an object or a predicate function.
Usage is same as [`node.requestAny`](#requestAny)

<a name="tickDownAny"></a>
#### znode.tickDownAny({ event: String, data: Object, filter: Object/Function })
Send tick-s to one of downstream znodes (znodes which has been connected to your znode via _connect()_ ).

<a name="tickUpAny"></a>
#### znode.tickUpAny({ event: String, data: Object, filter: Object/Function })
Send tick-s to one of upstream znodes (znodes to which your znode has been connected via _connect()_ ).

<a name="tickAll"></a>
#### znode.tickAll({ event: String, data: Object, filter: Object/Function, down: Bool, up: Bool })
Tick to **ALL** znodes satisfying the filter (object or predicate function), up ( _upstream_ ) and down ( _downstream_ ).

<a name="tickDownAll"></a>
#### znode.tickDownAll({ event: String, data: Object, filter: Object/Function })
Tick to **ALL** downstream znodes.

<a name="tickUpAll"></a>
#### znode.tickUpAll({ event: String, data: Object, filter: Object/Function })
Tick to **ALL** upstream znodes.

<a name="enableMetrics"></a>
#### znode.enableMetrics(interval)
Enables metrics, events will be triggered by the given interval. Default interval is 1000 ms. <br/>

<a name="disableMetrics"></a>
#### znode.disableMetrics()
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
    myServiceServer.onRequest('welcome', ({ head, body, reply, next }) => {
        console.log('onRequest - welcome', body);
        reply("Hello client");
        next();
    });

    // second handler for same channel
    myServiceServer.onRequest('welcome', ({ head, body, reply, next }) => {
        console.log('onRequest second - welcome', body);
    });

    // ** bind znode to given address provided during construction
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
    // ** response from server is "Hello client."
}());

```

<a name="advancedExamples"></a>
#### Example of filtering the znodes via options.

Let's say we want to group our znodes logicaly in some layers and send messages considering that layering.
- __znode__-s can be grouped in layers (and other options) and then send messages to only filtered nodes by layers or other options.
- the filtering is done on senders side which keeps all the information about the nodes (both connected to sender node and the ones that
sender node is connected to)

In this example, we will create one server znode that will bind in some address, and three client znodes will connect to our server znode.
2 of client znodes will be in layer `A`, 1 in `B`.

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
// ** this will tick only one node of the layer A nodes;
server.tickAny({ event: 'foobar', data: { foo: 'bar' }, filter: { layer: 'A' } });

// ** this will tick to all layer A nodes;
server.tickAll({ event: 'foobar', data: { foo: 'bar' }, filter: { layer: 'A' } });

// ** this will tick to all nodes that server connected to, or connected to server.
server.tickAll({ event: 'foobar', data: { foo: 'bar' } });


// ** you even can use regexp to filer znodes to which the tick will be sent
// ** also you can pass a predicate function as a filter which will get znode-s options as an argument
server.tickAll({ event: 'foobar', data: { foo: 'bar' }, filter: {layer: /[A-Z]/} })
```

<a name="askzeronode"></a>
### Still have a question ?
We'll be happy to answer your questions. Try to reach out us on zeronode gitter chat [<img src="https://img.shields.io/gitter/room/nwjs/nw.js.svg">](https://gitter.im/npm-zeronode/Lobby) <br/>

<a name="contributing"></a>
### Contributing
Contributions are always welcome! <br/>
Please read the [contribution guidelines](https://github.com/sfast/zeronode/blob/master/docs/CONTRIBUTING.md) first.

### Contributors
* [Artak Vardanyan](https://github.com/artakvg)
* [David Harutyunyan](https://github.com/davidharutyunyan)

### More about zeronode internals
Under the hood we are using <a href="http://zeromq.org" target="_blank">zeromq</a>-s Dealer and Router sockets.

<a name="license"></a>
### License
[MIT](https://github.com/sfast/zeronode/blob/master/LICENSE)
