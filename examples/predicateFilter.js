import { Node } from '../src/index.js'
import _ from 'underscore'

//    znode1
//      |
//      |
// [clientNodes]
//

(async function () {
  console.log('📦 Predicate Filter Example - Filter with custom function\n')
  
  let znode1 = new Node({ bind: 'tcp://127.0.0.1:3000' })
  let clientNodes = _.map(_.range(10), (index) => {
    let znode = new Node({ options: { index } })

    znode.onTick('foo', (envelope) => {
      console.log(`📨 clientNode${index} (index=${index}) received tick: "${envelope.data}"`)
    })

    return znode
  })

  console.log('🔧 Setting up nodes...')
  await znode1.bind()
  console.log(`✅ znode1 bound to ${znode1.getAddress()}`)
  
  await Promise.all(_.map(clientNodes, (znode, index) => {
    return znode.connect({ address: znode1.getAddress() }).then(() => {
      console.log(`✅ clientNode${index} (index=${index}) connected`)
    })
  }))
  
  console.log('\n📤 znode1 sending tickAll with predicate filter...')
  console.log('   Filter: { predicate: (options) => options.index % 2 }')
  console.log('   (Only odd-numbered nodes will receive)\n')
  
  await znode1.tickAll({
    event: 'foo',
    data: 'tick from znode1.',
    filter: { predicate: (options) => options.index % 2 }
  })
  
  setTimeout(() => {
    console.log('\n✨ Filter worked! Only odd-indexed nodes received the message')
    console.log('   (nodes 1, 3, 5, 7, 9)\n')
    console.log('✨ Example complete!')
    process.exit(0)
  }, 1000)
}())