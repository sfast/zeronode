#!/usr/bin/env node

/**
 * Zeronode CLI - Run a Router or Node from command line
 * 
 * Usage:
 *   # Router
 *   npx zeronode --router --bind tcp://0.0.0.0:8087
 *   
 *   # Node/Service
 *   npx zeronode --node --name auth --bind tcp://0.0.0.0:3001 --connect tcp://127.0.0.1:8087
 *   npx zeronode --node --name payment --connect tcp://127.0.0.1:8087
 */

import { Node, Router, NodeEvent, ReconnectPolicy } from '../src/index.js'
import readline from 'readline'

// Parse command line arguments
const args = process.argv.slice(2)

function parseArgs() {
  const options = {
    router: false,
    node: false,
    name: null,
    bind: null,
    connect: [],
    id: null,
    options: {},
    stats: null,
    interactive: false,
    debug: false,
    help: false
  }
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    
    switch (arg) {
      case '--router':
        options.router = true
        break
      case '--node':
        options.node = true
        break
      case '--name':
        options.name = args[++i]
        if (options.name) {
          options.options.service = options.name
        }
        break
      case '--bind':
      case '-b':
        options.bind = args[++i]
        break
      case '--connect':
      case '-c':
        options.connect.push(args[++i])
        break
      case '--id':
        options.id = args[++i]
        break
      case '--option':
      case '-o':
        // Parse key=value pairs
        const [key, value] = args[++i].split('=')
        options.options[key] = value
        break
      case '--stats':
        options.stats = parseInt(args[++i]) || 5000
        break
      case '--interactive':
      case '-i':
        options.interactive = true
        break
      case '--debug':
      case '-d':
        options.debug = true
        break
      case '--help':
      case '-h':
        options.help = true
        break
      default:
        console.error(`Unknown option: ${arg}`)
        options.help = true
    }
  }
  
  return options
}

function printHelp() {
  console.log(`
Zeronode CLI - Run a Router or Node

Usage:
  # Router
  npx zeronode --router --bind <address> [options]
  
  # Node/Service
  npx zeronode --node --name <name> [--bind <address>] --connect <router> [options]

Router Options:
  --router              Run as a router
  --bind, -b <address>  Bind address (required)
  --id <id>             Router ID (default: auto-generated)
  --stats <interval>    Print statistics every N milliseconds (default: 5000)

Node Options:
  --node                Run as a node/service
  --name <name>         Service name (sets service option)
  --bind, -b <address>  Bind address (optional)
  --connect, -c <addr>  Router/server address to connect to (repeatable)
  --id <id>             Node ID (default: auto-generated)
  --option, -o <k=v>    Set option key=value (e.g., version=1.0, region=us-east)
  --interactive, -i     Enable REPL (commands: send/list/exit, event=message)
  --stats <interval>    Print statistics every N milliseconds

Common Options:
  --debug, -d           Enable debug logging
  --help, -h            Show this help message

Interactive Mode Commands (with --interactive):
  send <service> <data>   Send JSON/text payload (event = "message")
  list                    Show upstream/downstream peers
  exit                    Quit the CLI

Examples:
  # Start a router
  npx zeronode --router --bind tcp://0.0.0.0:8087
  
  # Start an auth service connected to router
  npx zeronode --node --name auth --bind tcp://0.0.0.0:3001 --connect tcp://127.0.0.1:8087
  
  # Start a payment service (no bind, just connect to router)
  npx zeronode --node --name payment --connect tcp://127.0.0.1:8087
  
  # Interactive client for manual messaging
  npx zeronode --node --name chat-client --connect tcp://127.0.0.1:8087 --interactive
    > send auth {"message":"hello"}
  
  # Service with custom options
  npx zeronode --node --name worker \\
    --bind tcp://0.0.0.0:3002 \\
    --connect tcp://127.0.0.1:8087 \\
    --option version=1.0 \\
    --option region=us-east \\
    --option capacity=100

Documentation:
  https://github.com/sfast/zeronode
`)
  process.exit(0)
}

async function runRouter(options) {
  const router = new Router({
    id: options.id || `router-${process.pid}`,
    bind: options.bind,
    config: {
      DEBUG: options.debug || false
    }
  })
  
  try {
    await router.bind()
  } catch (error) {
    console.error(`Failed to bind to ${options.bind}:`, error.message)
    process.exit(1)
  }
  
  console.log('🚀 Zeronode Router Started')
  console.log('='.repeat(60))
  console.log(`ID:       ${router.getId()}`)
  console.log(`Address:  ${router.getAddress()}`)
  console.log(`Options:  ${JSON.stringify(router.getOptions())}`)
  console.log('='.repeat(60))
  console.log('Router is ready to accept connections...')
  console.log('Press Ctrl+C to stop\n')
  
  if (options.stats) {
    setInterval(() => {
      const stats = router.getRoutingStats()
      
      console.log('\n📊 Router Statistics')
      console.log('-'.repeat(60))
      console.log(`Proxy Requests:     ${stats.proxyRequests}`)
      console.log(`Proxy Ticks:        ${stats.proxyTicks}`)
      console.log(`Successful Routes:  ${stats.successfulRoutes}`)
      console.log(`Failed Routes:      ${stats.failedRoutes}`)
      console.log(`Total Messages:     ${stats.totalMessages}`)
      console.log(`Uptime:             ${Math.floor(stats.uptime)}s`)
      console.log(`Requests/sec:       ${stats.requestsPerSecond.toFixed(2)}`)
      console.log('-'.repeat(60))
    }, options.stats)
  }
  
  setupShutdownHandlers(router, 'Router')
}

async function runNode(options) {
  const node = new Node({
    id: options.id || `${options.name || 'node'}-${process.pid}`,
    bind: options.bind,
    options: options.options,
    config: {
      reconnect: ReconnectPolicy.ALWAYS, // CLI nodes always reconnect
      DEBUG: options.debug || false
    }
  })
  
  // Bind if address provided
  if (options.bind) {
    try {
      await node.bind()
    } catch (error) {
      console.error(`Failed to bind to ${options.bind}:`, error.message)
      process.exit(1)
    }
  }
  
  console.log('🚀 Zeronode Service Started')
  console.log('='.repeat(60))
  console.log(`ID:       ${node.getId()}`)
  console.log(`Address:  ${node.getAddress() || 'Not bound'}`)
  console.log(`Options:  ${JSON.stringify(node.getOptions())}`)
  console.log('='.repeat(60))
  
  // Connect to routers/servers
  if (options.connect.length > 0) {
    console.log('\n📡 Connecting to servers...')
    for (const address of options.connect) {
      try {
        await node.connect({ address })
        console.log(`✅ Connected to ${address}`)
      } catch (error) {
        console.error(`❌ Failed to connect to ${address}:`, error.message)
      }
    }
  }
  
  console.log('\n✅ Node is ready!')
  console.log('Press Ctrl+C to stop\n')
  
  // Register a simple echo handler
  node.onRequest('echo', (envelope, reply) => {
    console.log(`\n📥 Received request: echo`)
    console.log(`   From: ${envelope.owner}`)
    console.log(`   Data: ${JSON.stringify(envelope.data)}`)
    reply({ echo: envelope.data, timestamp: Date.now() })
  })
  
  // Register a ping handler
  node.onRequest('ping', (envelope, reply) => {
    console.log(`\n📥 Received request: ping from ${envelope.owner}`)
    reply({ pong: true, timestamp: Date.now() })
  })
  
  // Register a message handler for interactive sessions
  node.onRequest('message', (envelope, reply) => {
    const payload = envelope.data || {}
    const metadata = envelope.metadata || {}
    const routingInfo = metadata.routing || {}
    const senderId = payload.sender || routingInfo.requestor || envelope.owner
    
    console.log(`\n💬 Message from ${senderId}`)
    if (payload.sender) {
      console.log(`   Sender: ${payload.sender}`)
    }
    if (payload.message !== undefined) {
      console.log(`   Message: ${payload.message}`)
    } else {
      console.log(`   Data: ${JSON.stringify(payload)}`)
    }
    reply({
      received: true,
      timestamp: Date.now(),
      echo: payload
    })
  })
  
  // Interactive mode
  if (options.interactive) {
    console.log('📝 Interactive mode enabled')
    console.log('   Commands:')
    console.log('     send <service> <data>             - Send one message (event: message)')
    console.log('     list                              - List connected peers')
    console.log('     exit                              - Exit\n')
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '> '
    })
    
    rl.prompt()
    
    rl.on('line', async (line) => {
      const trimmed = line.trim()
      
      const parts = trimmed.split(/\s+/)
      const command = parts[0]
      if (!command) {
        rl.prompt()
        return
      }
      
      try {
        switch (command) {
          case 'send': {
            const serviceName = parts[1]
            const dataStr = parts.slice(2).join(' ')
            let data = {}
            
            if (dataStr) {
        try {
          data = JSON.parse(dataStr)
        } catch {
          data = { message: dataStr }
        }
            }
            
      if (!serviceName) {
              console.log('Usage: send <service> <data>')
              break
            }
            
      if (typeof data !== 'object' || data === null) {
        data = { value: data }
      } else {
        data = { ...data }
      }
      
      if (data.message === undefined && !dataStr) {
        data.message = ''
      }
      
      if (!data.sender) {
        data.sender = node.getId()
      }
      
      if (!data.timestamp) {
        data.timestamp = Date.now()
      }
      
            console.log(`\n📤 Sending message to service=${serviceName}, event=message`)
            console.log(`   Data: ${JSON.stringify(data)}`)
            
            const result = await node.requestAny({
              filter: { service: serviceName },
              event: 'message',
              data,
              timeout: 5000
            })
            
            console.log(`✅ Response:`, JSON.stringify(result, null, 2))
            break
          }
          
          case 'list': {
            const supportsPeerIntrospection =
              typeof node.getNodesDownstream === 'function' &&
              typeof node.getNodesUpstream === 'function'
            
            console.log(`\n📋 Connected Peers:`)
            
            if (supportsPeerIntrospection) {
              const downstream = node.getNodesDownstream()
              const upstream = node.getNodesUpstream()
              
              console.log(`   Downstream: ${downstream.length}`)
              downstream.forEach(id => console.log(`     - ${id}`))
              console.log(`   Upstream: ${upstream.length}`)
              upstream.forEach(id => console.log(`     - ${id}`))
            } else {
              console.log('   Peer list not available (update Node to latest version)')
            }
            break
          }
          
          case 'exit':
          case 'quit':
          console.log('\n👋 Exiting...')
          await node.close()
          process.exit(0)
            break
          
          case 'help':
            console.log('\nCommands:')
            console.log('  request <service> <event> [data]  - Send a request')
            console.log('  list                              - List connected peers')
            console.log('  exit                              - Exit')
            break
          
          default:
            if (command) {
              console.log(`Unknown command: ${command}. Type "help" for commands.`)
            }
        }
      } catch (error) {
        console.error(`❌ Error:`, error.message)
      }
      
      rl.prompt()
    })
    
    rl.on('close', () => {
      console.log('\n👋 Exiting...')
      process.exit(0)
    })
  }
  
  setupShutdownHandlers(node, 'Node')
}

function setupShutdownHandlers(instance, name, { beforeClose } = {}) {
  const shutdown = async (signal) => {
    console.log(`\n\n⏹️  ${signal === 'SIGTERM' ? 'Received SIGTERM,' : ''} Shutting down ${name}...`)
    if (typeof beforeClose === 'function') {
      try {
        await beforeClose()
      } catch (err) {
        console.error(`⚠️  Error during ${name} cleanup:`, err.message)
      }
    }
    await instance.close()
    console.log(`✅ ${name} stopped gracefully`)
    process.exit(0)
  }
  
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

async function main() {
  const options = parseArgs()
  
  if (options.help) {
    printHelp()
  }
  
  if (options.router && options.node) {
    console.error('Error: Cannot use both --router and --node')
    process.exit(1)
  }
  
  if (!options.router && !options.node) {
    console.error('Error: Must specify either --router or --node')
    console.error('Run with --help for usage information')
    process.exit(1)
  }
  
  if (options.router) {
    if (!options.bind) {
      console.error('Error: --bind address is required for router')
      process.exit(1)
    }
    await runRouter(options)
  } else if (options.node) {
    if (options.connect.length === 0 && !options.bind) {
      console.error('Error: Must specify at least --bind or --connect')
      process.exit(1)
    }
    await runNode(options)
  }
}

main().catch(error => {
  console.error('❌ Fatal error:', error)
  process.exit(1)
})

