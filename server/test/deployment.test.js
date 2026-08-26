import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

function read(relativePath) {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

test("production compose pins the API and client to loopback and mounts JWT secrets read-only", () => {
  const compose = read("docker-compose.prod.yml");
  assert.match(compose, /127\.0\.0\.1:5505:5500/);
  assert.match(compose, /127\.0\.0\.1:5506:80/);
  assert.match(compose, /\/run\/secrets\/jwt:ro/);
  assert.match(compose, /cap_drop:/);
  assert.match(compose, /no-new-privileges:true/);
});

test("production env examples use container secret paths and base-path settings", () => {
  const envExample = read(".env.production.example");
  const clientEnvExample = read("client/.env.production.example");
  assert.match(envExample, /JWT_ACCESS_PRIVATE_KEY_PATH=\/run\/secrets\/jwt\/access-current-private\.pem/);
  assert.match(envExample, /JWT_REFRESH_PRIVATE_KEY_PATH=\/run\/secrets\/jwt\/refresh-current-private\.pem/);
  assert.match(envExample, /APP_BASE_PATH=\/admin-staff/);
  assert.match(clientEnvExample, /VITE_API_URL=\/admin-staff\/api/);
  assert.match(clientEnvExample, /VITE_APP_BASE_PATH=\/admin-staff/);
});

test("docker ignore keeps real env files and secrets out of images", () => {
  const dockerignore = read(".dockerignore");
  assert.match(dockerignore, /\.env\.\*/);
  assert.match(dockerignore, /server\/secrets/);
  assert.match(dockerignore, /client\/dist/);
});

test("server and client Dockerfiles keep runtime packaging separate", () => {
  const serverDockerfile = read("server/Dockerfile");
  const clientDockerfile = read("client/Dockerfile");
  assert.match(serverDockerfile, /npm run prisma:generate -w server/);
  assert.match(serverDockerfile, /USER jwtapp/);
  assert.match(clientDockerfile, /VITE_APP_BASE_PATH/);
  assert.match(clientDockerfile, /nginx:1\.27-alpine/);
});
