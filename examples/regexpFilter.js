import { Node } from '../src'


//    znode1
//      /\
//     /  \
//    /    \
// znode2  znode3

(async function () {
  let znode1 = new Node({ bind: 'tcp://127.0.0.1:3000' })
  let znode2 = new Node({ options: { version: '1.2.4' }})
  let znode3 = new Node({ options: { version: '0.0.6'}})

  await znode1.bind()
  await znode2.connect({ address: znode1.getAddress() })
  await znode3.connect({ address: znode1.getAddress() })

  znode2.onTick('foo', (msg) => {
    console.log('handling tick on znode2:', msg)
  })

  znode3.onTick('foo', (msg) => {
    console.log('handling tick on znode3:', msg)
  })

  znode1.tickAll({
    event: 'foo',
    data: 'tick from znode1.',
    filter: {
      version: /^1.(\d+\.)?(\d+)$/
    }
  })
}())