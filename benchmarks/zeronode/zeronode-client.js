import Node from '../../src'
import _ from 'underscore'

let node = new Node();
let start

node.connect({ address: 'tcp://127.0.0.1:7000' })
  .then(() => {
    console.log('successfully started')
    start = Date.now()
    return Promise.all(_.map(_.range(50000), () => node.requestAny({
      event: 'foo',
      data: new Buffer(1000)
    })))
  })
  .then(() => {
    console.log(Date.now() - start)
  })
  .catch(err => {
    console.log(err)
  })