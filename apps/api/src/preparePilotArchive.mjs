import { preparePilotArchive } from "./pilotArchive.mjs";

const result = preparePilotArchive(process.argv[2] || "/tmp/hardware-flow-pilot-archive");

console.log(
  JSON.stringify(
    {
      outputDir: result.outputDir,
      manifestPath: result.manifestPath,
      readiness: result.manifest.readiness,
      operations: result.manifest.operations,
      commands: result.manifest.commands,
      acceptanceCriteria: result.manifest.acceptanceCriteria,
      boundaries: result.manifest.boundaries,
      dataProtection: result.manifest.dataProtection,
      checklist: result.manifest.checklist,
      diagnostics: result.manifest.diagnostics,
      files: result.manifest.files,
      postgresImport: result.manifest.postgresImport,
    },
    null,
    2,
  ),
);
