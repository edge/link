<img src='https://cdn.edge.network/assets/img/edge-logo-green.svg' width='200'>

# Link

> Cryptographically secure, trust minimised WebSocket link layer for the Edge network.

Edge Link (`@edge/link`) is a cryptographically authenticated session layer for secure peer-to-peer coordination. It establishes a thin, trust-minimised relay layer over raw or TLS WebSockets, ensuring identity, integrity, and session continuity. Designed for distributed systems with strong cryptographic guarantees, it forms the connective substrate for blockchain-adjacent applications that require lightweight, verifiable communication.

## Key Features

Link is designed to be simple to use and understand, with a focus on security and ease of use.

* **Designed for humans**<br>
  Small surface area, zero config defaults, and a dev experience that gets out of your way.
* **Cryptographic authentication**<br>
  Peers use XE wallets to establish identity and session integrity with no shared secrets or passwords.
* **Plug-and-play wallet identity**<br>
  Bring your own XE wallet or generate one on the fly — identity is first-class and seamless.
* **Instant secure server**<br>
  Launch a cryptographically-authenticated WebSocket server in under 10 lines — no boilerplate, no fuss.
* **Protocol minimalism**<br>
  Only two handshake messages are required to establish mutual trust; everything after is just JSON.

### Additional Features

It also includes many additional features, such as:

* **Heartbeat & liveness**<br>
  Automatic ping/pong exchange ensures active connections and gives you real-time latency feedback.
* **Auto‑reconnect**<br>
  Exponential back-off and capped retries provide graceful recovery from network hiccups.
* **Timeout guards**<br>
  Unauthenticated sockets and stale clients are actively removed, keeping your server lean and clean.
* **TLS optional**<br>
  Add a cert and key, and you instantly upgrade to encrypted `wss://` with no config gymnastics required.

> More features will be added in the future.

## Usage

```bash
npm install @edge/link
```

> **Node ≥ 20** recommended.

### 1 · Spin up a server

```js
import { Server } from '@edge/link'

const server = new Server({ port: 3793 })

server.on('authenticated', c => console.log('✅  client', c.address))
server.on('message', (c, msg) => console.log('⬅️  ', c.address, msg))
server.listen(() => console.log('Server listening on', server.port))
```

### 2 · Connect a client

```js
import { Client } from '@edge/link'

const client = new Client()

client.on('authenticated', addr => {
  console.log('We are', client.address, '↔', addr)
  client.send({ type: 'hello', msg: 'Hi from ' + client.address })
})

client.connect()
```

Full working demos live in **`examples/simple‑server`** and **`examples/simple‑client`**.

Perfect. Here's the complete, accurate **Methods** section added to the API reference for both `Server` and `Client`:

## API Reference

### `new Server(options)`

Creates a new authenticated Link server.

#### Options

| Name                    | Type   | Default | Description                                       |
| ----------------------- | ------ | ------- | ------------------------------------------------- |
| `port`                  | number | `3793`  | Port to bind the HTTP/TLS server to               |
| `authTimeout`           | number | `5000`  | Max time (ms) to wait for authentication          |
| `authCheckInterval`     | number | `1000`  | Interval (ms) to sweep unauthenticated sockets    |
| `heartbeatInterval`     | number | `1000`  | Interval (ms) between server-to-client pings      |
| `clientTimeout`         | number | `5000`  | Inactivity timeout (ms) for authenticated clients |
| `clientTimeoutInterval` | number | `1000`  | Interval (ms) to check for idle clients           |
| `wallet`                | object | `null`  | Optional XE wallet object                         |
| `privateKey`            | string | `null`  | Optional hex string; overrides `wallet`           |
| `key`                   | string | `null`  | Optional path to TLS key for `wss://`             |
| `cert`                  | string | `null`  | Optional path to TLS cert for `wss://`            |

#### Events

* `connected(client)`
* `authenticated(client)`
* `message(client, message)`
* `heartbeat(client, data)`
* `disconnected(client)`
* `error(error)`
* `close()`

#### Methods

* `server.listen(cb)` – Starts listening on the configured port. Accepts optional callback.
* `server.close()` – Shuts down the server and clears internal timers.
* `client.send(msg)` – Send a JSON-serializable object to this client (inside `server.on('message')` or `server.on('authenticated')`).

<br>

### `new Client(options)`

Creates a new authenticated Link client.

#### Options

| Name                   | Type    | Default       | Description                                 |
| ---------------------- | ------- | ------------- | ------------------------------------------- |
| `host`                 | string  | `'localhost'` | Server hostname                             |
| `port`                 | number  | `3793`        | Server port                                 |
| `tls`                  | boolean | `false`       | Use TLS (`wss://`) instead of raw (`ws://`) |
| `wallet`               | object  | `null`        | Optional XE wallet (auto-generated if null) |
| `maxReconnectAttempts` | number  | `5`           | Max auto-reconnect attempts                 |
| `reconnectDelay`       | number  | `1000`        | Base delay (ms) between reconnects          |

#### Events

* `connected()`
* `authenticated(serverAddress)`
* `message(message)`
* `heartbeat(data)`
* `disconnected()`
* `reconnecting(attempt, delay)`
* `error(error)`

#### Methods

* `client.connect()` – Opens the connection and begins the authentication handshake.
* `client.disconnect()` – Gracefully closes the connection without triggering reconnect.
* `client.send(msg)` – Sends a JSON-serializable object to the connected server. `msg` must be an object

> Message format is subject to change in future versions. Future versions may support raw frames.
> Currently messages should be objects with a `type` field.
> Reserved message types: `authenticate`, `heartbeat`, `disconnect`, `error`.

## Contributing

Interested in contributing to the project? Amazing! Before you do, please have a quick look at our [Contributor Guidelines](CONTRIBUTING.md) where we've got a few tips to help you get started.

## License

Edge is the infrastructure of Web3. A peer-to-peer network and blockchain providing high performance decentralised web services, powered by the spare capacity all around us.

Copyright notice
(C) 2021 Edge Network Technologies Limited <support@edge.network><br />
All rights reserved

This product is part of Edge.
Edge is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version ("the GPL").

**If you wish to use Edge outside the scope of the GPL, please contact us at licensing@edge.network for details of alternative license arrangements.**

**This product may be distributed alongside other components available under different licenses (which may not be GPL). See those components themselves, or the documentation accompanying them, to determine what licenses are applicable.**

Edge is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

The GNU General Public License (GPL) is available at: https://www.gnu.org/licenses/gpl-3.0.en.html<br />
A copy can be found in the file GPL.md distributed with
these files.

This copyright notice MUST APPEAR in all copies of the product!