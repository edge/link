// Copyright (C) 2025 Edge Network Technologies Limited
// Use of this source code is governed by a GNU GPL-style license
// that can be found in the LICENSE.md file. All rights reserved.

import { v4 as uuid } from 'uuid'
import { EventEmitter } from 'events'

export class ConnectedClient {
  constructor(ws, address) {
    this._ws = ws
    this._events = new EventEmitter()
    this.id = uuid()
    this.address = address
    this.lastActive = Date.now()
    this.authenticationData = null
  }

  send(msg) {
    this._ws.send(JSON.stringify(msg))
  }

  close() {
    this._ws.close()
  }

  updateActivity() {
    this.lastActive = Date.now()
  }
}