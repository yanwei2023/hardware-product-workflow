import fs from "node:fs";
import path from "node:path";

const schemaPath = path.resolve("schemas/database.sql");
const initialMigrationPath = path.resolve("migrations/001_initial_schema.sql");

function normalizeSql(sql) {
  return sql.trim().replace(/\r\n/g, "\n");
}

export function validateInitialMigrationMatchesSchema(schemaSql, migrationSql) {
  const errors = [];
  if (normalizeSql(schemaSql) !== normalizeSql(migrationSql)) {
    errors.push("migrations/001_initial_schema.sql must match schemas/database.sql until the next migration is introduced");
  }
  return errors;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  const migrationSql = fs.readFileSync(initialMigrationPath, "utf8");
  const errors = validateInitialMigrationMatchesSchema(schemaSql, migrationSql);
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Initial PostgreSQL migration matches schemas/database.sql.");
  }
}
