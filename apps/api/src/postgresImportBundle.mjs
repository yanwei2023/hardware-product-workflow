import path from "node:path";

export function buildPostgresImportManifest({
  generatedAt = new Date(),
  outputDir,
  sourceStorePath,
  schemaPath = "schemas/database.sql",
  rowsPath,
  seedPath,
  reportPath,
  report,
} = {}) {
  const generatedAtIso = generatedAt instanceof Date ? generatedAt.toISOString() : String(generatedAt);
  const schemaCommandPath = schemaPath;
  const seedCommandPath = seedPath || path.join(outputDir || "", "postgres-seed.sql");

  return {
    generatedAt: generatedAtIso,
    sourceStorePath,
    outputDir,
    valid: Boolean(report?.valid),
    counts: report?.counts || {},
    errors: report?.errors || [],
    files: {
      schema: schemaPath,
      rows: rowsPath,
      seed: seedPath,
      report: reportPath,
    },
    psql: {
      requiredEnv: "DATABASE_URL",
      createSchema: `psql "$DATABASE_URL" -f ${schemaCommandPath}`,
      importSeed: `psql "$DATABASE_URL" -f ${seedCommandPath}`,
      oneShot: `psql "$DATABASE_URL" -f ${schemaCommandPath} && psql "$DATABASE_URL" -f ${seedCommandPath}`,
    },
  };
}
