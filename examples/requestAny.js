import {Node, NodeEvents} from '../src'

// ** creating simple node which can serve as a 'server' node
let nodeDns = new Node({ id: 'serverJan', bind: 'tcp://127.0.0.1:6001' })
nodeDns.onRequest('foo-server', ({body, reply, next}) => {
  console.log(`Server (${nodeDns.getId()}): I got a request from client`, body)
  //* when server get a request we reply back to client
  reply(Date.now())
})

nodeDns.on(NodeEvents.CLIENT_CONNECTED, (data) => {
  console.log(`Client connected to server`, data)
})

nodeDns.on(NodeEvents.CLIENT_FAILURE, (data) => {
  console.log(`Client failure: `, data)
})

nodeDns.on(NodeEvents.OPTIONS_SYNC, (data) => {
  console.log(`options sync`, data)
})

// ** creating simple node which can serve as a 'client' node
let nodeA = new Node({ id: 'clientJan', options: {x: 1, y: 2} })
nodeA.onRequest('foo-client', ({body, reply, next}) => {
  console.log(`Client (${nodeA.getId()}): I got a request from server`, body)
  //* when client get a request we reply back to server
  reply(Date.now())
})

let nodeB = new Node({ options: {x: 2, y: 3} })
nodeB.onRequest('foo-client', ({body, reply, next}) => {
  console.log(`Client (${nodeB.getId()}): I got a request from dns`, body)
  //* when client get a request we reply back to server
  reply(Date.now())
})

const runLoadBalancedRequest = () => {
  nodeDns.bind()
    .then(async () => {
      await nodeA.connect(nodeDns.getAddress())
      await nodeB.connect(nodeDns.getAddress())
    })
    .then(async () => {
      console.log(`-- Example 1 --`)
      let reply1 = await nodeDns.request({ to: nodeA.getId(), event: 'foo-client', data: {stamp: Date.now()} })
      console.log(`Dns (${nodeDns.getId()}): I got a reply from client`, reply1)

      console.log(`-- Example 2 --`)
      let reply2 = await nodeDns.request({ to: nodeB.getId(), event: 'foo-client', data: {stamp: Date.now()} })
      console.log(`Dns (${nodeDns.getId()}): I got a reply from client`, reply2)

      console.log(`-- Example 3 --`)
      let reply3 = await nodeDns.requestAny({
        event: 'foo-client',
        data: {stamp: Date.now()},
        filter: (clientOptions) => {
          let {x, y} = clientOptions
          return x + y > 1
        }
      })
      console.log(`Dns (${nodeDns.getId()}): I got a reply from client`, reply3)

      console.log(`-- Example 4 --`)

      let reply4 = await nodeDns.requestAny({
        event: 'foo-client',
        data: {stamp: Date.now()},
        filter: {x: 1}
      })

      console.log(`Dns (${nodeDns.getId()}): I got a reply from client`, reply4)

      console.log(`-- Example 5 --`)
      // Changing options on the fly
      nodeA.setOptions({x: 100})

      setTimeout(async () => {
        let reply5 = await nodeDns.requestAny({
          event: 'foo-client',
          data: {stamp: Date.now()},
          filter: (clientOptions) => {
            let {x, y} = clientOptions
            return x === 100
          }
        })
        console.log(`Dns (${nodeDns.getId()}): I got a reply from client`, reply5)
      }, 500)
    })
    .catch((err) => {
      console.log(err)
    })
}

runLoadBalancedRequest()
