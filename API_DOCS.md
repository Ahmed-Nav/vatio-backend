# Vatio IoT — API Documentation

> **Base URL:** `http://localhost:3000/api/v1` (set `PORT` in `.env`; the local dev setup uses `3006`)
> **Swagger UI:** `/api/docs`
> **Authentication:** cookie session + CSRF token (see below). There is no JWT / bearer token and no `/auth/refresh`.

## Contents

1. [Conventions](#1-conventions)
2. [Authentication and sessions](#2-authentication-and-sessions)
3. [Account states and access rules](#3-account-states-and-access-rules)
4. [Users (admin)](#4-users-admin)
5. [Devices](#5-devices)
6. [Telemetry, analytics and alerts](#6-telemetry-analytics-and-alerts)
7. [Billing (customer)](#7-billing-customer)
8. [Billing and payments (admin)](#8-billing-and-payments-admin)
9. [Payment gateway and webhook](#9-payment-gateway-and-webhook)
10. [Background jobs](#10-background-jobs)
11. [WebSocket — live telemetry](#11-websocket--live-telemetry)
12. [Errors](#12-errors)
13. [Data models](#13-data-models)
14. [Environment variables](#14-environment-variables)
15. [Not built yet](#15-not-built-yet)

---

## 1. Conventions

- All paths below are relative to the base URL.
- Bodies are JSON. **Do not send `Content-Type: application/json` with an empty body** (Fastify rejects it); omit the header on body-less `POST`/`DELETE` requests.
- Validation uses `whitelist: true`: unknown body fields are silently dropped.
- Dates are ISO 8601 strings. Money is whole rupees (`amount: 499`), except gateway order amounts which are in paise (`49900`).
- "Admin" means `role = admin`. Admin accounts are never blocked by the access rules in section 3.
- Every route needs a valid session unless marked **Public**.

## 2. Authentication and sessions

Login is **email + password, then a 4-digit OTP**. A successful OTP check creates a server-side session (stored in Redis) and sets an `httpOnly`, `SameSite=Strict` cookie.

| | Value |
|---|---|
| Cookie name | `vatio_session` (`__Host-vatio_session` and `Secure` when `NODE_ENV=production`) |
| Idle timeout | 12 h (`SESSION_IDLE_TTL_SECONDS`) |
| Absolute timeout | 7 days (`SESSION_ABSOLUTE_TTL_SECONDS`) |
| CSRF | Every non-`GET` request that is not **Public** must send `X-CSRF-Token: <csrfToken>` (returned by `verify-otp` and `GET /auth/session`). If an `Origin` header is present it must be in `ALLOWED_ORIGINS`. |
| CORS | `ALLOWED_ORIGINS` (comma separated), credentials enabled. Browsers must send requests with credentials. |

Browsers should call `GET /auth/session` on load to restore a session and get a fresh CSRF token.

### POST /auth/login — Public
Checks the password and sends an OTP. Rate limit: one OTP per email every 30 s (`429` otherwise).

```json
{ "email": "user@example.com", "password": "secret123" }
```
`200` → `{ "message": "OTP sent" }`. When `NODE_ENV` is **not** `production`, the response also contains `"devOtp": "1234"` and the OTP is printed in the server log (no email/SMS provider is connected yet).

Errors: `401` invalid credentials · `403 ACCOUNT_DISABLED` (hard-disabled by an admin) · `429`.

### POST /auth/register — Public
Creates an account in state **Pending** (account `Pending`, payment `Pending`) and sends an OTP, exactly like login.

```json
{
  "name": "Abdul Hameed", "email": "a@b.com", "password": "min 6 chars",
  "phone": "9600792341", "address1": "15 A, Beach street", "address2": "",
  "city": "Adirampattinam", "pincode": "614701",
  "deviceId": "NEWDEV_01"
}
```
Only `name`, `email`, `password` are required. `deviceId` is optional: the device must exist (`404`) and must **not** already have an owner (`409`). Duplicate email → `409`.

### POST /auth/verify-otp — Public
```json
{ "email": "user@example.com", "otp": "1234" }
```
OTP rules: 4 digits, valid 5 minutes, 5 wrong attempts invalidate it. Success sets the session cookie and returns:

```json
{
  "user": { "...profile, see GET /auth/session" },
  "csrfToken": "…",
  "expiresAt": "2026-10-29T05:18:41.000Z"
}
```
`401` for a wrong/expired OTP · `403 ACCOUNT_DISABLED`.

### GET /auth/session
Returns the signed-in user's **fresh** profile (read from the database, not a login snapshot):

```json
{
  "user": {
    "id": "uuid", "email": "a@b.com", "name": "Abdul Hameed", "role": "user",
    "phone": "9600792341", "address1": "…", "address2": "…", "city": "…", "pincode": "…",
    "enabled": true, "accountStatus": "Active", "paymentStatus": "Paid",
    "paidUntil": "2026-11-21T00:00:00.000Z",
    "plan": { "id": "plan-monthly", "name": "Monthly", "period": "monthly", "amount": 499 },
    "lastLogin": "2026-10-22T05:00:00.000Z",
    "deviceId": "NEWDEV_01", "deviceIds": ["NEWDEV_01"]
  },
  "csrfToken": "…",
  "expiresAt": "…"
}
```
`401` when there is no valid session.

### PUT /auth/profile
Edits the caller's own details. All fields optional, at least one required. Email and role cannot be changed here.

```json
{ "name": "…", "phone": "…", "address1": "…", "address2": "…", "city": "…", "pincode": "…" }
```
`200` → `{ "user": { …profile } }`. `400` for invalid values or an empty body.

### POST /auth/change-password
```json
{ "currentPassword": "old-one", "newPassword": "at-least-8-chars" }
```
`newPassword`: 8–72 characters and different from the current one. On success all of the user's **other** sessions are signed out; the current session stays. After 5 wrong `currentPassword` attempts in 15 minutes → `429`. `400` for a wrong current password.

### POST /auth/logout · POST /auth/logout-all
`204`. `logout` ends this session; `logout-all` ends every session of the user. Both clear the cookie.

> The whole `/auth/*` controller (except the Public routes above) works for suspended and pending users so they can sign in, manage their profile and reach billing.

## 3. Account states and access rules

| Field | Values | Meaning |
|---|---|---|
| `enabled` | `true` / `false` | `false` = hard-disabled: cannot sign in at all. |
| `accountStatus` | `Pending`, `Active`, `Suspended` | `Pending` = waiting for admin approval. `Suspended` = admin action or the nightly job for non-payment. |
| `paymentStatus` | `Pending`, `Paid`, `Unpaid`, `Overdue` | Billing state (see section 10 for how it changes). |

**What each state can do** (non-admin users):

| State | Sign in | Profile + billing | Devices, analytics, alerts, telemetry, live data |
|---|---|---|---|
| Active | yes | yes | yes |
| Pending | yes | yes (cannot pay until approved) | **no** — `403 ACCOUNT_PENDING` |
| Suspended | yes | yes (so they can pay) | **no** — `403 ACCOUNT_SUSPENDED` |
| `enabled = false` | **no** — `403 ACCOUNT_DISABLED` | — | — |

Enforcement is a global guard (`AccessGuard`). Routes marked with `@AllowRestricted()` (all of `/auth/*` and `/billing/*`) are exempt. Becoming Suspended, or being disabled, **signs the user out immediately** (all sessions are revoked, which also drops their live-data sockets). Paying lifts a non-payment suspension automatically.

A device with `enabled = false` is hidden from its owner: `403 DEVICE_DISABLED` on the device, its analytics and its latest telemetry, no live data, and incoming MQTT readings for it are discarded. Admins can still see it.

## 4. Users (admin)

All routes require `role = admin` (`403` otherwise).

### GET /users
Lists non-admin users, newest first.

```json
[{
  "id": "uuid", "name": "…", "email": "…", "phone": "…",
  "address": "address1, address2", "address1": "…", "address2": "…", "city": "…", "pincode": "…",
  "deviceId": "NEWDEV_01", "deviceIds": ["NEWDEV_01", "NEWDEV_02"],
  "enabled": true, "accountStatus": "Active", "paymentStatus": "Unpaid",
  "paidUntil": "2026-10-25T00:00:00.000Z",
  "plan": { "id": "plan-monthly", "name": "Monthly", "period": "monthly", "amount": 499 },
  "lastLogin": "…", "role": "user"
}]
```
`deviceId` is the first device (kept for older screens); `deviceIds` lists all of them.

### PATCH /users/:id
All fields optional:

| Field | Type | Notes |
|---|---|---|
| `enabled` | boolean | `false` signs the user out immediately. |
| `accountStatus` | `Active` \| `Suspended` \| `Pending` | Leaving `Active` signs the user out immediately. |
| `paymentStatus` | `Paid` \| `Unpaid` \| `Overdue` \| `Pending` | Label only. To record a payment use `mark-paid` (section 8). |
| `paidUntil` | ISO date | "Extend due date". |
| `planId` | string | Must be an existing plan. |
| `deviceId` | string | **Adds** this device to the user (they may own several). `409` if another user owns it; `404` if it doesn't exist. To remove or move a device use `PATCH /devices/:id/owner`. |

Admin accounts cannot be disabled or suspended (`400`). Every change is written to the audit log. Returns the updated user in the same shape as `GET /users`.

## 5. Devices

A device id is the MQTT id (e.g. `NEWDEV_01`, topic `vatio/{id}/rs485`). A device has at most one owner but a user can own many. Ownerless devices (`ownerId: null`) are allowed.

| Method | Path | Who | Description |
|---|---|---|---|
| `GET` | `/devices` | any | Admin: all devices. Others: their own (including disabled ones, so the UI can show them). |
| `GET` | `/devices/:id` | owner / admin | `404 DEVICE_NOT_FOUND`; owners get `403 DEVICE_DISABLED` if switched off. |
| `POST` | `/devices` | **admin** | Body `{ "id", "name", "location?", "ownerId?" }`. Starts unassigned unless `ownerId` is given. `409` if the id exists. |
| `PATCH` | `/devices/:id` | **admin** | Body `{ "name?", "location?", "status?", "enabled?" }`. `enabled: false` disables the device. |
| `PATCH` | `/devices/:id/owner` | **admin** | Body `{ "userId": "uuid" }` to assign / move, or `{ "userId": null }` to unassign. |
| `DELETE` | `/devices/:id` | **admin** | Deletes the device together with its readings and alerts. |

Device object: `id, name, location, type, status, hwVersion, fwVersion, lastSeen, enabled, ownerId, createdAt`. Online/offline is not stored — clients derive it from `lastSeen` (recommended: online if seen in the last 60 s).

## 6. Telemetry, analytics and alerts

Owners can read their own devices; admins can read any. All of these return `403 ACCOUNT_*` for blocked users and `403 DEVICE_DISABLED` for a switched-off device (non-admins).

- `GET /telemetry/:deviceId/latest` → `{ "deviceId", "ts", "metrics": { … } }`. `404 TELEMETRY_NOT_FOUND` before any raw reading exists.
- `GET /analytics/history?deviceId=&start=&end=&interval=` — `interval`: `1m`, `5m` (default), `15m`, `1h`, `1d`, `1mo`.
- `GET /analytics/energy?deviceId=&start=&end=&type=` — `type`: `hourly`, `daily` (default), `monthly`. Returns `[{ "ts", "value" }]` (grid import kWh per bucket).
- `GET /analytics/solar-profile?deviceId=&start=&end=&type=` — `type`: `hourly` (default), `daily`, `monthly`.
- `GET /alerts` → unacknowledged alerts for the caller's enabled devices.
- Device activity (`GET /telemetry/:id/activity`) is requested by the frontend but is **not implemented**.

`start` / `end` are ISO dates.

## 7. Billing (customer)

All `/billing/*` routes except the webhook need a session but work for suspended and pending users.

### GET /billing/plans
Active plans, ordered:
```json
[{ "id": "plan-monthly", "name": "Monthly", "period": "monthly", "amount": 499, "durationDays": 30, "badge": null, "active": true }]
```
Three plans are created on first start if none exist (Monthly 499 / 30 d, Quarterly 1349 / 90 d "Save 10%", Yearly 5090 / 365 d "Save 15%"). **These prices are placeholders** — edit them with `PATCH /admin/plans/:id`.

### GET /billing/me
```json
{
  "plan": { "id": "…", "name": "Monthly", "period": "monthly", "amount": 499 },
  "paymentStatus": "Unpaid",
  "paidUntil": "2026-10-25T00:00:00.000Z",
  "lastPaidAt": "2026-09-25T10:00:00.000Z",
  "payments": [
    { "id": "uuid", "date": "…", "plan": "Monthly", "amount": 499, "status": "Paid", "invoiceUrl": null }
  ]
}
```
`payments` holds the latest 50 payments with status `Paid`, `Failed` or `Refunded`. `invoiceUrl` is always `null` for now.

### POST /billing/orders
```json
{ "planId": "plan-monthly" }
```
Creates a payment attempt and a gateway order. The **amount always comes from the plan**, never from the request.
`200` → `{ "orderId": "order_…", "amount": 49900, "currency": "INR", "keyId": "rzp_…" }` — feed these straight into the gateway checkout. `403 ACCOUNT_PENDING` / `ACCOUNT_DISABLED`, `404` unknown or inactive plan.

The browser's "payment successful" callback is **not proof of payment**. The backend marks the user Paid only when the gateway's webhook arrives (section 9); clients should refetch `GET /billing/me` afterwards.

### POST /billing/dev/confirm — development only
```json
{ "orderId": "stub_order_…" }
```
Completes an order without any money. Exists only when the stub gateway is active **and** `NODE_ENV` is not `production` (otherwise `404`). The order must belong to the caller.

## 8. Billing and payments (admin)

Routes under `/admin/*` require `role = admin`.

### GET /admin/payments
```json
{
  "summary": { "collectedThisMonth": 24950, "unpaid": 5, "overdue": 2, "failed": 1 },
  "payments": [
    { "id": "uuid | due-<userId>", "userId": "uuid", "userName": "…", "deviceId": "NEWDEV_01",
      "date": "…", "amount": 499, "status": "Paid | Failed | Refunded | Unpaid | Overdue", "method": "online | offline | null" }
  ]
}
```
The list mixes recorded payments (latest 200) with one `due-…` row per user whose payment is `Unpaid` or `Overdue`.

### POST /admin/payments/:userId/mark-paid
Records a payment taken outside the app (cash, bank transfer, UPI) and extends the due date.
```json
{ "note": "Cash received 22 Oct", "planId": "plan-monthly" }
```
Both fields optional (plan defaults to the user's plan, then the first active plan). `400` if no plan exists. Sets `paymentStatus = Paid`, adds the plan's duration (from the current due date if it is still in the future, otherwise from now) and lifts a non-payment suspension. Audited.

### Plans
- `GET /admin/plans` — all plans including inactive.
- `PATCH /admin/plans/:id` — `{ "name?", "amount?" (≥1), "durationDays?" (1–3650), "badge?" (string or null), "active?" }`. Audited.

### Billing settings
- `GET /admin/billing-settings` → `{ "billing.overdueAfterDays": 3, "billing.suspendAfterDays": 7 }`
- `PATCH /admin/billing-settings` — `{ "overdueAfterDays?" (0–90), "suspendAfterDays?" (0–180) }`

### POST /admin/billing/run-sweep
Runs the due/overdue/suspend check now and returns `{ "markedUnpaid", "markedOverdue", "suspended" }`.

## 9. Payment gateway and webhook

The gateway is chosen at start-up:

- **Razorpay** — when `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` **and** `RAZORPAY_WEBHOOK_SECRET` are all set.
- **Stub** — otherwise (default). Orders are fake and nothing is charged. The log line `Payment gateway: stub` shows which one is active.

### POST /billing/webhook — Public
Called by Razorpay, not by the frontend. No session and no CSRF; instead the `X-Razorpay-Signature` header must equal `HMAC-SHA256(rawBody, RAZORPAY_WEBHOOK_SECRET)` (hex). Anything else → `403`.

Handled events: `payment.captured` / `order.paid` (mark paid) and `payment.failed`. Other events are ignored with `200`.

Safety rules, all covered by tests:
- Idempotent — a repeated delivery never extends the plan twice (the first writer flips the payment to `Paid`; others do nothing).
- The paid amount must equal the order amount (paise); a mismatch is logged and ignored.
- Paying extends from the current due date when still in credit, and reactivates a user suspended for non-payment (never one that is hard-disabled).

To go live: create the webhook in the Razorpay dashboard pointing at `https://<your-host>/api/v1/billing/webhook`, enable the events above, and set the three env vars.

## 10. Background jobs

A BullMQ repeatable job `daily-sweep` (queue `billing`, Redis) runs at **02:00 every night** (server time) and calls the same logic as `POST /admin/billing/run-sweep`. Only non-admin users who have a `paidUntil` date are touched (users who never paid are left alone):

| Condition (days measured from `paidUntil`) | Change |
|---|---|
| Due date passed, status `Paid` | `paymentStatus → Unpaid` |
| `overdueAfterDays` (default 3) passed, status `Unpaid` | `paymentStatus → Overdue` |
| `suspendAfterDays` (default 7) passed, account `Active` | `accountStatus → Suspended`, all sessions revoked, audit entry `billing.auto_suspend` |

## 11. WebSocket — live telemetry

Socket.IO, namespace **`/telemetry`** on the same host. Connect with credentials so the session cookie is sent; the connection is refused if the session is invalid, and it is dropped within about a minute after the session ends (including when the user is suspended or disabled).

```js
const socket = io('http://localhost:3006/telemetry', { withCredentials: true });
socket.emit('joinDevice', 'NEWDEV_01');          // join one device's room
socket.on('telemetry_update', (data) => { … });  // every ~5 s
```

- `joinDevice` is allowed for admins, or for the device's owner when their account is Active **and** the device is enabled; otherwise the server answers with a `WsException`.
- `telemetry_update` payload: `{ "deviceId", "timestamp", "metrics": { "avg": {…}, "min": {…}, "max": {…} } }` — the keys inside are the metric names the device publishes (normalised, e.g. `phase1Voltage`, `power`, `energyKwh`).

## 12. Errors

Every error uses one envelope:
```json
{ "code": "ACCOUNT_SUSPENDED", "message": "Your account is suspended…", "timestamp": "2026-10-22T05:18:41.325Z" }
```
Validation errors have `code: "BAD_REQUEST"` and `message` as a string or an array of strings.

| HTTP | `code` | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Validation failed, wrong current password, empty body |
| 401 | `UNAUTHORIZED` | No/expired session, wrong login, wrong OTP |
| 403 | `FORBIDDEN` | Not an admin, bad CSRF/origin, bad webhook signature |
| 403 | `ACCOUNT_DISABLED` | `enabled = false` |
| 403 | `ACCOUNT_PENDING` | Awaiting admin approval |
| 403 | `ACCOUNT_SUSPENDED` | Suspended by an admin or for non-payment |
| 403 | `DEVICE_DISABLED` | Device switched off by an admin |
| 404 | `NOT_FOUND`, `DEVICE_NOT_FOUND`, `TELEMETRY_NOT_FOUND` | Missing resource (also used instead of 403 for devices you don't own) |
| 409 | `CONFLICT` | Duplicate email or device id, device already owned |
| 429 | `TOO_MANY_REQUESTS` | OTP resend within 30 s, too many password attempts |

Clients should treat `ACCOUNT_*` codes as "show the access screen / billing page", not as a generic error.

## 13. Data models

Source of truth: `prisma/schema.prisma`. There are **no migrations**; apply changes with `npx prisma db push`.

- **User** — `id, email (unique), name, password (bcrypt), role, phone, address1, address2, city, pincode, enabled, accountStatus, paymentStatus, paidUntil, planId, lastLogin, createdAt`
- **Device** — `id, name, location, type, status, hwVersion, fwVersion, lastSeen, enabled, ownerId (nullable), createdAt`
- **Telemetry** — `id (bigint), deviceId, timestamp, data (JSON)`
- **Alert** — `id, deviceId, type, severity, message, acknowledged, createdAt`
- **Plan** — `id, name, period (monthly|quarterly|yearly), amount (rupees), durationDays, badge, active, sortOrder`
- **Payment** — `id, userId, planId, amount, status (Created|Paid|Failed|Refunded), method (online|offline), gateway, gatewayOrderId (unique), gatewayPaymentId (unique), note, createdAt, paidAt`. A `Created` row is an order that has not been paid.
- **Setting** — `key, value` (billing thresholds).
- **AuditLog** — `id, actorId, action, targetType, targetId, meta (JSON), createdAt`. Written for: `user.update`, `device.create|update|enable|disable|assign|delete`, `plan.update`, `billing.settings`, `payment.paid`, `payment.mark_paid`, `billing.auto_suspend`, `auth.change_password`. There is no API to read it yet — query the table.

OTPs and sessions live only in Redis (`vatio:otp:*`, `vatio:session:*`, `vatio:user-sessions:*`).

## 14. Environment variables

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default 3000) |
| `ALLOWED_ORIGINS` | CORS / CSRF origin allow-list, comma separated |
| `SESSION_SECRET` | Signs OTP digests and CSRF tokens (falls back to `JWT_SECRET`; one of them is required) |
| `SESSION_IDLE_TTL_SECONDS`, `SESSION_ABSOLUTE_TTL_SECONDS` | Session lifetimes |
| `DATABASE_URL` | PostgreSQL connection string |
| `MQTT_URL` | Broker the devices publish to |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_TLS` | Redis (sessions, OTPs, queues, telemetry streams) |
| `NODE_ENV` | `production` hides `devOtp`, enables the `__Host-` secure cookie and disables `/billing/dev/confirm` |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Turn on the real gateway (all three required) |

Seed (`npx prisma db seed`): admin `admin@vatio.com` / `admin@123` (change it), devices `DEV-001`, `DEV-002`.

## 15. Not built yet

- Real email / SMS delivery of OTPs and payment reminders (the OTP is only logged / returned in development).
- Invoice PDFs (`invoiceUrl` is always `null`), refunds, and an audit-log read API.
- `GET /telemetry/:id/activity` (device online/offline history).
- Per-device pricing: billing is per **account** (one plan and due date per user, however many devices they own).
- Login rate limiting beyond the OTP resend cooldown and the password-change limit.
