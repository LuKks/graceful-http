const tape = require('tape')
const express = require('express')
const graceful = require('./')
const axios = require('axios')
const http = require('http')

// these tests assume that Node have a keep-alive timeout of 5000 ms

tape('no requests', async function (t) {
  const server = createExpressApp()
  const close = graceful(server)
  await waitEvent(server, 'listening')

  const started = Date.now()
  await close()

  t.ok(isAround(Date.now() - started, 0), 'Server took the default 5 seconds of keep-alive time to close')
})

tape('keep-alive', async function (t) {
  const server = createExpressApp()
  const close = graceful(server)
  await waitEvent(server, 'listening')

  const request = requester()

  // trigger keep alive socket
  const response = await request('/')
  t.equal(response.data, 'ok')

  const started = Date.now()
  await close()

  t.ok(isAround(Date.now() - started, 5000), 'Server took the default 5 seconds of keep-alive time to close')
})

tape('keep-alive timeout', async function (t) {
  const server = createExpressApp()
  const close = graceful(server)
  await waitEvent(server, 'listening')

  const request = requester()

  const response = await request('/')
  t.equal(response.data, 'ok')

  // let keep-alive to expire
  await sleep(5000)

  const started = Date.now()
  await close()

  t.ok(isAround(Date.now() - started, 0), 'Server took no time to close')
})

tape('request with keep-alive, later close() and again another request', async function (t) {
  const server = createExpressApp()
  const close = graceful(server)
  await waitEvent(server, 'listening')

  const request = requester()

  const response = await request('/')
  t.equal(response.data, 'ok')

  const p1 = sleep(1000).then(() => request('/')) // here close() would be already called, so this request will get the header "Connection: close"

  const started = Date.now()
  await close()

  const response1 = await p1
  t.equal(response1.data, 'ok')

  t.ok(isAround(Date.now() - started, 1000), 'Server took the less than the default keep-alive time to close')
})


tape('close() in the middle of a slow request (loopResponses enabled)', async function (t) {
  const server = createExpressApp()
  const close = graceful(server)
  await waitEvent(server, 'listening')

  const request = requester()
  const r1 = request('/slow-request')
  await sleep(100)

  const started = Date.now()
  // here "Connection: close" would be set to all pending responses
  await close()

  const response1 = await r1
  t.equal(response1.data, 'ok')

  t.ok(isAround(Date.now() - started, 3000), 'Server took as long as the request (3s) to close')
})

tape('close() in the middle of a slow request (loopResponses disabled)', async function (t) {
  const server = createExpressApp()
  const close = graceful(server, { loopResponses: false })
  await waitEvent(server, 'listening')

  const request = requester()
  const r1 = request('/slow-request')
  await sleep(100)

  const started = Date.now()
  await close()

  const response1 = await r1
  t.equal(response1.data, 'ok')

  t.ok(isAround(Date.now() - started, 8000), 'Server took as long as the request (3s) + keep-alive timeout (5s) to close')
})

tape('close() in the middle of a long-polling request', async function (t) {
  const server = createExpressApp()
  const close = graceful(server)
  await waitEvent(server, 'listening')

  const request = requester()
  const r1 = request('/long-polling')
  await sleep(100)

  const started = Date.now()
  await close()

  const response1 = await r1
  t.equal(response1.data, 'ok')

  t.ok(isAround(Date.now() - started, 1000), 'Server took as long as the check(res) to close')
})

tape('multiple concurrent requests', async function (t) {
  const server = createExpressApp()
  const close = graceful(server)
  await waitEvent(server, 'listening')

  const request = requester()

  const response1 = await request('/')
  t.equal(response1.data, 'ok')

  const r2 = request('/slow-request')
  const r3 = request('/long-polling')

  await sleep(100)

  const started = Date.now()
  await close()

  const response2 = await r2
  t.equal(response2.data, 'ok')

  const response3 = await r3
  t.equal(response3.data, 'ok')

  t.ok(isAround(Date.now() - started, 3000), 'Server took as the longest request to close')
})

tape('endIdle', async function (t) {
  const server = createExpressApp()
  const close = graceful(server, { endIdle: 1000 })
  await waitEvent(server, 'listening')

  const request = requester()

  const response1 = await request('/')
  t.equal(response1.data, 'ok')

  const started = Date.now()
  await close()

  t.ok(isAround(Date.now() - started, 1000), 'Server took the configured endIdle to close')
})

tape('forceEnd with a pending request', async function (t) {
  const server = createExpressApp()
  const close = graceful(server, { forceEnd: 1000 })
  await waitEvent(server, 'listening')

  const request = requester()

  const r1 = request('/slow-request').catch(error => error)
  await sleep(100)

  const started = Date.now()
  await close()

  const response1 = await r1
  // t.fail('Request should not have succeed')
  t.equal(response1.code, 'ECONNRESET')

  t.ok(isAround(Date.now() - started, 1000), 'Server took the configured forceEnd to close')
})

// helpers
function createExpressApp () {
  const app = express()

  app.get('/', function (req, res) {
    res.send('ok')
  })

  app.get('/slow-request', async function (req, res) {
    await sleep(3000)

    res.send('ok')
  })

  app.get('/long-polling', async function (req, res) {
    for (let i = 0; i < 15; i++) {
      if (graceful.check(res)) {
        break
      }

      await sleep(1000)
    }

    res.send('ok')
  })

  const server = app.listen(3030)

  // server.once('listening', () => console.log('event listening'))
  // server.once('close', () => console.log('event close'))

  return server
}

function requester () {
  const httpAgent = new http.Agent({
    keepAlive: true,
    // keepAliveMsecs: 5000
  })

  return function (url, opts = {}) {
    return axios.get('http://localhost:3030' + url, { httpAgent: opts.httpAgent || httpAgent })
  }
}

function waitEvent (emitter, eventName) {
  return new Promise(resolve => emitter.once(eventName, resolve))
}

function isAround (delay, real, precision = 200) {
  const diff = Math.abs(delay - real)
  // console.log('isAround', { delay, real, precision }, { diff })
  return diff <= precision
}

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
