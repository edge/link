// Copyright (C) 2025 Edge Network Technologies Limited
// Use of this source code is governed by a GNU GPL-style license
// that can be found in the LICENSE.md file. All rights reserved.

//
// Simple Client example
//

import { Client } from '@edge/link'

const client = new Client({
  wallet: null
})

client.on('connected', () => {
  console.log('Connected to server')
})

client.on('authenticated', () => {
  console.log('Authenticated with server')
  console.log('├ our address:', client.address)
  console.log('└ server address:', client.server.address)
  client.send({ type: 'hello', msg: `Hello from ${client.address}` })
})

client.on('message', message => {
  console.log('Received message:', message)
})

client.on('disconnected', () => {
  console.log('Disconnected from server')
})

client.on('reconnecting', (attempts, delay) => {
  console.log(`Reconnecting in ${delay}ms...`)
})

client.on('error', err => {
  console.log('Client error:', err.message || err)
})

client.connect({
  host: 'localhost',
  port: 3793
})