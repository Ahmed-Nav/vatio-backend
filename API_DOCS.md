# Vatio IoT — API Documentation

> **Base URL:** `http://localhost:3000/api/v1`
> **Swagger UI:** `http://localhost:3000/api/docs`
> **Authentication:** Bearer JWT (all endpoints except `POST /auth/login`)

---

## Table of Contents

- [Authentication](#authentication)
  - [POST /auth/login](#post-authlogin)
  - [POST /auth/refresh](#post-authrefresh)
- [Devices](#devices)
  - [POST /devices](#post-devices)
  - [GET /devices](#get-devices)
  - [GET /devices/:id](#get-devicesid)
  - [PATCH /devices/:id](#patch-devicesid)
  - [DELETE /devices/:id](#delete-devicesid)
- [Analytics](#analytics)
  - [GET /analytics/history](#get-analyticshistory)
- [Alerts](#alerts)
  - [GET /alerts](#get-alerts)
- [WebSocket — Telemetry](#websocket--telemetry)
- [Error Handling](#error-handling)
- [Data Models](#data-models)

---

## Authentication

All API endpoints (except login) require a valid JWT token in the `Authorization` header:

```
Authorization: Bearer <token>
```

Tokens are signed with HS256, expire after **2 hours**, and contain `userId`, `email`, and `role`.

---

### POST /auth/login

Authenticate a user and receive a JWT token.

**Authentication:** None (public endpoint)

**Request Body:**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `email` | `string` | ✅ | Must be valid email format |
| `password` | `string` | ✅ | Minimum 6 characters |

**Example Request:**

```json
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "admin@vatio.com",
  "password": "admin@123"
}
```

**Success Response (200):**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresAt": "2026-03-07T22:00:00.000Z"
}
```

**Error Responses:**

| Status | Code | When |
|--------|------|------|
| 401 | `UNAUTHORIZED` | Invalid email or password |
| 400 | `BAD_REQUEST` | Missing or invalid fields |

---

### POST /auth/refresh

Issue a new JWT token using the current valid token.

**Authentication:** Required (Bearer token)

**Request Body:** None

**Example Request:**

```
POST /api/v1/auth/refresh
Authorization: Bearer <current_token>
```

**Success Response (200):**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresAt": "2026-03-07T24:00:00.000Z"
}
```

**Error Responses:**

| Status | Code | When |
|--------|------|------|
| 401 | `UNAUTHORIZED` | Missing, expired, or invalid token |

---

## Devices

### POST /devices

Register a new IoT device for the authenticated user.

**Authentication:** Required

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | ✅ | Unique device ID (e.g., `DEV-003`) |
| `name` | `string` | ✅ | Human-readable device name |
| `location` | `string` | ❌ | Physical location of the device |

**Example Request:**

```json
POST /api/v1/devices
Authorization: Bearer <token>
Content-Type: application/json

{
  "id": "DEV-003",
  "name": "Solar Panel Array C",
  "location": "Rooftop C"
}
```

**Success Response (201):**

```json
{
  "id": "DEV-003",
  "name": "Solar Panel Array C",
  "location": "Rooftop C",
  "type": null,
  "status": "active",
  "hwVersion": null,
  "fwVersion": null,
  "lastSeen": null,
  "ownerId": "a1b2c3d4-...",
  "createdAt": "2026-03-07T16:00:00.000Z"
}
```

**Error Responses:**

| Status | Code | When |
|--------|------|------|
| 409 | `CONFLICT` | Device ID already registered |
| 400 | `BAD_REQUEST` | Missing required fields |

---

### GET /devices

Get all devices owned by the authenticated user.

**Authentication:** Required

**Example Request:**

```
GET /api/v1/devices
Authorization: Bearer <token>
```

**Success Response (200):**

```json
[
  {
    "id": "DEV-001",
    "name": "Solar Panel Array A",
    "location": "Rooftop A",
    "type": "solar",
    "status": "active",
    "hwVersion": null,
    "fwVersion": null,
    "lastSeen": null,
    "ownerId": "a1b2c3d4-...",
    "createdAt": "2026-03-07T12:00:00.000Z"
  },
  {
    "id": "DEV-002",
    "name": "Solar Panel Array B",
    "location": "Rooftop B",
    "type": "solar",
    "status": "active",
    "hwVersion": null,
    "fwVersion": null,
    "lastSeen": null,
    "ownerId": "a1b2c3d4-...",
    "createdAt": "2026-03-07T12:00:00.000Z"
  }
]
```

---

### GET /devices/:id

Get full metadata for a specific device. Returns 404 if not found or not owned by the user.

**Authentication:** Required

**URL Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Device ID (e.g., `DEV-001`) |

**Example Request:**

```
GET /api/v1/devices/DEV-001
Authorization: Bearer <token>
```

**Success Response (200):**

```json
{
  "id": "DEV-001",
  "name": "Solar Panel Array A",
  "location": "Rooftop A",
  "type": "solar",
  "status": "active",
  "hwVersion": null,
  "fwVersion": null,
  "lastSeen": null,
  "ownerId": "a1b2c3d4-...",
  "createdAt": "2026-03-07T12:00:00.000Z"
}
```

**Error Responses:**

| Status | Code | When |
|--------|------|------|
| 404 | `DEVICE_NOT_FOUND` | Device doesn't exist or not owned by user |

---

### PATCH /devices/:id

Update device metadata. Idempotent — calling twice with the same body produces the same result.

**Authentication:** Required

**URL Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Device ID to update |

**Request Body (all fields optional):**

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Updated device name |
| `location` | `string` | Updated location |
| `status` | `string` | Updated status (e.g., `active`, `inactive`, `maintenance`) |

**Example Request:**

```json
PATCH /api/v1/devices/DEV-001
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Solar Panel Array A (Updated)",
  "status": "maintenance"
}
```

**Success Response (200):**

```json
{
  "id": "DEV-001",
  "name": "Solar Panel Array A (Updated)",
  "location": "Rooftop A",
  "type": "solar",
  "status": "maintenance",
  "hwVersion": null,
  "fwVersion": null,
  "lastSeen": null,
  "ownerId": "a1b2c3d4-...",
  "createdAt": "2026-03-07T12:00:00.000Z"
}
```

**Error Responses:**

| Status | Code | When |
|--------|------|------|
| 404 | `DEVICE_NOT_FOUND` | Device doesn't exist or not owned by user |

---

### DELETE /devices/:id

Unregister a device. Permanently deletes the device record.

**Authentication:** Required

**URL Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Device ID to delete |

**Example Request:**

```
DELETE /api/v1/devices/DEV-003
Authorization: Bearer <token>
```

**Success Response (200):** Returns the deleted device object.

**Error Responses:**

| Status | Code | When |
|--------|------|------|
| 404 | `NOT_FOUND` | Device not found or unauthorized |

---

## Analytics

### GET /analytics/history

Query historical telemetry data for a device. Uses TimescaleDB `time_bucket()` for interval bucketing when available, falls back to standard query otherwise.

**Authentication:** Required

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `deviceId` | `string` | ✅ | Device ID to query |
| `start` | `ISO 8601 date` | ✅ | Start of time range (e.g., `2026-03-01T00:00:00.000Z`) |
| `end` | `ISO 8601 date` | ✅ | End of time range |
| `interval` | `enum` | ❌ | Bucket interval: `1m`, `5m`, `1h`. Default: `5m` |

**Example Request:**

```
GET /api/v1/analytics/history?deviceId=DEV-001&start=2026-03-07T00:00:00.000Z&end=2026-03-07T23:59:59.000Z&interval=1h
Authorization: Bearer <token>
```

**Success Response (200):**

```json
[
  {
    "timestamp": "2026-03-07T10:00:00.000Z",
    "data": {
      "avg": { "voltage": 230.5, "current": 12.3, "power": 2835.15 },
      "min": { "voltage": 228.1, "current": 11.8, "power": 2691.58 },
      "max": { "voltage": 233.2, "current": 13.1, "power": 3054.92 }
    }
  },
  {
    "timestamp": "2026-03-07T11:00:00.000Z",
    "data": {
      "avg": { "voltage": 231.0, "current": 12.5, "power": 2887.50 },
      "min": { "voltage": 229.0, "current": 12.0, "power": 2748.00 },
      "max": { "voltage": 234.0, "current": 13.5, "power": 3159.00 }
    }
  }
]
```

---

## Alerts

### GET /alerts

Get all active (unacknowledged) alerts for the authenticated user's devices.

**Authentication:** Required

**Example Request:**

```
GET /api/v1/alerts
Authorization: Bearer <token>
```

**Success Response (200):**

```json
[
  {
    "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "deviceId": "DEV-001",
    "type": "over_voltage",
    "severity": "warning",
    "message": "Voltage exceeded 250V threshold on DEV-001",
    "acknowledged": false,
    "createdAt": "2026-03-07T14:30:00.000Z"
  }
]
```

> **Note:** Returns an empty array `[]` if no active alerts exist.

---

## WebSocket — Telemetry

Real-time telemetry data is streamed over Socket.IO on the `/telemetry` namespace.

### Connection

**URL:** `wss://<host>/telemetry`

**Authentication:** JWT token provided via one of these methods:
1. **Auth object:** `{ auth: { token: '<jwt>' } }` (recommended)
2. **Authorization header:** `Authorization: Bearer <jwt>`
3. **Query parameter:** `?token=<jwt>`

**Example (Socket.IO client):**

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000/telemetry', {
  auth: { token: '<your_jwt_token>' },
});
```

Unauthenticated connections are **immediately disconnected**.

### Joining a Device Room

To receive telemetry for a specific device, emit `joinDevice` with the device ID:

```javascript
socket.emit('joinDevice', 'DEV-001');
```

### Receiving Telemetry Updates

Listen for `telemetry_update` events (emitted every 5 seconds per active device):

```javascript
socket.on('telemetry_update', (data) => {
  console.log(data);
});
```

**Payload shape:**

```json
{
  "deviceId": "DEV-001",
  "timestamp": 1741363200000,
  "metrics": {
    "avg": { "voltage": 230.5, "current": 12.3, "power": 2835.15 },
    "min": { "voltage": 228.1, "current": 11.8, "power": 2691.58 },
    "max": { "voltage": 233.2, "current": 13.1, "power": 3054.92 }
  }
}
```

### Events Reference

| Event | Direction | Description |
|-------|-----------|-------------|
| `joinDevice` | Client → Server | Join a device-specific room to filter updates |
| `telemetry_update` | Server → Client | Aggregated metrics emitted every 5 seconds |

---

## Error Handling

All API errors return a **standard error envelope**:

```json
{
  "code": "ERROR_CODE",
  "message": "Human-readable description",
  "timestamp": "2026-03-07T14:30:00.000Z"
}
```

### Error Codes

| HTTP Status | Code | Description |
|-------------|------|-------------|
| 400 | `BAD_REQUEST` | Invalid request body or parameters |
| 401 | `UNAUTHORIZED` | Missing, expired, or invalid JWT token |
| 403 | `FORBIDDEN` | Insufficient permissions |
| 404 | `NOT_FOUND` | Resource not found |
| 404 | `DEVICE_NOT_FOUND` | Specific device not found or not owned |
| 409 | `CONFLICT` | Resource already exists (e.g., duplicate device ID) |
| 422 | `UNPROCESSABLE_ENTITY` | Validation error |
| 429 | `TOO_MANY_REQUESTS` | Rate limit exceeded |
| 500 | `INTERNAL_ERROR` | Unexpected server error |

---

## Data Models

### User

| Field | Type | Description |
|-------|------|-------------|
| `id` | `UUID` | Unique user identifier |
| `email` | `string` | Unique email address |
| `name` | `string?` | Optional display name |
| `password` | `string` | Bcrypt hashed password (never exposed in API) |
| `role` | `string` | User role (default: `"user"`) |
| `createdAt` | `DateTime` | Account creation timestamp |

### Device

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique device ID (e.g., `DEV-001`) |
| `name` | `string` | Human-readable name |
| `location` | `string?` | Physical location |
| `type` | `string?` | Device type (e.g., `solar`) |
| `status` | `string` | Device status (default: `"active"`) |
| `hwVersion` | `string?` | Hardware version |
| `fwVersion` | `string?` | Firmware version |
| `lastSeen` | `DateTime?` | Last telemetry timestamp |
| `ownerId` | `UUID` | FK to User |
| `createdAt` | `DateTime` | Registration timestamp |

### Telemetry

| Field | Type | Description |
|-------|------|-------------|
| `id` | `BigInt` | Auto-incrementing ID |
| `deviceId` | `string` | FK to Device |
| `timestamp` | `DateTime` | When the data was aggregated |
| `data` | `JSON` | Aggregated metrics (`{ avg, min, max }`) |

### Alert

| Field | Type | Description |
|-------|------|-------------|
| `id` | `UUID` | Unique alert identifier |
| `deviceId` | `string` | FK to Device |
| `type` | `string` | Alert type (e.g., `over_voltage`) |
| `severity` | `string` | Severity level (default: `"warning"`) |
| `message` | `string` | Human-readable alert message |
| `acknowledged` | `boolean` | Whether the alert has been acknowledged |
| `createdAt` | `DateTime` | When the alert was triggered |
