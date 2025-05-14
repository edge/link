// Copyright (C) 2025 Edge Network Technologies Limited
// Use of this source code is governed by a GNU GPL-style license
// that can be found in the LICENSE.md file. All rights reserved.

import { WebSocketServer } from 'ws'
import { WalletUtils } from '@edge/utils'
import { EventEmitter } from 'events'
import { ConnectedClient } from './ConnectedClient.js'
import debug from 'debug'
import http from 'http'
import https from 'https'
import fs from 'fs'

const log = debug('link:server')

export class Server {
  constructor({
    port = 3793,
    authTimeout = 5000,
    authCheckInterval = 1000,
    heartbeatInterval = 1000,
    clientTimeout = 5000,
    clientTimeoutInterval = 1000,
    wallet = null,
    privateKey = null,
    whitelist = null,
    key = null, // Path to TLS key
    cert = null // Path to TLS cert
  } = {}) {
    this._events = new EventEmitter()
    this._clients = new Set()
    this._pendingSockets = new Map() // socket -> timestamp
    this._pendingAuth = new Map()    // ws -> timestamp

    this.key = key
    this.cert = cert
    this.port = port
    this.authTimeout = authTimeout
    this.authCheckInterval = authCheckInterval
    this.heartbeatInterval = heartbeatInterval
    this.clientTimeout = clientTimeout
    this.clientTimeoutInterval = clientTimeoutInterval
    this.whitelist = whitelist ? new Set(whitelist) : null

    if (privateKey) this.wallet = WalletUtils.restoreWalletFromPrivateKey(privateKey)
    else this.wallet = wallet || WalletUtils.generateWallet()
    this.address = this.wallet.address

    if (this.heartbeatInterval > 0) this.startHeartbeat()
    if (this.authTimeout > 0) this.startAuthTimeout()
    if (this.clientTimeoutInterval > 0) this.startClientTimeout()
  }

  //
  // Server lifecycle
  //
  listen(cb) {
    if (this.key && this.cert) {
      this._server = https.createServer({
        key: fs.readFileSync(this.key),
        cert: fs.readFileSync(this.cert)
      })
      log('TLS enabled (wss://)')
    } else {
      this._server = http.createServer()
      log('TLS disabled (ws://)')
    }

    this._wss = new WebSocketServer({ noServer: true })
    this._server.on('connection', this.onConnection.bind(this))
    this._server.on('upgrade', this.onUpgrade.bind(this))
    this._server.listen(this.port, cb)
  }

  close() {
    clearInterval(this._heartbeatInterval)
    clearInterval(this._authTimeoutInterval)
    clearInterval(this._clientTimeoutInterval)
    this._wss.close()
    this._clients.clear()
    this._pendingSockets.clear()
    this._pendingAuth.clear()
    this._events.emit('close')
  }

  onConnection(socket) {
    const ts = Date.now()
    this._pendingSockets.set(socket, ts)

    setTimeout(() => {
      if (this._pendingSockets.has(socket)) {
        log('Raw socket timeout, closing')
        socket.write('HTTP/1.1 408 Request Timeout\r\n\r\n')
        socket.destroy()
        this._pendingSockets.delete(socket)
      }
    }, this.authTimeout)
  }

  onUpgrade(req, socket, head) {
    if (req.headers['upgrade'] !== 'websocket') {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
      socket.destroy()
      return
    }

    this._pendingSockets.delete(socket)

    this._wss.handleUpgrade(req, socket, head, ws => {
      const ts = Date.now()
      this._pendingAuth.set(ws, ts)

      ws.on('message', this.onPreAuthMessage.bind(this, ws))
      ws.on('close', this.onClose.bind(this, ws))

      log('WS upgraded, awaiting authentication')
    })
  }

  //
  // Server processes
  //
  startHeartbeat() {
    clearInterval(this._heartbeatInterval)
    this._heartbeatInterval = setInterval(() => {
      for (const client of this._clients) {
        client.send({ type: 'heartbeat', ts: Date.now() })
      }
    }, this.heartbeatInterval)
  }

  startAuthTimeout() {
    clearInterval(this._authTimeoutInterval)
    this._authTimeoutInterval = setInterval(() => {
      const now = Date.now()
      for (const [ws, ts] of this._pendingAuth) {
        if (now - ts >= this.authTimeout) {
          log('Authentication timeout, closing socket')
          ws.send('HTTP/1.1 408 Request Timeout\r\n\r\n')
          ws.close()
          this._pendingAuth.delete(ws)
        }
      }
    }, this.authCheckInterval)
  }

  startClientTimeout() {
    clearInterval(this._clientTimeoutInterval)
    this._clientTimeoutInterval = setInterval(() => {
      const now = Date.now()
      for (const client of this._clients) {
        if (now - client.lastActive > this.clientTimeout) {
          log('Client timeout:', client.id)
          client._ws.send('HTTP/1.1 408 Request Timeout\r\n\r\n')
          client._ws.close()
        }
      }
    }, this.clientTimeoutInterval)
  }

  //
  // Events
  //
  on(event, handler) {
    this._events.on(event, handler)
  }

  onClose(client) {
    this._clients.delete(client)
    this._events.emit('disconnected', client)
    log('Client disconnected:', client.id)
  }

  onPreAuthMessage(ws, data) {
    let msg
    try {
      msg = JSON.parse(data)
    } catch (err) {
      ws.close()
      this._pendingAuth.delete(ws)
      this._events.emit('error', err)
      return
    }

    if (msg.type !== 'authenticate') {
      log('Expected authenticate message, got:', msg.type)
      ws.close()
      this._pendingAuth.delete(ws)
      this._events.emit('error', new Error('Invalid message before authentication'))
      return
    }

    // If whitelist exists, check if the address is in it
    if (this.whitelist && !this.whitelist.has(msg.address)) {
      log('Address not in whitelist')
      ws.send('HTTP/1.1 403 Forbidden\r\n\r\n')
      ws.close()
      this._pendingAuth.delete(ws)
      this._events.emit('error', new Error('Address not in whitelist'))
      return
    }

    const now = Date.now()
    const delta = Math.abs(now - msg.timestamp)
    if (delta >= this.authTimeout) {
      log('Authentication timestamp out of range')
      ws.send('HTTP/1.1 401 Unauthorized\r\n\r\n')
      ws.close()
      this._pendingAuth.delete(ws)
      this._events.emit('error', new Error('Authentication timeout'))
      return
    }

    const valid = WalletUtils.verifySignatureAddress(
      String(msg.timestamp),
      msg.signature,
      msg.address
    )

    if (!valid) {
      log('Invalid authentication signature')
      ws.send('HTTP/1.1 401 Unauthorized\r\n\r\n')
      ws.close()
      this._pendingAuth.delete(ws)
      this._events.emit('error', new Error('Invalid signature'))
      return
    }

    // Authenticated: promote to full client
    const client = new ConnectedClient(ws)
    client.address = msg.address
    this._pendingAuth.delete(ws)
    this._clients.add(client)

    ws.removeAllListeners('message')
    ws.on('message', data => this.onMessage(client, data))
    ws.on('close', () => this.onClose(client))

    this._sendAuthResponse(client)
    this._events.emit('authenticated', client)
    log('Client authenticated:', client.address)
  }

  onMessage(client, data) {
    try {
      const msg = JSON.parse(data)

      // Update activity timestamp
      client.updateActivity()

      // If heartbeat, do nothing
      if (msg.type === 'heartbeat') {
        log('Heartbeat:', client.address, msg)
        this._events.emit('heartbeat', client, msg)
        return
      }

      // Propagate message to listeners
      this._events.emit('message', client, msg)
    } catch (err) {
      this._events.emit('error', err)
    }
  }

  //
  // Internal methods
  //
  _sendAuthResponse(client) {
    const timestamp = Date.now()
    const signature = WalletUtils.generateSignature(this.wallet.privateKey, String(timestamp))

    client.send({
      type: 'authenticate',
      address: this.address,
      timestamp,
      signature
    })

    log('Sent auth response to:', client.address)
  }

  //
  // External methods
  //
  clients() {
    return Array.from(this._clients)
  }

  client(id) {
    return this._clients.get(id)
  }
}
