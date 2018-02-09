import { Node } from '../src'
import _ from 'underscore'

//    znode1
//      |
//      |
// [clientNodes]
//

(async function () {
  let znode1 = new Node({ bind: 'tcp://127.0.0.1:3000' })
  let clientNodes = _.map(_.range(10), (index) => {
    let znode = new Node({ options: { index } })

    znode.onTick('foo', (msg) => {
      console.log(`handling tick on clienNode${index}:`, msg)
    })

    return znode
  })

  await znode1.bind()
  await Promise.all(_.map(clientNodes, (znode) => znode.connect({ address: znode1.getAddress() })))

  znode1.tickAll({
    event: 'foo',
    data: 'tick from znode1.',
    filter: (options) => options.index % 2
  })
}())