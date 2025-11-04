import { expect } from 'chai'
import Client from '../src/client'
import Server from '../src/server'
import { events } from '../src/enum'

describe('Client Error Handling', () => {
  let server, client

  afterEach(async () => {
    if (client) {
      try {
        await client.close()
      } catch (err) {
        // Ignore cleanup errors
      }
      client = null
    }
    if (server) {
      try {
        await server.close()
      } catch (err) {
        // Ignore cleanup errors
      }
      server = null
    }
  })

  describe('Priority 1: Connect Error Handling', () => {
    it('should emit error event when connection fails', (done) => {
      client = new Client({})
      let errorEmitted = false

      client.on('error', (err) => {
        if (!errorEmitted) {
          errorEmitted = true
          expect(err).to.exist
          expect(err.code).to.equal(16) // CLIENT_CONNECT
          done()
        }
      })

      // Try to connect to a non-existent server with short timeout
      client.connect('tcp://127.0.0.1:9999', 500)
    })
  })

  describe('Priority 2: Disconnect Error Handling', () => {
    it('should handle disconnect error when already offline', async () => {
      client = new Client({})
      
      // Disconnect without being connected should not throw
      await client.disconnect()
      
      // Second disconnect should also work
      await client.disconnect()
    })
  })

  describe('Priority 3: Server Fail Handler Error', () => {
    it('should handle disconnect when server is already offline', async () => {
      client = new Client({})
      
      // Disconnect without a server connection
      await client.disconnect()
      
      // Should complete without throwing
      expect(client.getServerActor()).to.be.null
    })
  })

  describe('Additional Edge Cases', () => {
    it('should reject request when server is offline', async () => {
      client = new Client({})
      
      try {
        await client.request({ event: 'test', data: {} })
        expect.fail('Should have thrown an error')
      } catch (err) {
        expect(err.code).to.equal(17) // SERVER_IS_OFFLINE
      }
    })

    it('should reject tick when server is offline', async () => {
      client = new Client({})
      
      try {
        await client.tick({ event: 'test', data: {} })
        expect.fail('Should have thrown an error')
      } catch (err) {
        expect(err.code).to.equal(17) // SERVER_IS_OFFLINE
      }
    })

    it('should handle setOptions without notifying server', async () => {
      client = new Client({})
      
      // Set options without notifying (server offline)
      client.setOptions({ key: 'value' }, false)
      
      // Should update options without throwing
      expect(client.getOptions()).to.deep.include({ key: 'value' })
    })
  })
})

