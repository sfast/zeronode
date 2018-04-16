### How to use middleware
In zeronode there are two messaging types, request and tick.
While tick is simple event emitter, request handlers are successively called and can be used as **middlewares**.
<br>
<br>
In **Middleware** can perform following tasks:
- Execute any code.
- change request body.
- reply to request.
- Call the next middleware function in the stack.

If the current middleware function does not end the request-reply cycle,
it must call next() to pass control to the next middleware function.
Otherwise, the request will be left hanging.

### Examples

##### Simple usage of middlewares

```javascript
import Node from 'zeronode'
async function run() {
    try {
        let a = new Node()
        let b = new Node()
        await a.bind()
        await b.connect({ address: a.getAddress() })
        a.onRequest('foo', ({ body, error, reply, next, head })) => {
            conosle.log('In first middleware.')
            next()
        })

        a.onRequest('foo', ({ body, error, reply, next, head })) => {
            console.log('in second middleware.')
            reply()
        })

        await b.request({
            id: a.getId(),
            event: 'foo'
        })

        console.log('done')
    } catch (err) {
        console.error(err)
    }
}

run()

//after executing this code, it will print
/*
In first middleware.
in second middleware.
done
*/

```

<br>
##### Replying in First Middleware and calling next in second middleware

```javascript
import Node from 'zeronode'
async function run() {
    try {
        let a = new Node()
        let b = new Node()
        await a.bind()
        await b.connect({ address: a.getAddress() })
        a.onRequest('foo', ({ body, error, reply, next, head })) => {
            conosle.log('In first middleware.')
            reply()
        })

        a.onRequest('foo', ({ body, error, reply, next, head })) => {
            console.log('in second middleware.')
            next()
        })

        await b.request({
            id: a.getId(),
            event: 'foo'
        })

        console.log('done')
    } catch (err) {
        console.error(err)
    }
}

run()

//after executing this code, it will print
/*
In first middleware.
done
*/
// The second middleware doesn't called,
// because middlewares are called in same order as they added.
```

<br>
##### Adding middlewares with regex

```javascript
import Node from 'zeronode'
async function run() {
    try {
        let a = new Node()
        let b = new Node()
        await a.bind()
        await b.connect({ address: a.getAddress() })
        a.onRequest('foo', ({ body, error, reply, next, head })) => {
            conosle.log('In first middleware.')
            next()
        })

        a.onRequest(/^f/, ({ body, error, reply, next, head })) => {
            conosle.log('In second middleware.')
            next()
        })

        a.onRequest('foo', ({ body, error, reply, next, head })) => {
            console.log('in third middleware.')
            reply()
        })

        await b.request({
            id: a.getId(),
            event: 'foo'
        })

        console.log('done')
    } catch (err) {
        console.error(err)
    }
}

run()

//after executing this code, it will print
/*
In first middleware.
in second middleware.
in third middleware.
done
*/

```

<br>
##### Changing body in middleware

```javascript
import Node from 'zeronode'
async function run() {
    try {
        let a = new Node()
        let b = new Node()
        await a.bind()
        await b.connect({ address: a.getAddress() })
        a.onRequest('foo', ({ body, error, reply, next, head })) => {
            conosle.log('In first middleware.', body.foo)
            body.foo = 'baz'
            next()
        })

        a.onRequest('foo', ({ body, error, reply, next, head })) => {
            console.log('in second middleware.', body.foo)
            reply()
        })

        await b.request({
            id: a.getId(),
            event: 'foo',
            data: { foo: 'bar' }
        })

        console.log('done')
    } catch (err) {
        console.error(err)
    }
}

run()

//after executing this code, it will print
/*
In first middleware. bar
in second middleware. baz
done
*/

```

<br>
##### Rejecting request

```javascript
import Node from 'zeronode'
async function run() {
    try {
        let a = new Node()
        let b = new Node()
        await a.bind()
        await b.connect({ address: a.getAddress() })
        a.onRequest('foo', ({ body, error, reply, next, head })) => {
            conosle.log('In first middleware.')
            next('error message.')
        })

        a.onRequest('foo', ({ body, error, reply, next, head })) => {
            console.log('in second middleware.')
            reply()
        })

        await b.request({
            id: a.getId(),
            event: 'foo'
        })

        console.log('done')
    } catch (err) {
        console.error(err)
    }
}

run()

//after executing this code, it will print
/*
In first middleware.
error message.
*/

```