# Admin + Staff Management System

Canonical Admin + Staff Management System foundation and deployment phases.

## Scope

- PostgreSQL + Prisma data model foundation
- MasterAdmin isolation
- Staff lifecycle, invitations, resets, roles, permissions, and audit logs
- Staff authentication with RS256 access JWTs, refresh rotation, and audit events
- React + Vite frontend for MasterAdmin and Staff sessions
- Production Docker, RSA key mounting, JWKS, health, and deployment hardening

## Commands

- `npm test` - run server and client checks
- `npm run build` - run server and client build checks
- `npm test -w server` - run server checks directly
- `npm test -w client` - run client checks directly
- `npm run prisma:generate -w server` - generate Prisma Client
- `npm run prisma:validate -w server` - validate Prisma schema
- `npm run prisma:migrate:deploy -w server` - apply migrations locally
- `npm run prisma:seed -w server` - seed canonical permissions

## Production Deployment Checklist

1. Pull or clone the repository on the deployment host.
2. Create a production env file from `.env.production.example`.
3. Create the RSA secret directory on the host, such as `/opt/general-system/admin-staff-management/secrets/jwt`.
4. Generate production RSA keypairs with `server/scripts/generate-jwt-keys.mjs`.
5. Set host ownership and permissions so the mounted private keys are readable by the container group but not writable by the runtime user.
6. Confirm the production env paths point at `/run/secrets/jwt/...` inside the container.
7. Build the production images with `docker compose -f docker-compose.prod.yml build`.
8. Start PostgreSQL and wait for the healthcheck to pass.
9. Run `docker compose -f docker-compose.prod.yml --env-file .env.production run --rm server npm run prisma:migrate:deploy`.
10. Run `docker compose -f docker-compose.prod.yml --env-file .env.production run --rm server npm run prisma:seed`.
11. Run `docker compose -f docker-compose.prod.yml --env-file .env.production run --rm server node scripts/bootstrap-master-admin.mjs --username=... --password=...`.
12. Run `docker compose -f docker-compose.prod.yml --env-file .env.production run --rm server npm run smtp:verify` if you want a safe SMTP transport check.
13. Start or recreate the long-running server and client containers.
14. Configure the host Nginx edge to proxy `/admin-staff/` and `/admin-staff/api/` to the local containers.
15. Verify HTTPS terminates only at the host Nginx layer.
16. Verify `GET /api/health` returns `{ "ok": true }`.
17. Verify `GET /api/.well-known/jwks.json` returns public JWKS data only.
18. Run browser smoke tests for staff login, MasterAdmin login, invitations, RBAC, and lifecycle flows.
19. Verify the server container runs as a non-root user.
20. Verify private RSA keys are not exposed in the image, Git, or client bundle.
21. Verify audit IP logging works behind the trusted proxy hop.

## Production Checklist Notes

- The production API container runs as a dedicated non-root user.
- The host Nginx edge owns HTTPS and HSTS.
- The application container exposes only the public JWKS endpoint, health endpoint, and authenticated JSON APIs.
- The client build supports the `/admin-staff/` base path and uses `/admin-staff/api` for API calls.
- The server supports `/api/health` and `/api/.well-known/jwks.json`.

## Key Rotation

1. Generate a new keypair into a staging location.
2. Move the current public key to the previous public key path.
3. Replace the current private and public key files.
4. Update the current and previous `kid` values in production env values.
5. Redeploy the server container.
6. Verify JWKS still returns the current public key and any configured previous key.
7. Wait for the longest token lifetime before removing retired previous public keys.

## Production Nginx Reference

Conceptually:

```nginx
location /admin-staff/ {
  proxy_pass http://127.0.0.1:5506;
}

location /admin-staff/api/ {
  proxy_pass http://127.0.0.1:5505;
}
```

The host Nginx edge remains the single owner of HTTPS and HSTS.

## RSA/JWKS Notes

- RS256 remains the production signing algorithm.
- JWKS exposes only public verification material.
- The server exports `kty`, `use`, `alg`, `kid`, `n`, and `e` for public keys.
- Private PEMs and private RSA parameters are never exposed.
- The architecture can later be adapted to ES256 while preserving the same `kid`, rotation, JWKS, and purpose-separation model.

## SMTP

Production SMTP is env-driven through:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASSWORD`
- `SMTP_FROM`
- `npm run smtp:verify -w server` performs a safe transport check without exposing secrets.

## Cookie and CORS

- Refresh cookies remain HttpOnly.
- Production cookie security is controlled by `COOKIE_SECURE`.
- CORS allows the configured `CLIENT_URL` only with credentials enabled.
- CSRF remains enabled for cookie-authenticated state-changing requests.

## Rate Limiting

- Login, refresh, invitation, and password-reset endpoints remain rate limited.
- Refresh has a higher production allowance than login so normal browser reloads remain usable.

## Secret Scan

- `.env`, `.env.production`, RSA private keys, and `secrets/` remain excluded from Git and Docker builds.
