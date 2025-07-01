// Copyright (C) 2025 Edge Network Technologies Limited
// Use of this source code is governed by a GNU GPL-style license
// that can be found in the LICENSE.md file. All rights reserved.

import { WalletUtils } from '@edge/utils'
import { EventEmitter } from 'events'
import WebSocket from 'ws'
import debug from 'debug'

const log = debug('link:client')
const logSocket = debug('link:client:socket')
const logMsg = debug('link:client:msg')

export class Client {
  constructor({
    host = 'localhost',
    port = 3793,
    tls = false,
    wallet = null,
    maxReconnectAttempts = 5,
    reconnectDelay = 1000,
  } = {}) {
    this._ws = null
    this._events = new EventEmitter()

    this._shouldReconnect = true
    this._reconnectAttempts = 0
    this._maxReconnectAttempts = maxReconnectAttempts
    this._reconnectDelay = reconnectDelay

    this.server = { host, port, address: null, tls, authenticated: false }
    this.wallet = wallet || WalletUtils.generateWallet()
    this.address = this.wallet.address
  }

  //
  // Lifecycle
  //
  connect(server = {}) {
    // Allow overriding the server config
    this.server.host = server.host || this.server.host
    this.server.port = server.port || this.server.port
    this.server.tls = server.tls || this.server.tls

    const protocol = this.server.tls ? 'wss' : 'ws'
    const url = `${protocol}://${this.server.host}:${this.server.port}`

    logSocket(`Connecting to ${url}`)
    this._ws = new WebSocket(url)
    this._ws.on('open', () => this.onOpen())
    this._ws.on('message', data => this.onMessage(data))
    this._ws.on('close', () => this.onClose())
    this._ws.on('error', err => this.onError(err))
    this._ws.on('ping', () => this.onPing())
  }

  disconnect() {
    log('Client disconnected by user')
    this._shouldReconnect = false
    if (this._ws) this._ws.close()
  }

  send(msg) {
    if (this.connected) {
      log('Sending message:', msg)
      this._ws.send(JSON.stringify(msg))
    }
  }

  //
  // Properties
  //
  get connected() {
    return this._ws && this._ws.readyState === WebSocket.OPEN
  }

  get authenticated() {
    return this.server.authenticated
  }

  //
  // Events
  //
  on(event, handler) {
    this._events.on(event, handler)
  }

  onOpen() {
    log('Connected to server')
    this._reconnectAttempts = 0

    const timestamp = Date.now()
    const signature = WalletUtils.generateSignature(this.wallet.privateKey, String(timestamp))

    this.send({
      type: 'authenticate',
      address: this.address,
      timestamp,
      signature
    })

    this._events.emit('connected')
  }

  onMessage(data) {
    let msg
    try { msg = JSON.parse(data) } catch { msg = String(data) }
    logMsg('Received message:', msg)

    if (msg?.type === 'authenticate') {
      this.onAuthenticate(msg)
    } else if (msg?.type === 'heartbeat') {
      this.onHeartbeat(msg)
    } else {
      this._events.emit('message', msg)
    }
  }

  onPing() {
    log('Ping received')
    // no need to manually pong
  }

  onClose() {
    log('Connection closed')
    this._events.emit('disconnected')

    if (this._shouldReconnect && this._reconnectAttempts < this._maxReconnectAttempts) {
      this._reconnectAttempts++
      const delay = this._reconnectDelay * this._reconnectAttempts
      log(`Reconnecting in ${delay}ms...`)
      this._events.emit('reconnecting', this._reconnectAttempts, delay)

      setTimeout(() => this.connect(), delay)
    } else if (this._shouldReconnect) {
      log('Max reconnect attempts reached, giving up.')
      this._events.emit('error', new Error('Max reconnect attempts reached'))
    }
  }

  onError(err) {
    log('Connection error:', err.message)
    this._events.emit('error', err)
  }

  //
  // Server responses
  //
  onAuthenticate(msg) {
    log('Received authentication response:', msg)

    const verified = WalletUtils.verifySignatureAddress(
      String(msg.timestamp),
      msg.signature,
      msg.address
    )

    if (!verified) {
      log('Invalid server signature')
      this._events.emit('error', new Error('Invalid server signature'))
      this.disconnect() // Close connection but don't try to reconnect
      return
    }

    log('Server verified:', msg.address)
    this.server.address = msg.address
    this.server.authenticated = true
    this._events.emit('authenticated', msg.address)
  }

  onHeartbeat(msg) {
    log('Heartbeat from server:', msg)
    this.send({ type: 'heartbeat', ts: Date.now() })
    this._events.emit('heartbeat', msg)
  }
}
