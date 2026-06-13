import { createDemoStore } from "./demoStoreFactory.mjs";
import { loadStoreFromDisk } from "./persistence.mjs";
import { checkRuntimePersistenceStartup } from "./runtimePersistence.mjs";
import { bootstrapRuntimeStore } from "./runtimeStoreBootstrap.mjs";

try {
  const runtime = bootstrapRuntimeStore({
    localStore: loadStoreFromDisk(),
    createFallbackStore: createDemoStore,
    activeProjectId: process.env.HARDWARE_FLOW_POSTGRES_ACTIVE_PROJECT_ID || null,
  });
  const result = checkRuntimePersistenceStartup({ initialStore: runtime.store });

  console.log(JSON.stringify({ runtimeSource: runtime.status, ...result }, null, 2));
  if (!result.ready) {
    process.exitCode = 1;
  }
} catch (error) {
  console.log(JSON.stringify({
    ready: false,
    errors: [error instanceof Error ? error.message : String(error)],
  }, null, 2));
  process.exitCode = 1;
}
