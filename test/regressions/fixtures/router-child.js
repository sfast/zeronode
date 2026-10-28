/**
 * Child process for router tests: a Router that connects to the hub at
 * argv[2] with id argv[3]. With argv[4] === 'live' it also hosts a service
 * Node ({ service: 'svc' }) that reports every 'ping' tick over IPC.
 * Reports 'up' over IPC once connected; the parent may SIGKILL it.
 */

import Node, { Router } from '../../../src/index.js'

const [hubAddress, id, mode] = process.argv.slice(2)

const router = new Router({ id, config: { reconnect: 'disabled' } })
await router.bind('tcp://127.0.0.1:0')

if (mode === 'live') {
  const service = new Node({ id: `${id}-svc`, options: { service: 'svc' } })
  service.onTick('ping', () => process.send('ping'))
  await service.connect({ address: router.getAddress() })
}

await router.connect({ address: hubAddress })
process.send('up')
