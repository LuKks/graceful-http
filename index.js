/*
Based on: https://blog.dashlane.com/implementing-nodejs-http-graceful-shutdown/
Added support for long-polling, an overall instant close, etc
*/

module.exports = graceful

const servers = new WeakMap()

function graceful (server, opts = {}) {
  const timeoutToTryEndIdle = opts.endIdle === undefined ? 15000 : opts.endIdle
  const forcedStopTimeout = opts.forceEnd === undefined ? 60000 : opts.forceEnd
  const reqCountPerSocket = new Map()
  const responses = new Map()

  servers.set(server, {
    hasRepliedClosedConnectionForSocket: new WeakMap(),
    closing: false
  })

  server.prependListener('connection', trackConnections)
  server.prependListener('request', trackRequests)

  function trackConnections (socket) {
    reqCountPerSocket.set(socket, 0)
    socket.once('close', () => {
      reqCountPerSocket.delete(socket)
    })
  }

  function trackRequests (req, res) {
    const currentCount = reqCountPerSocket.get(req.socket)
    reqCountPerSocket.set(req.socket, currentCount + 1)

    responses.set(res, true)

    setHeaderConnection(res)

    res.on('finish', () => {
      responses.delete(res)
      checkAndCloseConnection(req)
    })
  }

  function setHeaderConnection (res) {
    const srv = servers.get(res.socket.server)

    if (srv.closing && !res.headersSent) {
      res.setHeader('connection', 'close')
      srv.hasRepliedClosedConnectionForSocket.set(res.socket, true)
      responses.delete(res)
    }
  }

  function checkAndCloseConnection (req) {
    const srv = servers.get(req.socket.server)
    const socketPendingRequests = reqCountPerSocket.get(req.socket) - 1
    const hasSuggestedClosingConnection = srv.hasRepliedClosedConnectionForSocket.get(req.socket)

    reqCountPerSocket.set(req.socket, socketPendingRequests)
    if (srv.closing && socketPendingRequests === 0 && hasSuggestedClosingConnection) {
      req.socket.end()
    }
  }

  function endAllConnections ({ force }) {
    for (const [socket, reqCount] of reqCountPerSocket) {
      if (force || reqCount === 0) {
        socket.end()
      }
    }
  }

  function close () {
    return new Promise((resolve, reject) => {
      for (const [res] of responses) {
        setHeaderConnection(res)
      }

      let timeoutIdle
      if (timeoutToTryEndIdle < forcedStopTimeout) {
        timeoutIdle = setTimeout(() => endAllConnections({ force: false }), timeoutToTryEndIdle)
      }
      const timeoutForce = setTimeout(() => endAllConnections({ force: true }), forcedStopTimeout)

      const srv = servers.get(server)
      servers.set(server, { ...srv, closing: true })

      server.close(function (error) {
        clearTimeout(timeoutIdle)
        clearTimeout(timeoutForce)

        if (error) {
          reject(error)
          return
        }

        resolve()
      })

      // emit('closing')
    })
  }

  return close
}

graceful.check = function (obj) {
  const type = obj.constructor.name
  let server

  if (type === 'Socket') {
    const socket = obj
    server = socket.server
  } else if (type === 'IncomingMessage' || type === 'ServerResponse') {
    const requestOrResponse = obj
    server = requestOrResponse.socket.server
  } else {
    throw new Error(type + ' is not supported. Should be one of: Socket, IncomingMessage or ServerResponse')
  }

  const srv = servers.get(server)
  return srv.closing
}
