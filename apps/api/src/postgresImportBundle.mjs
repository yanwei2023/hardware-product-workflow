import fs from "node:fs";
import path from "node:path";
import { postgresImportResultFileName } from "./postgresImportReport.mjs";

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
    commands: {
      preflight: `npm run db:preflight -- ${outputDir} --strict`,
      preview: `npm run db:import -- ${outputDir}`,
      execute: `npm run db:import -- ${outputDir} --confirm`,
      verifyResult: `npm run db:verify-import-result -- ${path.join(outputDir || "", postgresImportResultFileName)}`,
      restoreStorePreview: `npm run db:restore-store -- ${rowsPath}`,
      restoreStoreExecute: `npm run db:restore-store -- ${rowsPath} --confirm`,
      compareStore: `npm run db:compare-store -- --report ${path.join(outputDir || "", "postgres-store-comparison.json")} --strict`,
      verifyStoreComparison: `npm run db:verify-store-comparison -- ${path.join(outputDir || "", "postgres-store-comparison.json")}`,
    },
  };
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function verifyPostgresImportBundle(outputDir) {
  const manifestPath = path.join(outputDir, "postgres-import-manifest.json");
  const errors = [];

  if (!fs.existsSync(manifestPath)) {
    return {
      valid: false,
      outputDir,
      manifestPath,
      errors: [`manifest file is missing: ${manifestPath}`],
    };
  }

  let manifest;
  try {
    manifest = readJsonFile(manifestPath);
  } catch (error) {
    return {
      valid: false,
      outputDir,
      manifestPath,
      errors: [`manifest JSON is invalid: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  const files = manifest.files || {};
  for (const [label, filePath] of Object.entries(files)) {
    if (!filePath) {
      errors.push(`manifest.files.${label} is missing`);
    } else if (!fs.existsSync(filePath)) {
      errors.push(`${label} file is missing: ${filePath}`);
    }
  }

  let report = null;
  if (files.report && fs.existsSync(files.report)) {
    try {
      report = readJsonFile(files.report);
      if (report.valid !== true) {
        errors.push("export report is not valid");
      }
      if (Array.isArray(report.errors) && report.errors.length > 0) {
        errors.push(...report.errors.map((item) => `export report error: ${item}`));
      }
    } catch (error) {
      errors.push(`report JSON is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (files.rows && fs.existsSync(files.rows)) {
    try {
      readJsonFile(files.rows);
    } catch (error) {
      errors.push(`rows JSON is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (files.seed && fs.existsSync(files.seed)) {
    const seedSql = fs.readFileSync(files.seed, "utf8");
    if (!seedSql.includes("BEGIN;") || !seedSql.includes("COMMIT;")) {
      errors.push("seed SQL must include BEGIN and COMMIT");
    }
    if (!seedSql.includes("ON CONFLICT (id) DO UPDATE SET")) {
      errors.push("seed SQL must include idempotent upserts");
    }
  }

  return {
    valid: errors.length === 0,
    outputDir,
    manifestPath,
    errors,
    counts: report?.counts || manifest.counts || {},
    files,
  };
}
