import { preparePilotArchive } from "./pilotArchive.mjs";

const result = preparePilotArchive(process.argv[2] || "/tmp/hardware-flow-pilot-archive");

console.log(
  JSON.stringify(
    {
      outputDir: result.outputDir,
      manifestPath: result.manifestPath,
      readiness: result.manifest.readiness,
      files: result.manifest.files,
      postgresImport: result.manifest.postgresImport,
    },
    null,
    2,
  ),
);
