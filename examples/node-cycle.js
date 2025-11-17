import { Node } from '../src/index.js'
import _ from 'underscore'


(async function () {
  try {
    console.log('📦 Node Cycle Example - Ring topology message passing\n')
    
    const NODE_COUNT = 10
    const MESSAGE_COUNT = 1000

    let count = 0

    console.log(`🔧 Creating ${NODE_COUNT} nodes in a ring...\n`)
    
    let znodes = _.map(_.range(NODE_COUNT), (i) => {
      let znode = new Node()

      znode.onTick('foo', (envelope) => {
        count++

        if (count % 100 === 0) {
          console.log(`📊 Progress: ${count}/${MESSAGE_COUNT} messages passed`)
        }

        if (count === MESSAGE_COUNT) {
          console.log(`\n✅ Completed ${MESSAGE_COUNT} messages around the ring!`)
          console.log(`   Average: ${(MESSAGE_COUNT / (NODE_COUNT)).toFixed(1)} messages per node\n`)
          console.log('✨ Example complete!')
          process.exit(0)
        }

        znode.tickAny({
          event: 'foo',
          data: `msg from znode${i}`
        })
      })

      return znode
    })

    // Bind and connect in ring topology
    console.log('🔗 Setting up ring topology...')
    await Promise.all(_.map(znodes, async (znode, i) => {
      await znode.bind(`tcp://127.0.0.1:${3000 + i}`)
      console.log(`✅ znode${i} bound to port ${3000 + i}`)
      if (i === 0) return
      await znode.connect({address: znodes[i - 1].getAddress()})
    }))

    // Close the ring
    await znodes[0].connect({address: znodes[NODE_COUNT - 1].getAddress()})
    console.log(`✅ Ring closed (znode0 ↔ znode${NODE_COUNT - 1})`)

    console.log(`\n📤 Starting message cycle... (${MESSAGE_COUNT} messages total)\n`)
    znodes[0].tickAny({
      event: 'foo',
      data: `msg from znode0`
    })
  } catch (err) {
    console.error('❌ Error:', err)
  }
}())
