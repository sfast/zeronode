import Promise from 'bluebird'
import Node from '../src/node'

// ** creating simple node which can serve as a 'server' node
let nodeServer = new Node({ bind: 'tcp://127.0.0.1:6001'})
nodeServer.onRequest('foo-server', ({body, reply, next}) => {
  console.log(`Server (${nodeServer.getId()}): I got a request from client`, body)
  //* when server get a request we reply back to client
  reply(Date.now())
})

// ** creating simple node which can serve as a 'client' node
let nodeClient = new Node()
nodeClient.onRequest('foo-client', ({body, reply, next}) => {
  console.log(`Client (${nodeClient.getId()}): I got a request from server`, body)
  //* when client get a request we reply back to server
  reply(Date.now())
})

const runSimpleRequest = () => {
  nodeServer.bind()
    .then(() => {
      return nodeClient.connect({address: nodeServer.getAddress()})
    })
    .then(async () => {
      console.log(`-- Step 1 --`)
      let reply1 = await nodeClient.request({ to: nodeServer.getId(), event: 'foo-server', data: {stamp: Date.now()} })
      console.log(`Client (${nodeClient.getId()}): I got a reply from server`, reply1)

      console.log(`-- Step 2 --`)
      let reply2 = await nodeServer.request({ to: nodeClient.getId(), event: 'foo-client', data: {stamp: Date.now()} })
      console.log(`Server (${nodeServer.getId()}): I got a reply from client`, reply2)

      console.log(`-- Step 3 --`)
      // ** we can also request with timeout, the default timeout is 10000 but can be changed
      let reply3 = await nodeServer.request({ to: nodeClient.getId(), event: 'foo-client', data: {stamp: Date.now()}, timeout: 1000 })
      console.log(`Server (${nodeServer.getId()}): I got a reply from client`, reply3)

      console.log(`-- Step 4 --`)
      await nodeServer.setOptions({REQUEST_TIMEOUT: 2000})
      let reply4 = await nodeServer.request({ to: nodeClient.getId(), event: 'foo-client', data: {stamp: Date.now()}})
      console.log(`Server (${nodeServer.getId()}): I got a reply from client`, reply4)

    })
    .catch((err) => {
      console.log(err)
    })
}

runSimpleRequest()
