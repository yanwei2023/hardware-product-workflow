import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("runtime image includes the PostgreSQL client required by database CLI commands", () => {
  const dockerfile = fs.readFileSync("Dockerfile", "utf8");

  assert.match(dockerfile, /FROM node:22-alpine AS runtime[\s\S]*apk add --no-cache postgresql-client/);
});

test("compose waits for PostgreSQL and exposes its internal connection to the app", () => {
  const compose = fs.readFileSync("infra/docker-compose.yml", "utf8");

  assert.match(compose, /DATABASE_URL: postgres:\/\/hardware_flow:hardware_flow_dev@postgres:5432\/hardware_flow/);
  assert.match(compose, /HARDWARE_FLOW_STARTUP_STORE_SOURCE: \$\{HARDWARE_FLOW_STARTUP_STORE_SOURCE:-json\}/);
  assert.match(compose, /depends_on:\s+postgres:\s+condition: service_healthy/);
  assert.match(compose, /healthcheck:\s+test: \["CMD-SHELL", "pg_isready -U hardware_flow -d hardware_flow"\]/);
});
