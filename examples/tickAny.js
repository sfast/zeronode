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

  znode2.onTick('foo', (envelope) => {
    console.log('handling tick on znode2:', envelope.data)
  })

  znode3.onTick('foo', (envelope) => {
    console.log('handling tick on znode3:', envelope.data)
  })

  znode1.tickAny({
    event: 'foo',
    data: 'tick from znode1.'
  })
}())