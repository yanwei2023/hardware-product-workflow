import fs from "node:fs";
import path from "node:path";

const storePath = path.resolve(process.argv[2] || "data/demo-store.json");
if (!fs.existsSync(storePath)) {
  console.error(JSON.stringify({ valid: false, storePath, errors: [`store file is missing: ${storePath}`] }, null, 2));
  process.exit(1);
}

process.env.HARDWARE_FLOW_STORE_PATH = storePath;
process.env.HARDWARE_FLOW_ACCESS_LOG = "0";

const { checkGate, getActiveProjectView, getStorageDoctorStatus } = await import("./server.mjs");
const doctor = getStorageDoctorStatus();
const project = getActiveProjectView();
const gate = project?.gates?.find((item) => item.phaseId === project?.project?.currentPhaseId) || null;
const gateCheck = gate ? checkGate(gate.id) : null;
const errors = [];

if (!doctor.valid) {
  errors.push(...doctor.errors);
}
if (!project?.project?.id) {
  errors.push("active project read model is unavailable");
}
if (!Array.isArray(project?.phases) || project.phases.length === 0) {
  errors.push("active project phases are unavailable");
}
if (!Array.isArray(project?.workPackages) || project.workPackages.length === 0) {
  errors.push("active project work packages are unavailable");
}
if (gate && !gateCheck) {
  errors.push(`current gate check is unavailable: ${gate.id}`);
}

const result = {
  valid: errors.length === 0,
  storePath,
  errors,
  projectId: project?.project?.id || null,
  currentPhaseId: project?.project?.currentPhaseId || null,
  currentGateId: gate?.id || null,
  gateStatus: gateCheck?.status || null,
  projectSummary: project?.projectSummaries?.find((item) => item.id === project?.project?.id) || null,
  scheduleSummary: project?.scheduleSummary || null,
};

console.log(JSON.stringify(result, null, 2));

if (!result.valid) {
  process.exitCode = 1;
}
