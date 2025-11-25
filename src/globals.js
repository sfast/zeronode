import { BufferStrategy } from './protocol/envelope.js'

export default {
  // Request timeout (10s)
  PROTOCOL_REQUEST_TIMEOUT: 10000,   
  // Buffer strategy (EXACT) or POWER_OF_2 to kind of make data buffers power of 2 sizes
  PROTOCOL_BUFFER_STRATEGY: BufferStrategy.EXACT,
  // Client ping interval (10s)
  CLIENT_PING_INTERVAL: 10000,
  // Once client connected Server health checks client pings in this interval (30s)    
  CLIENT_HEALTH_CHECK_INTERVAL: 30000,  
  // Client considered GHOST after 60s without ping
  CLIENT_GHOST_TIMEOUT: 60000
}
