import { preparePilotArchive } from "./pilotArchive.mjs";

const result = preparePilotArchive(process.argv[2] || "/tmp/hardware-flow-pilot-archive");

console.log(
  JSON.stringify(
    {
      outputDir: result.outputDir,
      manifestPath: result.manifestPath,
      readiness: result.manifest.readiness,
      operations: result.manifest.operations,
      launch: result.manifest.launch,
      commands: result.manifest.commands,
      brief: result.manifest.files.briefMarkdown,
      launchSummary: result.manifest.files.pilotLaunchJson,
      rollbackCard: result.manifest.files.rollbackCardMarkdown,
      acceptanceCriteria: result.manifest.acceptanceCriteria,
      boundaries: result.manifest.boundaries,
      runbookSteps: result.manifest.runbookSteps,
      issueReport: result.manifest.issueReport,
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
