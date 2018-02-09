import { Node } from '../src'

//    znode1
//      |
//      |
//    znode2

(async function () {
  let znode1 = new Node({bind: 'tcp://127.0.0.1:3000'})
  let znode2 = new Node()

  await znode1.bind()
  await znode2.connect({ address: znode1.getAddress() })

  znode1.onTick('foo', (msg) => {
    console.log(msg)
  })

  znode2.tick({
    event: 'foo',
    to: znode1.getId(),
    data: 'msg from znode2'
  })
}())