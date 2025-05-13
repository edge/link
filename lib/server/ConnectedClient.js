// Copyright (C) 2025 Edge Network Technologies Limited
// Use of this source code is governed by a GNU GPL-style license
// that can be found in the LICENSE.md file. All rights reserved.

import { v4 as uuid } from 'uuid'
import { EventEmitter } from 'events'
import debug from 'debug'

const log = debug('link:server:client')

export class ConnectedClient {
  constructor(ws) {
    this._ws = ws
    this._events = new EventEmitter()
    this.id = uuid()
    this.address = null
    this.lastActive = Date.now()
  }

  send(msg) {
    this._ws.send(JSON.stringify(msg))
  }

  updateActivity() {
    log('Client updated activity')
    this.lastActive = Date.now()
  }
}