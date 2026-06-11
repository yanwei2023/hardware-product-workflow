import path from "node:path";
import { executePostgresImport } from "./postgresImporter.mjs";
import {
  postgresImportPreviewFileName,
  postgresImportResultFileName,
  writePostgresImportResultReport,
} from "./postgresImportReport.mjs";

const args = process.argv.slice(2);
const confirm = args.includes("--confirm");
const reportFlagIndex = args.indexOf("--report");
const reportPathArg = reportFlagIndex >= 0 ? args[reportFlagIndex + 1] : null;
const positionalArgs = args.filter(
  (arg, index) => arg !== "--confirm" && arg !== "--report" && (reportFlagIndex < 0 || index !== reportFlagIndex + 1),
);
const outputDirArg = positionalArgs[0];
const outputDir = path.resolve(outputDirArg || "data/postgres-import");
const result = executePostgresImport({ outputDir, confirm });
const report = writePostgresImportResultReport(result, {
  outputDir,
  reportPath: reportPathArg || path.join(outputDir, confirm ? postgresImportResultFileName : postgresImportPreviewFileName),
});

console.log(JSON.stringify({ ...result, reportPath: report.reportPath }, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}
