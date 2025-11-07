/**
 * Debug version to understand handshake flow
 */

import { Client, Server } from '../src/index.js'
import { events } from '../src/enum.js'
import { ProtocolEvent } from '../src/protocol.js'
import { TransportEvent } from '../src/transport-events.js'

const ADDRESS = 'tcp://127.0.0.1:5570'

async function debug() {
  console.log('Starting debug...\n')

  // Create server
  const server = new Server({
    id: 'debug-server',
    config: {
      logger: console,
      debug: true
    }
  })

  // Create client
  const client = new Client({
    id: 'debug-client',
    config: {
      logger: console,
      debug: true
    }
  })

  // Debug: Listen to all events
  console.log('=== Setting up event listeners ===\n')

  // Get underlying sockets to debug
  const serverSocket = server._getSocket()
  const clientSocket = client._getSocket()

  console.log(`Server socket ID: ${serverSocket.getId()}`)
  console.log(`Client socket ID: ${clientSocket.getId()}\n`)

  // Listen to ZeroMQ events directly - need to access internal _private WeakMap
  // In RouterSocket and DealerSocket, the ZMQ socket is stored in _private WeakMap
  // We can't access it directly, so let's check a different way
  
  console.log(`Testing socket.events access patterns...`)
  
  // Try to get socket reference via reflection
  const zmqServerSocket = serverSocket._getSocket ? serverSocket._getSocket() : null
  const zmqClientSocket = clientSocket._getSocket ? clientSocket._getSocket() : null
  
  console.log(`Server zmq socket via _getSocket: ${zmqServerSocket}`)
  console.log(`Client zmq socket via _getSocket: ${zmqClientSocket}\n`)

  if (zmqServerSocket && zmqServerSocket.events) {
    zmqServerSocket.events.on('listen', () => {
      console.log('🎧 [ZMQ Server] listen event fired')
    })
  }

  if (zmqClientSocket && zmqClientSocket.events) {
    zmqClientSocket.events.on('connect', () => {
      console.log('🎧 [ZMQ Client] connect event fired')
    })
  }

  // Listen to transport events directly
  serverSocket.on(TransportEvent.READY, () => {
    console.log('🔌 [ServerSocket] TransportEvent.READY')
  })

  clientSocket.on(TransportEvent.READY, () => {
    console.log('🔌 [ClientSocket] TransportEvent.READY')
  })

  server.on(ProtocolEvent.TRANSPORT_READY, () => {
    console.log('📡 [Server] ProtocolEvent.TRANSPORT_READY')
  })

  server.on(events.SERVER_READY, () => {
    console.log('✅ [Server] events.SERVER_READY')
  })

  server.on(events.CLIENT_JOINED, ({ clientId }) => {
    console.log(`👤 [Server] CLIENT_JOINED: ${clientId}`)
  })

  // Debug: Listen to protocol tick handlers
  server.onTick('*', (data, envelope) => {
    console.log(`🎫 [Server] Received tick: ${envelope.tag} from ${envelope.owner}`)
  })

  // Debug: Listen to transport messages
  serverSocket.on(TransportEvent.MESSAGE, ({ buffer }) => {
    console.log(`📨 [ServerSocket] Received raw message (${buffer.length} bytes)`)
  })

  client.on(ProtocolEvent.TRANSPORT_READY, () => {
    console.log('📡 [Client] ProtocolEvent.TRANSPORT_READY')
  })

  client.on(events.TRANSPORT_READY, () => {
    console.log('📡 [Client] events.TRANSPORT_READY (low-level)')
  })

  client.on(events.CLIENT_READY, ({ serverId }) => {
    console.log(`✅ [Client] events.CLIENT_READY - server: ${serverId}`)
  })

  // Server: Handle ping
  server.onRequest('ping', (data) => {
    console.log('📨 [Server] Received ping request')
    return { pong: true }
  })

  try {
    console.log('\\n=== Binding server ===')
    await server.bind(ADDRESS)
    console.log(`✓ Server bound to ${ADDRESS}\\n`)

    console.log('=== Connecting client ===')
    await client.connect(ADDRESS)
    console.log(`✓ Client transport connected`)
    console.log(`Client isReady(): ${client.isReady()}\\n`)

    console.log('=== Waiting for handshake (5s timeout) ===')
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.log('❌ Handshake timeout!')
        reject(new Error('Handshake timeout'))
      }, 5000)

      client.once(events.CLIENT_READY, ({ serverId }) => {
        clearTimeout(timeout)
        console.log(`✅ Handshake complete! Server ID: ${serverId}`)
        resolve()
      })
    })

    console.log(`\\nClient isReady() after handshake: ${client.isReady()}`)

    // Try a request
    console.log('\\n=== Testing request ===')
    const response = await client.request({
      event: 'ping',
      data: { test: true },
      timeout: 2000
    })
    console.log('✅ Request successful:', response)

  } catch (err) {
    console.error('\\n❌ Error:', err.message)
    console.error(err.stack)
  } finally {
    console.log('\\n=== Cleanup ===')
    await client.close()
    await server.close()
    console.log('✅ Cleanup complete')
    process.exit(0)
  }
}

debug()

