function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function json(value, fallback) {
  return value === undefined ? fallback : value;
}

function timestamp(value) {
  return value || new Date(0).toISOString();
}

export const postgresTableNames = [
  "projects",
  "phases",
  "gates",
  "role_pairs",
  "work_packages",
  "gate_requirements",
  "artifact_versions",
  "reviews",
  "risks",
  "agent_runs",
  "agent_jobs",
  "agent_findings",
  "work_package_evidence_refs",
  "gate_approval_packs",
  "notifications",
  "audit_events",
];

const jsonbColumns = new Set([
  "content_json",
  "conditions",
  "input_refs",
  "required_sections",
  "required_review_roles",
  "validation_json",
  "evidence_refs",
  "review_pack_json",
  "payload",
]);

function escapeSqlString(value) {
  return String(value).replaceAll("'", "''");
}

function sqlLiteral(column, value) {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (jsonbColumns.has(column)) {
    return `'${escapeSqlString(JSON.stringify(value))}'::jsonb`;
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }
  return `'${escapeSqlString(value)}'`;
}

function renderUpsertClause(columns) {
  const mutableColumns = columns.filter((column) => column !== "id");
  if (mutableColumns.length === 0) {
    return "ON CONFLICT (id) DO NOTHING";
  }
  return `ON CONFLICT (id) DO UPDATE SET ${mutableColumns.map((column) => `${column} = EXCLUDED.${column}`).join(", ")}`;
}

function resolveRequirementWorkPackageId(requirement, gatesById, workPackages) {
  if (requirement.workPackageId) {
    return requirement.workPackageId;
  }

  const gate = gatesById.get(requirement.gateId);
  const match = workPackages.find(
    (workPackage) =>
      workPackage.projectId === gate?.projectId &&
      workPackage.phaseId === gate?.phaseId &&
      workPackage.requiredArtifactType === requirement.requiredArtifactType,
  );
  return match?.id || null;
}

export function renderPostgresSeedSql(rows) {
  const lines = [
    "-- Generated from hardware-product-workflow JSON store.",
    "-- Safe to run against an empty schema created from schemas/database.sql.",
    "BEGIN;",
    "SET CONSTRAINTS ALL DEFERRED;",
    "",
  ];

  for (const table of postgresTableNames) {
    const tableRows = asArray(rows[table]);
    if (tableRows.length === 0) {
      lines.push(`-- ${table}: 0 rows`, "");
      continue;
    }

    const columns = Object.keys(tableRows[0]);
    lines.push(`-- ${table}: ${tableRows.length} rows`);
    lines.push(`INSERT INTO ${table} (${columns.join(", ")}) VALUES`);
    lines.push(
      tableRows
        .map((row) => `  (${columns.map((column) => sqlLiteral(column, row[column])).join(", ")})`)
        .join(",\n") + `\n${renderUpsertClause(columns)};`,
    );
    lines.push("");
  }

  lines.push("COMMIT;", "");
  return lines.join("\n");
}

export function mapStoreToPostgresRows(store) {
  const gates = asArray(store.gates);
  const workPackages = asArray(store.workPackages);
  const gatesById = new Map(gates.map((gate) => [gate.id, gate]));

  return {
    projects: asArray(store.projects).map((project) => ({
      id: project.id,
      name: project.name,
      product_line: project.productLine || null,
      owner_user_id: project.ownerUserId || "user-project-manager",
      current_phase_id: project.currentPhaseId || null,
      status: project.status,
      archived_at: project.archivedAt || null,
      archived_by_user_id: project.archivedByUserId || null,
      cloned_from_project_id: project.clonedFromProjectId || null,
      source_exported_at: project.sourceExportedAt || null,
      created_at: timestamp(project.createdAt),
      updated_at: timestamp(project.updatedAt || project.createdAt),
    })),
    phases: asArray(store.phases).map((phase) => ({
      id: phase.id,
      project_id: phase.projectId,
      name: phase.name,
      sequence: phase.sequence,
      phase_key: phase.phaseKey || null,
      status: phase.status,
      starts_at: phase.startsAt || null,
      due_at: phase.dueAt || null,
    })),
    gates: gates.map((gate) => ({
      id: gate.id,
      project_id: gate.projectId,
      phase_id: gate.phaseId,
      name: gate.name,
      status: gate.status,
      approved_by_user_id: gate.approvedByUserId || null,
      approved_at: gate.approvedAt || null,
      approval_comment: gate.approvalComment || "",
    })),
    role_pairs: asArray(store.rolePairs).map((pair) => ({
      id: pair.id,
      project_id: pair.projectId,
      role_key: pair.roleKey,
      human_user_id: pair.humanUserId,
      agent_key: pair.agentKey,
      agent_permission_level: pair.agentPermissionLevel || "L1_DRAFT",
    })),
    work_packages: workPackages.map((workPackage) => ({
      id: workPackage.id,
      project_id: workPackage.projectId,
      phase_id: workPackage.phaseId,
      role_pair_id: workPackage.rolePairId,
      title: workPackage.title,
      required_artifact_type: workPackage.requiredArtifactType,
      artifact_template_key: workPackage.artifactTemplateKey || null,
      required_for_gate: workPackage.requiredForGate !== false,
      status: workPackage.status,
      due_at: workPackage.dueAt || null,
    })),
    gate_requirements: asArray(store.gateRequirements).map((requirement) => ({
      id: requirement.id,
      gate_id: requirement.gateId,
      work_package_id: resolveRequirementWorkPackageId(requirement, gatesById, workPackages),
      required_artifact_type: requirement.requiredArtifactType,
    })),
    artifact_versions: asArray(store.artifactVersions).map((artifact) => ({
      id: artifact.id,
      work_package_id: artifact.workPackageId,
      artifact_type: artifact.artifactType,
      version: artifact.version,
      status: artifact.status,
      object_key: artifact.objectKey || null,
      content_json: json(artifact.content, {}),
      created_by_actor: artifact.createdByActor,
      created_at: timestamp(artifact.createdAt),
    })),
    reviews: asArray(store.reviews).map((review) => ({
      id: review.id,
      work_package_id: review.workPackageId,
      reviewer_user_id: review.reviewerUserId,
      decision: review.decision,
      comment: review.comment || "",
      conditions: json(review.conditions, []),
      conditions_completed_at: review.conditionsCompletedAt || null,
      conditions_completed_by_user_id: review.conditionsCompletedByUserId || null,
      conditions_completion_comment: review.conditionsCompletionComment || "",
      reviewed_at: review.reviewedAt,
    })),
    risks: asArray(store.risks).map((risk) => ({
      id: risk.id,
      project_id: risk.projectId,
      phase_id: risk.phaseId,
      title: risk.title,
      severity: risk.severity,
      status: risk.status,
      owner_role_pair_id: risk.ownerRolePairId || null,
      mitigation: risk.mitigation || "",
      mitigation_owner_user_id: risk.mitigationOwnerUserId || null,
      mitigation_due_at: risk.mitigationDueAt || null,
      mitigation_status: risk.mitigationStatus || null,
      mitigation_updated_at: risk.mitigationUpdatedAt || null,
      mitigation_updated_by_user_id: risk.mitigationUpdatedByUserId || null,
      mitigation_completed_at: risk.mitigationCompletedAt || null,
      mitigation_completed_by_user_id: risk.mitigationCompletedByUserId || null,
      mitigation_completion_comment: risk.mitigationCompletionComment || "",
      accepted_by_user_id: risk.acceptedByUserId || null,
      accepted_at: risk.acceptedAt || null,
      accepted_comment: risk.acceptedComment || "",
      closed_by_user_id: risk.closedByUserId || null,
      closed_at: risk.closedAt || null,
      closed_comment: risk.closedComment || "",
      created_by_user_id: risk.createdByUserId || null,
      created_at: timestamp(risk.createdAt),
    })),
    agent_runs: asArray(store.agentRuns).map((run) => ({
      id: run.id,
      work_package_id: run.workPackageId,
      agent_key: run.agentKey,
      status: run.status,
      input_refs: json(run.inputRefs, []),
      output_ref: run.outputRef || null,
      artifact_template_key: run.artifactTemplateKey || null,
      required_sections: json(run.requiredSections, []),
      required_review_roles: json(run.requiredReviewRoles, []),
      validation_json: run.validation || null,
      created_at: run.createdAt || null,
      completed_at: run.completedAt || null,
    })),
    agent_jobs: asArray(store.agentJobs).map((job) => ({
      id: job.id,
      project_id: job.projectId,
      work_package_id: job.workPackageId,
      agent_key: job.agentKey,
      input_refs: json(job.inputRefs, []),
      draft_markdown: job.draftMarkdown || null,
      requested_by_user_id: job.requestedByUserId,
      status: job.status,
      created_at: timestamp(job.createdAt),
      started_at: job.startedAt || null,
      completed_at: job.completedAt || null,
      result_status_code: job.resultStatusCode ?? null,
      agent_run_id: job.agentRunId || null,
      error: job.error || "",
    })),
    agent_findings: asArray(store.agentFindings).map((finding) => ({
      id: finding.id,
      work_package_id: finding.workPackageId,
      agent_run_id: finding.agentRunId,
      severity: finding.severity,
      status: finding.status,
      message: finding.message,
      evidence_refs: json(finding.evidenceRefs, []),
    })),
    work_package_evidence_refs: asArray(store.evidenceRefs).map((ref) => ({
      id: ref.id,
      project_id: ref.projectId,
      work_package_id: ref.workPackageId,
      label: ref.label,
      ref: ref.ref,
      created_by_user_id: ref.createdByUserId,
      created_at: ref.createdAt,
    })),
    gate_approval_packs: asArray(store.gateApprovalPacks).map((pack) => ({
      id: pack.id,
      project_id: pack.projectId,
      gate_id: pack.gateId,
      phase_id: pack.phaseId,
      approved_by_user_id: pack.approvedByUserId,
      approved_at: pack.approvedAt,
      approval_comment: pack.approvalComment || "",
      review_pack_json: pack.reviewPack,
    })),
    notifications: asArray(store.notifications).map((notification) => ({
      id: notification.id,
      project_id: notification.projectId || null,
      user_id: notification.userId,
      title: notification.title,
      message: notification.message || "",
      type: notification.type,
      status: notification.status,
      object_type: notification.objectType || null,
      object_id: notification.objectId || null,
      created_at: notification.createdAt,
      read_at: notification.readAt || null,
    })),
    audit_events: asArray(store.auditEvents).map((event) => ({
      id: event.id,
      project_id: event.projectId || null,
      actor_type: event.actorType,
      actor_id: event.actorId,
      event_type: event.eventType,
      object_type: event.objectType,
      object_id: event.objectId,
      payload: json(event.payload, {}),
      created_at: event.createdAt,
    })),
  };
}
