import { assert } from 'chai'
import Client from '../src/client'
import Server from '../src/server'

const address = 'tcp://127.0.0.1:3000';

describe('Client/Server', () => {
    let client, server;

    beforeEach(() => {
        client = new Client({});
        server = new Server({});
    });

    afterEach(() => {
        server.unbind();
        client.disconnect();
        client = null;
        server = null;
    })


    it('tickToServer', done => {
        let expectedMessage = 'xndzor';
        server.bind(address)
            .then(() => {
                return client.connect(address);
            })
            .then(() => {
                server.onTick('tandz', (message) => {
                    assert.equal(message, expectedMessage);
                    done();
                });
                client.tick('tandz', expectedMessage);
            })
    });

    it('requesttoServer-timeout', done => {
        let expectedMessage = 'xndzor';
        server.bind(address)
            .then(() => {
                return client.connect(address);
            })
            .then(() => {
                return client.request('tandz', expectedMessage, 500);
            })
            .catch(err => {
                assert.include(err, 'timeouted');
                done();
            })
    });

    it('requestToServer-response', done => {
        let expectedMessage = 'xndzor';
        server.bind(address)
            .then(() => {
                return client.connect(address);
            })
            .then(() => {
                server.onRequest('tandz', ({body, reply}) => {
                    assert.equal(body, expectedMessage);
                    reply(expectedMessage)
                })
                return client.request('tandz', expectedMessage, 2000);
            })
            .then((message) => {
                assert.equal(message, expectedMessage);
                done();
            })
    });

    it('tickToClient', done => {
        let expectedMessage = 'xndzor';
        server.bind(address)
            .then(() => {
                client.connect(address);
                client.onTick('tandz', message => {
                    assert.equal(message, expectedMessage);
                    done()
                })
                server.tick(client.getId(), 'tandz', expectedMessage);
            })
    });

    it('requestToClient-timeout', done => {
        let expectedMessage = 'xndzor';
        server.bind(address)
            .then(() => {
                client.connect(address);
                return server.request(client.getId(), 'tandz', expectedMessage, 500);
            })
            .catch(err => {
                assert.include(err, 'timeouted');
                done();
            })
    });

    it('requestToClient-response', done => {
        let expectedMessage = 'xndzor';
        server.bind(address)
            .then(() => {
                client.connect(address);
                client.onRequest('tandz', ({body, reply}) => {
                    assert.equal(body, expectedMessage);
                    reply(body);
                })
                return server.request(client.getId(), 'tandz', expectedMessage);
            })
            .then(message => {
                assert.equal(message, expectedMessage);
                done();
            })
    })


});