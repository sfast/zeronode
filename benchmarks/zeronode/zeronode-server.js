import Node from '../../src'

let node = new Node();

node.bind('tcp://*:7000')
  .then(() => {
    node.onRequest('foo', ({ body, reply }) => {
      reply(new Buffer(1000))
    })
    console.log('successfully started')
  })