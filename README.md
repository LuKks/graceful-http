# graceful-http

HTTP graceful shutdown, needed to achieve zero-downtime doing restarts.

```
npm i graceful-http
```

Allows all requests to finish without interruption.\
It also end sockets gracefully using the `Connection` header.

For zero-downtime you must have more processes (PM2 cluster or something else).

## Usage
```javascript
const express = require('express')
const graceful = require('graceful-http')

const app = express()

app.get('/', function (req, res) {
  res.send('ok')
})

const server = app.listen(3000)

const close = graceful(server)

process.once('SIGINT', async function () {
  try {
    await close()
    // + here close database, etc
    process.exit(0)
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
})
```

## Normal request (less than 60s)
Let's say you have a request that always takes several seconds.\
All pending requests are automatically handled for you.

```javascript
app.get('/long-request', async function (req, res) {
  await sleep(1000) // ie. fetching stock prices
  // + ie. here PM2 sends SIGINT signal
  await sleep(1000) // ie. querying a remote database

  res.send('ok')
})
```

## Long request (more than 60s)
Use `graceful.check(res)` to know if the server is closing,\
this way you can send the response early. Useful for `long-polling`.

```javascript
app.get('/long-polling', async function (req, res) {
  for (let i = 0; i < 60; i++) {
    // checks if server is closing
    if (graceful.check(res)) {
      break
    }

    await sleep(1000)
  }

  res.send('ok')
})
```

This check is necessary because `graceful-http` has an internal timeout.\
After 60s of `close()` it forcefully close all sockets.\
It's needed because there could be clients not respecting the `Connection` header.

## Default configuration
```javascript
const close = graceful(server, {
  endIdle: 15000,
  forceEnd: 60000
})
```

`endIdle` will end sockets with no pending requests.\
Default Node HTTP `keep-alive` timeout is `5000` ms.\
Keep `endIdle` higher than the `keep-alive` timeout.

`forceEnd` will end sockets even with pending requests.\
You must set `forceEnd` higher than the most longer request.

## Credits to Dashlane
https://blog.dashlane.com/implementing-nodejs-http-graceful-shutdown/

## License
MIT
