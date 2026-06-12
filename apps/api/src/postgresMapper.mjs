function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function json(value, fallback) {
  return value === undefined ? fallback : value;
}

function timestamp(value) {
  return value || new Date(0).toISOString();
}

function runtimeTimestamp(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value || null;
}

function runtimeJson(value, fallback) {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (error) {
      throw new Error(`invalid serialized PostgreSQL JSON value: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return value;
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

export function mapPostgresRowsToStore(rows, { activeProjectId = null } = {}) {
  const projects = asArray(rows.projects).map((project) => ({
    id: project.id,
    name: project.name,
    productLine: project.product_line,
    ownerUserId: project.owner_user_id,
    currentPhaseId: project.current_phase_id,
    status: project.status,
    archivedAt: runtimeTimestamp(project.archived_at),
    archivedByUserId: project.archived_by_user_id,
    clonedFromProjectId: project.cloned_from_project_id,
    sourceExportedAt: runtimeTimestamp(project.source_exported_at),
    createdAt: runtimeTimestamp(project.created_at),
    updatedAt: runtimeTimestamp(project.updated_at),
  }));
  const workPackages = asArray(rows.work_packages).map((workPackage) => ({
    id: workPackage.id,
    projectId: workPackage.project_id,
    phaseId: workPackage.phase_id,
    rolePairId: workPackage.role_pair_id,
    title: workPackage.title,
    requiredArtifactType: workPackage.required_artifact_type,
    artifactTemplateKey: workPackage.artifact_template_key,
    requiredForGate: workPackage.required_for_gate !== false,
    status: workPackage.status,
    dueAt: runtimeTimestamp(workPackage.due_at),
  }));
  const workPackagesById = new Map(workPackages.map((item) => [item.id, item]));
  const selectedProjectId =
    (activeProjectId && projects.some((project) => project.id === activeProjectId) ? activeProjectId : null) ||
    projects.find((project) => project.status !== "ARCHIVED")?.id ||
    projects[0]?.id ||
    null;

  return {
    activeProjectId: selectedProjectId,
    projects,
    phases: asArray(rows.phases).map((phase) => ({
      id: phase.id,
      projectId: phase.project_id,
      name: phase.name,
      sequence: phase.sequence,
      phaseKey: phase.phase_key,
      status: phase.status,
      startsAt: runtimeTimestamp(phase.starts_at),
      dueAt: runtimeTimestamp(phase.due_at),
    })),
    gates: asArray(rows.gates).map((gate) => ({
      id: gate.id,
      projectId: gate.project_id,
      phaseId: gate.phase_id,
      name: gate.name,
      status: gate.status,
      approvedByUserId: gate.approved_by_user_id,
      approvedAt: runtimeTimestamp(gate.approved_at),
      approvalComment: gate.approval_comment || "",
    })),
    rolePairs: asArray(rows.role_pairs).map((pair) => ({
      id: pair.id,
      projectId: pair.project_id,
      roleKey: pair.role_key,
      humanUserId: pair.human_user_id,
      agentKey: pair.agent_key,
      agentPermissionLevel: pair.agent_permission_level,
    })),
    workPackages,
    gateRequirements: asArray(rows.gate_requirements).map((requirement) => ({
      id: requirement.id,
      gateId: requirement.gate_id,
      workPackageId: requirement.work_package_id,
      requiredWorkPackageTitle: workPackagesById.get(requirement.work_package_id)?.title || null,
      requiredArtifactType: requirement.required_artifact_type,
    })),
    artifactVersions: asArray(rows.artifact_versions).map((artifact) => ({
      id: artifact.id,
      workPackageId: artifact.work_package_id,
      artifactType: artifact.artifact_type,
      version: artifact.version,
      status: artifact.status,
      objectKey: artifact.object_key,
      content: runtimeJson(artifact.content_json, {}),
      createdByActor: artifact.created_by_actor,
      createdAt: runtimeTimestamp(artifact.created_at),
    })),
    reviews: asArray(rows.reviews).map((review) => ({
      id: review.id,
      workPackageId: review.work_package_id,
      reviewerUserId: review.reviewer_user_id,
      decision: review.decision,
      comment: review.comment || "",
      conditions: runtimeJson(review.conditions, []),
      conditionsCompletedAt: runtimeTimestamp(review.conditions_completed_at),
      conditionsCompletedByUserId: review.conditions_completed_by_user_id,
      conditionsCompletionComment: review.conditions_completion_comment || "",
      reviewedAt: runtimeTimestamp(review.reviewed_at),
    })),
    risks: asArray(rows.risks).map((risk) => ({
      id: risk.id,
      projectId: risk.project_id,
      phaseId: risk.phase_id,
      title: risk.title,
      severity: risk.severity,
      status: risk.status,
      ownerRolePairId: risk.owner_role_pair_id,
      mitigation: risk.mitigation || "",
      mitigationOwnerUserId: risk.mitigation_owner_user_id,
      mitigationDueAt: risk.mitigation_due_at,
      mitigationStatus: risk.mitigation_status,
      mitigationUpdatedAt: runtimeTimestamp(risk.mitigation_updated_at),
      mitigationUpdatedByUserId: risk.mitigation_updated_by_user_id,
      mitigationCompletedAt: runtimeTimestamp(risk.mitigation_completed_at),
      mitigationCompletedByUserId: risk.mitigation_completed_by_user_id,
      mitigationCompletionComment: risk.mitigation_completion_comment || "",
      acceptedByUserId: risk.accepted_by_user_id,
      acceptedAt: runtimeTimestamp(risk.accepted_at),
      acceptedComment: risk.accepted_comment || "",
      closedByUserId: risk.closed_by_user_id,
      closedAt: runtimeTimestamp(risk.closed_at),
      closedComment: risk.closed_comment || "",
      createdByUserId: risk.created_by_user_id,
      createdAt: runtimeTimestamp(risk.created_at),
    })),
    agentRuns: asArray(rows.agent_runs).map((run) => ({
      id: run.id,
      workPackageId: run.work_package_id,
      agentKey: run.agent_key,
      status: run.status,
      inputRefs: runtimeJson(run.input_refs, []),
      outputRef: run.output_ref,
      artifactTemplateKey: run.artifact_template_key,
      requiredSections: runtimeJson(run.required_sections, []),
      requiredReviewRoles: runtimeJson(run.required_review_roles, []),
      validation: runtimeJson(run.validation_json, null),
      createdAt: runtimeTimestamp(run.created_at),
      completedAt: runtimeTimestamp(run.completed_at),
    })),
    agentJobs: asArray(rows.agent_jobs).map((job) => ({
      id: job.id,
      projectId: job.project_id,
      workPackageId: job.work_package_id,
      agentKey: job.agent_key,
      inputRefs: runtimeJson(job.input_refs, []),
      draftMarkdown: job.draft_markdown,
      requestedByUserId: job.requested_by_user_id,
      status: job.status,
      createdAt: runtimeTimestamp(job.created_at),
      startedAt: runtimeTimestamp(job.started_at),
      completedAt: runtimeTimestamp(job.completed_at),
      resultStatusCode: job.result_status_code,
      agentRunId: job.agent_run_id,
      error: job.error || "",
    })),
    agentFindings: asArray(rows.agent_findings).map((finding) => ({
      id: finding.id,
      workPackageId: finding.work_package_id,
      agentRunId: finding.agent_run_id,
      severity: finding.severity,
      status: finding.status,
      message: finding.message,
      evidenceRefs: runtimeJson(finding.evidence_refs, []),
    })),
    evidenceRefs: asArray(rows.work_package_evidence_refs).map((ref) => ({
      id: ref.id,
      projectId: ref.project_id,
      workPackageId: ref.work_package_id,
      label: ref.label,
      ref: ref.ref,
      createdByUserId: ref.created_by_user_id,
      createdAt: runtimeTimestamp(ref.created_at),
    })),
    gateApprovalPacks: asArray(rows.gate_approval_packs).map((pack) => ({
      id: pack.id,
      projectId: pack.project_id,
      gateId: pack.gate_id,
      phaseId: pack.phase_id,
      approvedByUserId: pack.approved_by_user_id,
      approvedAt: runtimeTimestamp(pack.approved_at),
      approvalComment: pack.approval_comment || "",
      reviewPack: runtimeJson(pack.review_pack_json, {}),
    })),
    notifications: asArray(rows.notifications).map((notification) => ({
      id: notification.id,
      projectId: notification.project_id,
      userId: notification.user_id,
      title: notification.title,
      message: notification.message || "",
      type: notification.type,
      status: notification.status,
      objectType: notification.object_type,
      objectId: notification.object_id,
      createdAt: runtimeTimestamp(notification.created_at),
      readAt: runtimeTimestamp(notification.read_at),
    })),
    auditEvents: asArray(rows.audit_events).map((event) => ({
      id: event.id,
      projectId: event.project_id,
      actorType: event.actor_type,
      actorId: event.actor_id,
      eventType: event.event_type,
      objectType: event.object_type,
      objectId: event.object_id,
      payload: runtimeJson(event.payload, {}),
      createdAt: runtimeTimestamp(event.created_at),
    })),
  };
}
