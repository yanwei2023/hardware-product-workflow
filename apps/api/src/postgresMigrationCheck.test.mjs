import assert from "node:assert/strict";
import test from "node:test";
import { validateInitialMigrationMatchesSchema } from "./postgresMigrationCheck.mjs";

test("initial migration check accepts matching SQL", () => {
  const schema = "create table projects (id text primary key);\n";
  const migration = "create table projects (id text primary key);\n";

  assert.deepEqual(validateInitialMigrationMatchesSchema(schema, migration), []);
});

test("initial migration check reports drift", () => {
  const schema = "create table projects (id text primary key, name text not null);\n";
  const migration = "create table projects (id text primary key);\n";

  assert.deepEqual(validateInitialMigrationMatchesSchema(schema, migration), [
    "migrations/001_initial_schema.sql must match schemas/database.sql until the next migration is introduced",
  ]);
});
