import { Node } from '../src'
import _ from 'underscore'


(async function () {
  try {
    const NODE_COUNT = 10

    const MESSAGE_COUNT = 1000

    let count = 0

    let znodes = _.map(_.range(NODE_COUNT), (i) => {
      let znode = new Node()

      znode.onTick('foo', (msg) => {
        count++

        if (count === MESSAGE_COUNT) {
          console.log('finished', count)
          return
        }

        znode.tickAny({
          event: 'foo',
          data: `msg from znode${i}`
        })
      })

      return znode
    })

    await Promise.all(_.map(znodes, async (znode, i) => {
      await znode.bind(`tcp://127.0.0.1:${3000 + i}`)
      if (i === 0) return
      await znode.connect({address: znodes[i - 1].getAddress()})
    }))

    await znodes[0].connect({address: znodes[NODE_COUNT - 1].getAddress()})

    znodes[0].tickAny({
      event: 'foo',
      data: `msg from znode0`
    })
  } catch (err) {
    console.error(err)
  }
}())
