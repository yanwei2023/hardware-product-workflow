import { getBackupPath, getStorePath, restoreStoreFromBackup } from "./persistence.mjs";
import { validateStoreFile } from "./storeDoctor.mjs";

const storePath = process.argv[2] || getStorePath();
const backupPath = getBackupPath(storePath);
const backupValidation = validateStoreFile(backupPath);

if (!backupValidation.exists) {
  console.error(JSON.stringify({ ok: false, error: `backup store file not found: ${backupPath}` }, null, 2));
  process.exit(1);
}

if (!backupValidation.valid) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: "backup store file is invalid",
        backupPath,
        errors: backupValidation.errors,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const result = restoreStoreFromBackup({ storePath });
console.log(
  JSON.stringify(
    {
      ok: true,
      ...result,
    },
    null,
    2,
  ),
);
