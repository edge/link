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
    port = 3793,                      // Port to bind the HTTP/TLS server to
    key = null,                       // Path to TLS key
    cert = null,                      // Path to TLS cert
    authTimeout = 5000,               // Max time (ms) to wait for authentication
    authCheckInterval = 1000,         // Interval (ms) to sweep unauthenticated sockets
    heartbeatInterval = 1000,         // Interval (ms) between server-to-client pings
    clientTimeout = 5000,             // Inactivity timeout (ms) for authenticated clients
    clientTimeoutInterval = 1000,     // Interval (ms) to check for idle clients
    replaceExisting = true,           // Replace existing client on new connection with same address
    wallet = null,                    // XE wallet object (generated if not provided)
    privateKey = null,                // Optional hex string; overrides `wallet`
    whitelist = null,                 // Optional array of whitelisted addresses
    onAuthenticate = null             // Optional custom authentication function
  } = {}) {
    this._events = new EventEmitter()
    this._clients = new Map()          // address -> ConnectedClient
    this._pendingSockets = new Map()   // socket -> timestamp
    this._pendingAuth = new Map()      // ws -> timestamp

    this.key = key
    this.cert = cert
    this.port = port
    this.authTimeout = authTimeout
    this.authCheckInterval = authCheckInterval
    this.heartbeatInterval = heartbeatInterval
    this.clientTimeout = clientTimeout
    this.clientTimeoutInterval = clientTimeoutInterval
    this.whitelist = whitelist ? new Set(whitelist) : null
    this.replaceExisting = replaceExisting
    this.onAuthenticate = onAuthenticate

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

  //
  // Server processes
  //
  startHeartbeat() {
    clearInterval(this._heartbeatInterval)
    this._heartbeatInterval = setInterval(() => {
      for (const client of this._clients.values()) {
        client._ws.ping()
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
      for (const client of this._clients.values()) {
        if (now - client.lastActive > this.clientTimeout) {
          log(`Client timeout ${client.address} (${client.id})`)
          client.send('HTTP/1.1 408 Request Timeout\r\n\r\n')
          client.close()
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

  onConnection(socket) {
    log('New raw socket connection')

    const ts = Date.now()
    const id = this._getSocketId(socket)
    this._pendingSockets.set(id, ts)

    socket.setKeepAlive(true)

    setTimeout(() => {
      if (this._pendingSockets.has(id)) {
        log('Raw socket timeout, closing')
        socket.write('HTTP/1.1 408 Request Timeout\r\n\r\n')
        socket.destroy()
        this._pendingSockets.delete(id)
      }
    }, this.authTimeout)
  }

  onUpgrade(req, socket, head) {
    if (req.headers['upgrade'] !== 'websocket') {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
      socket.destroy()
      return
    }

    const id = this._getSocketId(socket)
    this._pendingSockets.delete(id)

    this._wss.handleUpgrade(req, socket, head, ws => {
      const ts = Date.now()
      this._pendingAuth.set(ws, ts)

      ws.on('message', this.onPreAuthMessage.bind(this, ws))
      ws.on('close', this.onPreAuthClose.bind(this, ws))

      log('WS upgraded, awaiting authentication')
    })
  }

  onPreAuthClose(ws) {
    log('Pre-auth socket closed')
    this._pendingAuth.delete(ws)
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

    // If a custom auth function has been provided, call it
    if (this.onAuthenticate && !this.onAuthenticate(msg.address)) {
      log('Address failed custom authentication')
      ws.send('HTTP/1.1 403 Forbidden\r\n\r\n')
      ws.close()
      this._pendingAuth.delete(ws)
      this._events.emit('error', new Error('Authentication failed'))
      return
    }

    // Ensure timestamp is within range
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

    // Verify signature
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

    const existingClient = this._clients.get(msg.address)
    if (existingClient) {
      // If replaceExisting is false, reject the new connection
      if (!this.replaceExisting) {
        log(`Rejecting new connection for ${msg.address} (${existingClient.id})`)
        ws.send('HTTP/1.1 409 Conflict\r\n\r\n')
        ws.close()
        this._pendingAuth.delete(ws)
        this._events.emit('error', new Error('Client already exists'))
        return
      }
      // Otherwise, disconnect the existing client
      log(`Removing existing client ${msg.address} (${existingClient.id})`)
      existingClient.send('HTTP/1.1 409 Conflict\r\n\r\n')
      existingClient.close()
      this._clients.delete(msg.address)
      this._events.emit('error', new Error(`Client replaced ${msg.address} (${existingClient.id})`))
    }

    // Authenticated -> promote to full client
    const client = new ConnectedClient(ws, msg.address)
    this._pendingAuth.delete(ws)
    this._clients.set(msg.address, client)

    // Remove pre-auth listeners and add new ones
    ws.removeAllListeners('message')
    ws.removeAllListeners('close')
    ws.on('message', data => this.onMessage(client, data))
    ws.on('close', () => this.onClose(client))
    ws.on('pong', () => this.onPong(client))

    this._sendAuthResponse(client)
    this._events.emit('authenticated', client)
    log(`Client authenticated ${client.address} (${client.id})`)
  }

  onClose(client) {
    const currentClient = this._clients.get(client.address)
    if (currentClient?.id === client.id) this._clients.delete(client.address)
    this._events.emit('disconnected', client)
    log(`Client disconnected ${client.address} (${client.id})`)
  }

  onPong(client) {
    log(`Pong received from ${client.address} (${client.id})`)
    client.updateActivity()
  }

  onMessage(client, data) {
    try {
      const msg = JSON.parse(data)

      // Update activity timestamp
      client.updateActivity()

      // If heartbeat, do nothing
      if (msg.type === 'heartbeat') {
        log(`Heartbeat ${client.address} (${client.id})`)
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
  _getSocketId(socket) {
    return `${socket.remoteAddress}:${socket.remotePort}`
  }

  _sendAuthResponse(client) {
    const timestamp = Date.now()
    const signature = WalletUtils.generateSignature(this.wallet.privateKey, String(timestamp))

    client.send({
      type: 'authenticate',
      address: this.address,
      timestamp,
      signature
    })

    log(`Sent auth response to ${client.address} (${client.id})`)
  }

  //
  // External methods
  //
  clients() {
    return Array.from(this._clients.values())
  }

  client(address) {
    return this._clients.get(address)
  }

  broadcast(message) {
    for (const client of this._clients.values()) {
      client.send(message)
    }
  }

  send(address, message) {
    const client = this._clients.get(address)
    if (!client) {
      this._events.emit('error', new Error(`Client ${address} not found`))
      return
    }
    client.send(message)
  }
}
