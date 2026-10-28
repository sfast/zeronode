/**
 * Child process for dead-peer tests: binds a Node (port 0) with options
 * { service: argv[3] } and id argv[2], reports { address } over IPC, and on
 * 'charge' reports { exec: id } and never answers. The parent SIGKILLs it
 * mid-handler to simulate a crash after delivery.
 */

import Node from '../../../src/index.js'

const [id, service] = process.argv.slice(2)

const node = new Node({ id, options: { service } })
node.onRequest('charge', () => {
  process.send({ exec: id })
  return new Promise(() => {})
})
await node.bind('tcp://127.0.0.1:0')
process.send({ address: node.getAddress() })
