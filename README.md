# Admin + Staff Management System

Canonical Admin + Staff Management System foundation and authentication phases.

## Scope

- PostgreSQL + Prisma data model foundation
- MasterAdmin isolation
- Staff lifecycle, invitations, resets, roles, permissions, and audit logs
- Staff authentication with RS256 access JWTs, refresh rotation, and audit events
- React + Vite frontend for MasterAdmin and Staff sessions
- No demo cleanup system

## Commands

- `npm test` - run server and client checks
- `npm run build` - run server and client build checks
- `npm test -w server` - run server checks directly
- `npm test -w client` - run client checks directly
- `npm run prisma:generate -w server` - generate Prisma Client
- `npm run prisma:validate -w server` - validate Prisma schema
- `npm run prisma:migrate:deploy -w server` - apply migrations locally
- `npm run prisma:seed -w server` - seed canonical permissions
