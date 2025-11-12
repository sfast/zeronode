import { Node } from '../src'

//    znode1
//      /\
//     /  \
//    /    \
// znode2  znode3

(async function () {
  let znode1 = new Node({bind: 'tcp://127.0.0.1:3000'})
  let znode2 = new Node()
  let znode3 = new Node()

  await znode1.bind()
  await znode2.connect({ address: znode1.getAddress() })
  await znode3.connect({ address: znode1.getAddress() })

  znode2.onRequest('foo', (envelope, reply) => {
    console.log(envelope.data)
    reply('reply from znode2.')
  })

  znode3.onRequest('foo', (envelope, reply) => {
    console.log(envelope.data)
    reply('reply from znode3.')
  })

  let rep = await znode1.requestAny({
    event: 'foo',
    data: 'request from znode1.'
  })

  console.log(rep)
}())