/**
 * Child process for the parallel-close regression: binds a Server and connects
 * N Clients to it, then closes all of them at the same time, `rounds` times.
 * libzmq 4.3.5 aborts the whole process (pipe.cpp:305 / socket_base.cpp:2140)
 * when a pipe is terminated by both ends in the same instant, so the parent
 * asserts on this process's exit code. argv: rounds, clients.
 */

import '../../../src/index.js' // registers the zeromq transport
import Server from '../../../src/protocol/server.js'
import Client from '../../../src/protocol/client.js'

const [rounds = '60', clientCount = '3'] = process.argv.slice(2)
const quiet = { error () {}, warn () {}, info () {}, debug () {} }

for (let r = 0; r < Number(rounds); r++) {
  const server = new Server({ id: 'pc-srv', config: { logger: quiet } })
  await server.bind('tcp://127.0.0.1:0')
  const clients = Array.from({ length: Number(clientCount) }, (_, i) => new Client({ id: `pc-cli-${i}`, config: { logger: quiet } }))
  for (const client of clients) await client.connect(server.getAddress(), 5000)
  await Promise.all([...clients.map(client => client.close()), server.close()])
}
process.send?.('done')
process.exit(0)
