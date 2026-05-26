import fs from "node:fs";
import path from "node:path";
import { mapStoreToPostgresRows, postgresTableNames } from "./postgresMapper.mjs";

const schemaPath = path.resolve("schemas/database.sql");

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function splitColumnDefinitions(block) {
  const definitions = [];
  let current = "";
  let depth = 0;
  for (const char of block) {
    if (char === "(") {
      depth += 1;
    }
    if (char === ")") {
      depth -= 1;
    }
    if (char === "," && depth === 0) {
      definitions.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) {
    definitions.push(current.trim());
  }
  return definitions;
}

export function parsePostgresSchemaTables(sql) {
  const tables = {};
  const tablePattern = /create table ([a-z_]+) \(([\s\S]*?)\n\);/g;
  for (const match of sql.matchAll(tablePattern)) {
    const [, table, body] = match;
    tables[table] = splitColumnDefinitions(body)
      .map((definition) => definition.split(/\s+/)[0])
      .filter((column) => column && !["constraint", "primary", "foreign", "unique", "check"].includes(column.toLowerCase()));
  }
  return tables;
}

export function parsePostgresSchemaColumns(sql) {
  const tables = {};
  const tablePattern = /create table ([a-z_]+) \(([\s\S]*?)\n\);/g;
  for (const match of sql.matchAll(tablePattern)) {
    const [, table, body] = match;
    tables[table] = splitColumnDefinitions(body)
      .map((definition) => {
        const [name] = definition.split(/\s+/);
        if (!name || ["constraint", "primary", "foreign", "unique", "check"].includes(name.toLowerCase())) {
          return null;
        }
        return {
          name,
          notNull: /\bnot\s+null\b/i.test(definition) || /\bprimary\s+key\b/i.test(definition),
        };
      })
      .filter(Boolean);
  }
  return tables;
}

export function validatePostgresRowCoverage(schemaTables, rows) {
  const errors = [];
  const schemaTableNames = Object.keys(schemaTables);
  const missingTables = schemaTableNames.filter((table) => !postgresTableNames.includes(table));
  const extraTables = Object.keys(rows).filter((table) => !schemaTableNames.includes(table));

  for (const table of missingTables) {
    errors.push(`mapper missing table ${table}`);
  }
  for (const table of extraTables) {
    errors.push(`mapper exports unknown table ${table}`);
  }

  for (const table of schemaTableNames) {
    const tableRows = rows[table] || [];
    const rowColumns = new Set(tableRows[0] ? Object.keys(tableRows[0]) : schemaTables[table]);
    for (const column of schemaTables[table]) {
      if (!rowColumns.has(column)) {
        errors.push(`mapper missing column ${table}.${column}`);
      }
    }
    for (const column of rowColumns) {
      if (!schemaTables[table].includes(column)) {
        errors.push(`mapper exports unknown column ${table}.${column}`);
      }
    }
  }

  return errors;
}

export function validatePostgresRequiredValues(schemaColumns, rows) {
  const errors = [];
  for (const [table, columns] of Object.entries(schemaColumns)) {
    const requiredColumns = columns.filter((column) => column.notNull).map((column) => column.name);
    for (const [index, row] of (rows[table] || []).entries()) {
      for (const column of requiredColumns) {
        if (row[column] === null || row[column] === undefined) {
          errors.push(`${table}[${index}].${column} is required by schema`);
        }
      }
    }
  }
  return errors;
}

const rowReferenceRules = [
  ["phases", "project_id", "projects"],
  ["gates", "project_id", "projects"],
  ["gates", "phase_id", "phases"],
  ["role_pairs", "project_id", "projects"],
  ["work_packages", "project_id", "projects"],
  ["work_packages", "phase_id", "phases"],
  ["work_packages", "role_pair_id", "role_pairs"],
  ["gate_requirements", "gate_id", "gates"],
  ["gate_requirements", "work_package_id", "work_packages"],
  ["artifact_versions", "work_package_id", "work_packages"],
  ["reviews", "work_package_id", "work_packages"],
  ["risks", "project_id", "projects"],
  ["risks", "phase_id", "phases"],
  ["risks", "owner_role_pair_id", "role_pairs"],
  ["agent_runs", "work_package_id", "work_packages"],
  ["agent_findings", "work_package_id", "work_packages"],
  ["agent_findings", "agent_run_id", "agent_runs"],
  ["work_package_evidence_refs", "project_id", "projects"],
  ["work_package_evidence_refs", "work_package_id", "work_packages"],
  ["gate_approval_packs", "project_id", "projects"],
  ["gate_approval_packs", "gate_id", "gates"],
  ["gate_approval_packs", "phase_id", "phases"],
  ["notifications", "project_id", "projects"],
  ["audit_events", "project_id", "projects"],
];

export function validatePostgresRowReferences(rows) {
  const errors = [];
  const idsByTable = Object.fromEntries(Object.entries(rows).map(([table, tableRows]) => [table, new Set(asArray(tableRows).map((row) => row.id))]));

  for (const [table, column, targetTable] of rowReferenceRules) {
    const targetIds = idsByTable[targetTable] || new Set();
    for (const [index, row] of asArray(rows[table]).entries()) {
      const value = row[column];
      if (value !== null && value !== undefined && !targetIds.has(value)) {
        errors.push(`${table}[${index}].${column} references missing ${targetTable}.id ${value}`);
      }
    }
  }

  return errors;
}

export function checkPostgresRowCoverage(sql, store) {
  const rows = mapStoreToPostgresRows(store);
  return [
    ...validatePostgresRowCoverage(parsePostgresSchemaTables(sql), rows),
    ...validatePostgresRequiredValues(parsePostgresSchemaColumns(sql), rows),
    ...validatePostgresRowReferences(rows),
  ];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sql = fs.readFileSync(schemaPath, "utf8");
  const { createDemoStore } = await import("./server.mjs");
  const errors = checkPostgresRowCoverage(sql, createDemoStore());
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("PostgreSQL row mapping covers schema tables and columns.");
  }
}
