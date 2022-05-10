# graceful-http

HTTP server graceful shutdown, needed to achieve zero-downtime doing restarts.

```
npm i graceful-http
```

It allows you to handle all requests gracefully in case of a shutdown.\
This way you don't destroy requests in the middle of something.

For zero-downtime you must have multiple processes (PM2 cluster or something else).\
This library will only allow all requests to finish without interruption.

## Usage
```javascript
const express = require('express')
const graceful = require('graceful-http')

const app = express()

app.get('/', function (req, res) {
  res.send('ok')
})

const server = app.listen(3000, function () {
  console.log('listening', server.address())
})

const close = graceful(server)

process.once('SIGINT', async function () {
  console.log('closing')

  try {
    await close()
    console.log('closed')

    // + here close database, etc

    // process.exit(0)
  } catch (error) {
    console.error(error)
    // process.exit(1)
  }
})
```

## Normal request (less than 30s)
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

## Long request (more than 30s)
In case you have a really long request, like long-polling.\
You can check in real-time if the server is closing,\
this way you can send the response early.

```javascript
app.get('/long-polling', async function (req, res) {
  for (let i = 0; i < 60; i++) {
    if (graceful.check(res)) {
      break
    }

    await sleep(1000)
  }

  res.send('ok')
})
```

This check is necessary because `graceful-http` has an internal timeout.\
After 30s of `close()` it forcefully close all sockets.\
It's needed because there could be clients not respecting the `Connection` header.

## Credits to Dashlane
https://blog.dashlane.com/implementing-nodejs-http-graceful-shutdown/

## License
MIT
