import { Node } from '../src'

//    znode3
//      /\
//     /  \
//    /    \
// znode1  znode2

(async function () {
  let znode3 = new Node({bind: 'tcp://127.0.0.1:3000'})
  let znode1 = new Node()
  let znode2 = new Node()

  await znode3.bind()
  await znode1.connect({ address: znode3.getAddress() })
  await znode2.connect({ address: znode3.getAddress() })

  znode2.onRequest('foo', ({ body, reply }) => {
    console.log(body)
    reply('reply from znode2.')
  })

  let rep = await znode1.requestAny({
    event: 'foo',
    data: 'request from znode1.'
  })

  console.log(rep)
}())