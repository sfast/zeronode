export default {
  // Legacy
  CLIENT_MUST_HEARTBEAT_INTERVAL: 6000,
  CLIENT_PING_INTERVAL: 2000,
  
  // New (for Client/Server)
  PING_INTERVAL: 10000,           // Client ping interval (10s)
  HEALTH_CHECK_INTERVAL: 30000,   // Server health check interval (30s)
  CLIENT_TIMEOUT: 60000           // Client considered GHOST after 60s without ping
}
