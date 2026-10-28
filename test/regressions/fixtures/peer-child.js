/**
 * Child process for dead-peer tests: connects a Node to argv[2] with id argv[3]
 * and options { service: argv[4] }, answers 'who', then reports 'up' over IPC.
 * The parent SIGKILLs it to simulate a crash (no CLIENT_STOP is sent).
 */

import Node from '../../../src/index.js'

const [address, id, service] = process.argv.slice(2)

const node = new Node({ id, options: { service }, config: { reconnect: 'disabled' } })
node.onRequest('who', () => id)
await node.connect({ address })
process.send('up')
