import fs from "node:fs";
import path from "node:path";
import { mapStoreToPostgresRows, postgresTableNames } from "./postgresMapper.mjs";

const schemaPath = path.resolve("schemas/database.sql");

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

export function checkPostgresRowCoverage(sql, store) {
  const rows = mapStoreToPostgresRows(store);
  return [
    ...validatePostgresRowCoverage(parsePostgresSchemaTables(sql), rows),
    ...validatePostgresRequiredValues(parsePostgresSchemaColumns(sql), rows),
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
