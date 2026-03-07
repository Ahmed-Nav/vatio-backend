# ⚡ Vatio IoT — Backend

> High-performance IoT telemetry platform built with NestJS, Fastify, Redis Streams, and PostgreSQL/TimescaleDB.

[![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?style=flat&logo=nestjs&logoColor=white)](https://nestjs.com/)
[![Fastify](https://img.shields.io/badge/Fastify-5-000000?style=flat&logo=fastify&logoColor=white)](https://fastify.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-336791?style=flat&logo=postgresql&logoColor=white)](https://neon.tech/)
[![Redis](https://img.shields.io/badge/Redis-Upstash-DC382D?style=flat&logo=redis&logoColor=white)](https://upstash.com/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4-010101?style=flat&logo=socket.io&logoColor=white)](https://socket.io/)

---

## Overview

Vatio IoT is a real-time IoT data platform designed for solar energy monitoring. It ingests telemetry data from IoT devices via MQTT, aggregates metrics in 5-second tumbling windows, and delivers real-time updates to connected clients over WebSocket.

### Architecture

```
IoT Devices → MQTT Broker → NestJS Ingestion → Redis Streams
                                                    ↓
                                          Aggregation Engine (5s windows)
                                                    ↓
                                        ┌───────────┴───────────┐
                                        ↓                       ↓
                                  WebSocket Gateway      PostgreSQL/TimescaleDB
                                  (real-time clients)    (historical storage)
```

### Key Capabilities

- **2,000 msg/s** target throughput via Redis Streams ingestion
- **5-second aggregation windows** with Avg/Min/Max per metric
- **Real-time WebSocket** telemetry on the `/telemetry` namespace
- **JWT authentication** with 2-hour stateless tokens
- **REST API** for device management, analytics, and alerts
- **TimescaleDB** hypertable support with automatic 7-day compression
- **Swagger/OpenAPI** docs at `/api/docs`

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Runtime** | Node.js with NestJS 11 |
| **HTTP Server** | Fastify 5 (not Express) |
| **Database** | PostgreSQL on Neon (with TimescaleDB support) |
| **ORM** | Prisma 7 with `@prisma/adapter-pg` |
| **Cache / Streams** | Redis (Upstash) via ioredis |
| **Message Broker** | Mosquitto MQTT |
| **Real-Time** | Socket.IO 4 via `@nestjs/websockets` |
| **Auth** | JWT (Passport.js + `@nestjs/jwt`) |
| **Queue** | BullMQ (Redis-backed) |
| **Docs** | Swagger / OpenAPI |

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **pnpm** (recommended) or npm
- **Mosquitto** MQTT broker (local or remote)
- **PostgreSQL** database (Neon or self-hosted)
- **Redis** server (Upstash or self-hosted)

### 1. Clone & Install

```bash
git clone <repository-url>
cd vatio-backend
pnpm install
```

### 2. Environment Setup

Create a `.env` file in the project root (see `.env.example` for reference):

```env
# Server
PORT=3000
ALLOWED_ORIGINS=http://localhost:5173

# JWT (min 32-character random string)
JWT_SECRET=your_jwt_secret_here

# Database (PostgreSQL connection string)
DATABASE_URL=postgresql://user:pass@host/dbname?sslmode=require

# MQTT
MQTT_URL=mqtt://localhost:1883

# Redis
REDIS_HOST=your-redis-host
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password
REDIS_TLS=true
```

> ⚠️ **Never commit `.env` to version control.** The `.gitignore` already excludes it.

### 3. Database Setup

```bash
# Generate Prisma client
npx prisma generate

# Push schema to database
npx prisma db push

# Seed with test data (1 user + 2 devices + TimescaleDB setup)
npx prisma db seed
```

### 4. Run

```bash
# Development (with hot-reload)
pnpm run start:dev

# Production
pnpm run build
pnpm run start:prod
```

The server starts at `http://localhost:3000`.

---

## API Documentation

Full API documentation is available at:

- **Swagger UI:** `http://localhost:3000/api/docs` (interactive)
- **Markdown:** [API_DOCS.md](./API_DOCS.md) (offline reference)

### Quick Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/v1/auth/login` | ❌ | Login → `{ token, expiresAt }` |
| `POST` | `/api/v1/auth/refresh` | ✅ | Refresh token |
| `GET` | `/api/v1/devices` | ✅ | List user's devices |
| `GET` | `/api/v1/devices/:id` | ✅ | Get device by ID |
| `POST` | `/api/v1/devices` | ✅ | Register new device |
| `PATCH` | `/api/v1/devices/:id` | ✅ | Update device metadata |
| `DELETE` | `/api/v1/devices/:id` | ✅ | Unregister device |
| `GET` | `/api/v1/analytics/history` | ✅ | Query historical telemetry |
| `GET` | `/api/v1/alerts` | ✅ | Get active alerts |
| `WS` | `/telemetry` | ✅ | Real-time telemetry stream |

---

## Project Structure

```
vatio-backend/
├── prisma/
│   ├── schema.prisma          # Database schema (User, Device, Telemetry, Alert)
│   └── seed.ts                # Test data + TimescaleDB setup
├── src/
│   ├── config/
│   │   └── redis.config.ts    # Redis connection config
│   ├── filters/
│   │   └── http-exception.filter.ts  # Global error envelope { code, message, timestamp }
│   ├── modules/
│   │   ├── alert/             # GET /alerts
│   │   ├── analytics/         # GET /analytics/history (time_bucket support)
│   │   ├── auth/              # JWT login, refresh, guards, @Public() decorator
│   │   ├── device/            # CRUD device endpoints
│   │   └── telemetry/         # MQTT ingestion, Redis Streams, aggregation, WebSocket
│   ├── prisma/
│   │   ├── prisma.module.ts
│   │   └── prisma.service.ts  # Prisma 7 with pg adapter
│   ├── app.module.ts          # Root module (global JWT guard, all imports)
│   └── main.ts                # Bootstrap (Fastify, CORS, Swagger, filters)
├── API_DOCS.md                # Complete API documentation
├── .env                       # Environment variables (not committed)
├── package.json
└── tsconfig.json
```

---

## Data Pipeline

### 1. Ingestion (T-02)

IoT devices publish telemetry via MQTT to `vatio/devices/{deviceId}/telemetry`. The `TelemetryController` captures each message and writes it to a Redis Stream:

```
Stream Key: vatio:stream:device:{deviceId}
MAXLEN: ~100,000 (approximate trimming)
```

### 2. Aggregation (T-03)

Every 5 seconds, the `AggregationService`:
1. Reads pending messages via `XREADGROUP` (consumer group: `vatio-aggregator`)
2. Computes **Avg/Min/Max** per metric key
3. ACKs processed messages
4. Persists the aggregated result to PostgreSQL
5. Emits `telemetry_update` to WebSocket clients

### 3. Storage (T-04)

Aggregated telemetry is stored in the `Telemetry` table with JSONB `data` column. When TimescaleDB is available, the table is converted to a **hypertable** partitioned by `timestamp` with automatic compression after 7 days.

### 4. Delivery (T-07)

Connected WebSocket clients on the `/telemetry` namespace receive `telemetry_update` events every 5 seconds with the latest aggregated metrics.

---

## Authentication

- **Algorithm:** HS256
- **Expiry:** 2 hours
- **Payload:** `{ sub: userId, email, role }`
- **Strategy:** Stateless JWT via Passport.js
- **Global guard:** All routes protected by default; use `@Public()` to opt out
- **WebSocket:** Token validated on connection (supports auth object, header, and query param)

---

## Testing

```bash
# Unit tests
pnpm test

# Watch mode
pnpm test:watch

# Coverage
pnpm test:cov

# E2E tests
pnpm test:e2e
```

---

## Seed Data

After running `npx prisma db seed`, the following test data is created:

| Entity | Details |
|--------|---------|
| **User** | `admin@vatio.com` / `admin@123` (role: `user`) |
| **Device 1** | `DEV-001` — Solar Panel Array A, Rooftop A |
| **Device 2** | `DEV-002` — Solar Panel Array B, Rooftop B |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | ❌ | Server port (default: `3000`) |
| `ALLOWED_ORIGINS` | ❌ | Comma-separated CORS origins |
| `JWT_SECRET` | ✅ | JWT signing secret (min 32 chars) |
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `MQTT_URL` | ❌ | MQTT broker URL (default: `mqtt://localhost:1883`) |
| `REDIS_HOST` | ✅ | Redis host |
| `REDIS_PORT` | ❌ | Redis port (default: `6379`) |
| `REDIS_PASSWORD` | ✅ | Redis password |
| `REDIS_TLS` | ❌ | Enable TLS for Redis (`true`/`false`) |

---

## License

UNLICENSED — Private project.
