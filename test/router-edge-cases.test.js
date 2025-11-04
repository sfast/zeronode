import { expect } from 'chai'
import Server from '../src/server'

describe('Router Edge Cases', () => {
  let server

  afterEach(async () => {
    if (server) {
      try {
        await server.close()
      } catch (err) {
        // Ignore cleanup errors
      }
      server = null
    }
  })

  describe('Bind Validation', () => {
    it('should handle binding to same address twice', async () => {
      server = new Server({ bind: 'tcp://127.0.0.1:3060' })
      
      await server.bind()
      expect(server.isOnline()).to.be.true
      
      // Binding again to same address should return immediately
      const result = await server.bind('tcp://127.0.0.1:3060')
      expect(result).to.be.true
    })

    it('should return pending bind promise when called again during bind', async () => {
      server = new Server({ bind: 'tcp://127.0.0.1:3063' })
      
      // Start binding
      const promise1 = server.bind()
      const promise2 = server.bind('tcp://127.0.0.1:3063')
      
      // Both promises should be the same
      expect(promise1).to.equal(promise2)
      
      await promise1
      expect(server.isOnline()).to.be.true
    })
  })

  describe('Unbind Edge Cases', () => {
    it('should handle unbind when already unbound', async () => {
      server = new Server({ bind: 'tcp://127.0.0.1:3065' })
      
      // Unbind without binding first
      await server.unbind()
      
      // Should complete without errors
      expect(server.isOnline()).to.be.false
    })
  })

  describe('Bind Error Handling', () => {
    it('should handle bind errors', async () => {
      server = new Server({ bind: 'invalid://address' })
      
      try {
        await server.bind()
        expect.fail('Should have thrown an error')
      } catch (err) {
        expect(err).to.exist
        expect(err.code).to.equal(20) // BIND_FAILED
      }
    })
  })
})

