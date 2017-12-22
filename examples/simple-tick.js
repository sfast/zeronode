import Promise from 'bluebird'
import { Node, NodeEvents } from '../src'

// ** creating simple node which can serve as a 'server' node
let nodeServer = new Node({ bind: 'tcp://127.0.0.1:6001'})
nodeServer.onTick('foo-server', (data) => {
  console.log(`Server (${nodeServer.getId()}): I got a tick from client`, data)
  //* when server get a tick we tick back to client
  nodeServer.tick({ to: nodeClient.getId(), event: 'foo-client', data: {stamp: Date.now()} })
})

nodeServer.on(NodeEvents.CLIENT_CONNECTED, (data) => {
  console.log(`Client connected to server`, data)
})

// ** creating simple node which can serve as a 'client' node
let nodeClient = new Node()
nodeClient.onTick('foo-client', (data) => {
  console.log(`Client (${nodeClient.getId()}): I got a tick from server`, data)
})

const runSimpleTick = () => {
  nodeServer.bind()
    .then(() => {
      return nodeClient.connect({address: nodeServer.getAddress() })
    })
    .then(() => {
      nodeClient.tick({ to: nodeServer.getId(), event: 'foo-server', data: {stamp: Date.now()} })
    })
    .catch((err) => {
      console.log(err)
    })
}

runSimpleTick()
