import path from "node:path";
import { checkPostgresPreflight } from "./postgresPreflight.mjs";

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const outputDirArg = args.find((arg) => arg !== "--strict");
const outputDir = path.resolve(outputDirArg || "data/postgres-import");
const result = checkPostgresPreflight({ outputDir, strict });

console.log(JSON.stringify(result, null, 2));

if (strict && !result.ready) {
  process.exitCode = 1;
}
