### How to configure zeronode

Zeronode can be configured by config object given in constructor.
```javascript
import Node from 'zeronode'

let node = new Node({ config: {/* some configurations */}})
```

### What can be configured

#### logger

Default logger of zeronode is Winston.
<br>
Logger can be changed, by giving new logger in configs.
```javascript
import Node from 'zeronode'

let node = new Node({ config: { logger: console }})
```

#### CLIENT_PING_INTERVAL
CLIENT_PING_INTERVAL is interval when client pings to server.
<br>
Default value is 2000ms.

#### CLIENT_MUST_HEARTBEAT_INTERVAL
CLIENT_MUST_HEARTBEAT_INTERVAL is heartbeat check interval
in which client must heartbeat to server at least once.

#### CONNECTION_TIMEOUT
CONNECTION_TIMEOUT is timeout for client trying to connect server.
<br>
Default value is -1 (infinity)

``` javascript
import Node from 'zeronode'

let configuredNode = new Node({
    CONNECTION_TIMEOUT: 10*000
})

let node = new Node()

configureNode.connect({ address: 'tcp://127.0.0.1:3000' }) // promise will be rejected after 10 seconds.
configureNode.connect({ address: 'tcp://127.0.0.1:3000', timeout: 5000 }) // promise will be rejected after 5 seconds.
node.connect({ address: 'tcp://127.0.0.1:3000' }) // promise never will be rejected.

```

#### RECONNECTION_TIMEOUT
RECONNECTION_TIMEOUT is timeout that client waits server, after server fail or stop.
<br>
Default value is -1 (infinity)

``` javascript
import Node from 'zeronode'

let configuredNode = new Node({
    RECONNECTION_TIMEOUT: 10*000
})

let node = new Node()

configureNode.connect({ address: 'tcp://127.0.0.1:3000' }) // will wait server 10 seconds.
configureNode.connect({ address: 'tcp://127.0.0.1:3000', timeout: 5000 }) // will wait server 5 seconds.
node.connect({ address: 'tcp://127.0.0.1:3000' }) // will wait server for ages.

```

#### REQUEST_TIMEOUT
REQUEST_TIMEOUT is global timeout for rejecting request if there isn't reply.
<br>
Default value is 10000ms.
<br>
REQUEST_TIMEOUT can't be infinity.

``` javascript
import Node from 'zeronode'

let configuredNode = new Node({
    REQUEST_TIMEOUT: 15 * 1000
})

let node = new Node()

configuredNode.requestAny({
    event: 'foo',
    timeout: 5000
}) // request will fail after 5 seconds.

configuredNode.requestAny({
    event: 'foo'
}) // request will fail after 15 seconds.

node.requestAny({
    event: 'foo'
}) // request will fail after 10 seconds.

```

#### MONITOR_TIMEOUT
MONITOR_TIMEOUT is zmq.monitor timeout.
<br>
Default value is 10ms.

#### MONITOR_RESTART_TIMEOUT
MONITOR_RESTART_TIMEOUT is zmq.monitor restart timeout, if first start throws error.
<br>
Default value is 1000ms.

