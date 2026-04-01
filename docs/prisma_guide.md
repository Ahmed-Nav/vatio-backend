# Prisma Beginner's Guide for Vatio

Prisma is a Next-generation ORM (Object-Relational Mapper) that makes database access easy and type-safe. In the Vatio project, we use Prisma with **PostgreSQL** (hosted on Neon) to store device telemetry, alerts, and user data.

---

## 1. Core Concepts

### The Prisma Schema (`prisma/schema.prisma`)
This is the single source of truth for your database structure.
- **Models**: Represent your database tables (e.g., `User`, `Device`, `Telemetry`).
- **Fields**: Represent columns in those tables.
- **Relations**: Define how models connect (e.g., a `Device` has many `Telemetry` records).

### Prisma Client
A type-safe database client auto-generated from your schema. It allows you to write code like:
```typescript
const device = await prisma.device.findUnique({ where: { id: 'SIM-001' } });
```

---

## 2. Common Commands

Run these in the backend root directory (`vatio-backend`):

| Command | Purpose |
| :--- | :--- |
| `npx prisma generate` | Updates the Prisma Client code after you change the schema. |
| `npx prisma db push` | Syncs your schema to the database **without** creating migrations (best for quick prototyping). |
| `npx prisma migrate dev` | Syncs schema and creates a versioned migration file (best for production/teams). |
| `npx prisma migrate reset` | Wipes the database, re-applies migrations, and runs the seed script. |
| `npx prisma studio` | Opens a beautiful GUI in your browser to view/edit your data. |

---

## 3. Working with Telemetry

The `Telemetry` table in Vatio is designed for high-performance time-series data.

### Naming Mismatches (Common Pitfall)
If you are pushing data from a simulator or a hardware device, ensure the keys match the Prisma model.

**Example Schema:**
```prisma
model Telemetry {
  energy Float? // Corresponds to Import_kWh
  power  Float? // Corresponds to Total_kW
}
```

**Incorrect Data:** `{ Import_kWh: 10.5 }`  (Prisma will throw "Unknown argument")  
**Correct Data:** `{ energy: 10.5 }`

---

## 4. Troubleshooting

### "EPERM: operation not permitted"
This happens if you try to `generate` or `migrate` while the backend server is running.
**Solution**: Stop the backend (`Ctrl+C` or kill the process), run the command, then restart.

### "Unknown argument"
You tried to save a field that isn't in `schema.prisma`.
**Solution**: Either add the field to the schema or map the incoming data keys to match the schema fields.

### Database Connection Issues
Check your `.env` file for the `DATABASE_URL`. If you are using Neon, ensure the `?sslmode=require` parameter is present.

---

## 5. Seeding Data
To populate your database with initial users or test devices, edit `prisma/seed.ts` and run:
```bash
npx prisma db seed
```
