// Copyright (C) 2025 Edge Network Technologies Limited
// Use of this source code is governed by a GNU GPL-style license
// that can be found in the LICENSE.md file. All rights reserved.

//
// Simple Server example
//

import { Server } from '@edge/link'
import debug from 'debug'

const log = debug('app:server')

const server = new Server({
  port: 3793,                    // Default port
  wallet: null,                  // If null, generate a new wallet
  authTimeout: 5000,             // Time to wait for authentication
  heartbeatInterval: 1000,       // Time between heartbeats
  clientTimeout: 30000,          // Time before disconnecting inactive clients
  clientTimeoutInterval: 1000    // Time between client timeout checks
})

server.on('connected', client => {
  log('Client connected:', client.address)
  client.send({ type: 'welcome', msg: `Hello ${client.address}` })
})

server.on('authenticated', client => {
  log('Client authenticated:', client.address)
})

server.on('message', (client, message) => {
  log('Message from', client.address, message)
})

server.on('disconnected', client => {
  log('Client disconnected:', client.address)
})

server.on('error', err => {
  log('Server error:', err.message)
})

server.listen(() => {
  log('Server listening')
  log('├ port:', server.port)
  log('└ address:', server.address)
})