[![JavaScript Style Guide](https://cdn.rawgit.com/standard/standard/master/badge.svg)](https://github.com/standard/standard)<br/><br/><br/>
[<img src="https://img.shields.io/gitter/room/nwjs/nw.js.svg">](https://gitter.im/npm-zeronode/Lobby) 
<img src="https://snyk.io/test/npm/zeronode/badge.svg" alt="Known Vulnerabilities" data-canonical-src="https://snyk.io/test/npm/zeronode" style="max-width:100%;"/>
<img src="https://img.shields.io/twitter/url/http/shields.io.svg?style=social" alt="Tweet" />

## Zeronode - minimal building block for NodeJS microservices 
![Zeronode](https://i.imgur.com/NZVXZPo.png)

### Why you need ZeroNode ? 
Application backends are becaming complex these days and there are lots of moving parts talking to each other through network.
There is a great difference between sending a few bytes from A to B, and doing messaging in reliable way. :heavy_exclamation_mark::heavy_exclamation_mark::heavy_exclamation_mark:
- :pray: How to handle dynamic components ? (i.e., pieces that come and/or go away temporarily, scaling a microservice instances )
- :pray: How to handle messages that we can't deliver immediately ? (e.g waiting for a component to come back online)
- :pray: How to route messages in complex microservice architechture ? (i.e. one to one, one to many, custom grouping messaging)
- :pray: How we handle network errors ? (i.e., reconnecting of various pieces)

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
2. `connect(address, timeoutMiliseconds)` - Connects the node/actor to other nodes/actors the specified address. You can connect to many nodes.
If timeout is provided then the _connect promise_ will be rejected if connection is taking longer .<br/>
If timeout is not provided we'll wait for ages till it connects.
3. `unbind()` - Unbinds the node (it can still be connected to other nodes)
4. `disconnect(address)` - Disconnects the node from specified address.
5. `stop()` - Unbinds the node, and disconnects from all addresses.

#### Simple messaging methods
6. `request({ to, event, data, timeout })` - makes request to node with id (__to__). <br/>
If timeout is not provided it'll be 10000 milliseconds. <br/>
You can change it by calling _setOptions(options)_  and setting 'REQUEST_TIMEOUT' value 

7. `tick({ to, event, data })` - emits event to given node(__to__)

#### Attaching/Detaching handlers to tick and request 

8. `onRequest(event: String, handler: Function)` - adds request handler for given event.

9. `onTick(event: String, handler: Function)` - adds event handler to given event.

10. `offRequest(event: String, handler: Function)` - removes request handler for given event.<br/>
_If handler is not provided then removes all the listeners._

11. `offTick(event: String, handler: Function)` - removes given event handler from event listeners list. <br/>
_If handler is not provided then removes all the listeners._

#### Load balancing methods

General method to send request to __only one__ node satisfying the filter.<br/>
Filter can be an object or a predicate function.

12. `requestAny({ event, data, timeout, filter, down = true, up = true })`<br/>

Send request to one of downstream nodes (nodes which has been connected to your node via _connect()_ )<br/>
13. `requestDownAny ({ event, data, timeout, filter } = {})` <br/>

Send request to one of upstream nodes (nodes to which ones your node has been connected via _connect()_ )<br/>
14. `requestUpAny ({ event, data, timeout, filter } = {})` <br/>

General method to send tick-s to __only one__ node satisfying the filter.<br/>
Filter can be an object or a predicate function.<br/>
15. `tickAny({ event, data, filter, down = true, up = true })`<br/>

Send tick-s to one of downstream nodes (nodes which has been connected to your node via _connect()_ )<br/>
16. `tickDownAny({ event, data, filter }`<br/>

Send tick-s to one of upstream nodes (nodes which has been connected to your node via _connect())_ )<br/>
17. `tickUpAny({ event, data, filter }`<br/>

Tick to all nodes satisfying the filter, up ( _upstream_ ) and down ( _downstream_ )<br/>
18. `tickAll({ event, data, filter, down = true, up = true }` <br/>

Tick to all downstream nodes <br/>
19. `tickDownAll({ event, data, filter })` <br/>

Tick to all upstream nodes <br/>
20. `tickUpAll({ event, data, filter })` <br/>

#### Debugging and troubleshooting

21. `enableMetrics(interval)` - enables metrics, events will be triggered by given interval. Default interval is 1000 ms. <br/>

22. `disableMetrics()` - disables metrics. <br/>


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
   myServiceClient.tick({ to: serverNodeId, event: 'welcome', data:'Hi server!!!' });
   
   // ** you request to another node and getting a promise
   // ** which will be resolve after reply.
   let responseFromServer = await myServiceClient.request({ to: serverNodeId, event: 'welcome', data: 'Hi server, I am client !!!' });
   
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
    
    // ** connect to server address and set connection timeout to 20 seconds
    await clientA1.connect('tcp:://127.0.0.1:6000', 20000);
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
    
    // ** connect to server address and set connection timeout infinite
    await clientB1.connect('tcp:://127.0.0.1:6000');
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

### What We Are Using
Under the hood we are using <a href="http://zeromq.org" target="_blank">zeromq</a>-s Dealer and Router sockets.
