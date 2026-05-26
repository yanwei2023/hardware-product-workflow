create table projects (
  id text primary key,
  name text not null,
  product_line text,
  owner_user_id text not null,
  current_phase_id text,
  status text not null,
  archived_at timestamptz,
  archived_by_user_id text,
  cloned_from_project_id text,
  source_exported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table phases (
  id text primary key,
  project_id text not null references projects(id),
  name text not null,
  sequence int not null,
  phase_key text,
  status text not null,
  starts_at timestamptz,
  due_at timestamptz
);

create table gates (
  id text primary key,
  project_id text not null references projects(id),
  phase_id text not null references phases(id),
  name text not null,
  status text not null,
  approved_by_user_id text,
  approved_at timestamptz,
  approval_comment text not null default ''
);

create table role_pairs (
  id text primary key,
  project_id text not null references projects(id),
  role_key text not null,
  human_user_id text not null,
  agent_key text not null,
  agent_permission_level text not null
);

create table work_packages (
  id text primary key,
  project_id text not null references projects(id),
  phase_id text not null references phases(id),
  role_pair_id text not null references role_pairs(id),
  title text not null,
  required_artifact_type text not null,
  artifact_template_key text,
  required_for_gate boolean not null default true,
  status text not null,
  due_at timestamptz
);

create table artifact_versions (
  id text primary key,
  work_package_id text not null references work_packages(id),
  artifact_type text not null,
  version text not null,
  status text not null,
  object_key text,
  content_json jsonb not null default '{}'::jsonb,
  created_by_actor text not null,
  created_at timestamptz not null default now()
);

create table reviews (
  id text primary key,
  work_package_id text not null references work_packages(id),
  reviewer_user_id text not null,
  decision text not null,
  comment text not null default '',
  conditions jsonb not null default '[]'::jsonb,
  conditions_completed_at timestamptz,
  conditions_completed_by_user_id text,
  conditions_completion_comment text not null default '',
  reviewed_at timestamptz not null default now()
);

create table risks (
  id text primary key,
  project_id text not null references projects(id),
  phase_id text not null references phases(id),
  title text not null,
  severity text not null,
  status text not null,
  owner_role_pair_id text references role_pairs(id),
  mitigation text not null default '',
  mitigation_owner_user_id text,
  mitigation_due_at date,
  mitigation_status text,
  mitigation_updated_at timestamptz,
  mitigation_updated_by_user_id text,
  mitigation_completed_at timestamptz,
  mitigation_completed_by_user_id text,
  mitigation_completion_comment text not null default '',
  accepted_by_user_id text,
  accepted_at timestamptz,
  accepted_comment text not null default '',
  closed_by_user_id text,
  closed_at timestamptz,
  closed_comment text not null default '',
  created_by_user_id text,
  created_at timestamptz not null default now()
);

create table agent_runs (
  id text primary key,
  work_package_id text not null references work_packages(id),
  agent_key text not null,
  status text not null,
  input_refs jsonb not null default '[]'::jsonb,
  output_ref text,
  artifact_template_key text,
  required_sections jsonb not null default '[]'::jsonb,
  required_review_roles jsonb not null default '[]'::jsonb,
  validation_json jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table agent_findings (
  id text primary key,
  work_package_id text not null references work_packages(id),
  agent_run_id text not null references agent_runs(id),
  severity text not null,
  status text not null,
  message text not null,
  evidence_refs jsonb not null default '[]'::jsonb
);

create table work_package_evidence_refs (
  id text primary key,
  project_id text not null references projects(id),
  work_package_id text not null references work_packages(id),
  label text not null,
  ref text not null,
  created_by_user_id text not null,
  created_at timestamptz not null default now()
);

create table gate_approval_packs (
  id text primary key,
  project_id text not null references projects(id),
  gate_id text not null references gates(id),
  phase_id text not null references phases(id),
  approved_by_user_id text not null,
  approved_at timestamptz not null,
  approval_comment text not null default '',
  review_pack_json jsonb not null
);

create table notifications (
  id text primary key,
  project_id text references projects(id),
  user_id text not null,
  title text not null,
  message text not null default '',
  type text not null,
  status text not null,
  object_type text,
  object_id text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table audit_events (
  id text primary key,
  project_id text references projects(id),
  actor_type text not null,
  actor_id text not null,
  event_type text not null,
  object_type text not null,
  object_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table projects
  add constraint projects_current_phase_fk
  foreign key (current_phase_id) references phases(id)
  deferrable initially deferred;

create index audit_events_object_idx on audit_events(object_type, object_id);
create index audit_events_project_created_idx on audit_events(project_id, created_at);
create index artifact_versions_work_package_status_idx on artifact_versions(work_package_id, status);
create index gate_approval_packs_gate_approved_idx on gate_approval_packs(gate_id, approved_at desc);
create index notifications_user_project_status_idx on notifications(user_id, project_id, status);
create index reviews_work_package_reviewed_idx on reviews(work_package_id, reviewed_at);
create index work_package_evidence_refs_work_package_idx on work_package_evidence_refs(work_package_id);
create index work_packages_phase_status_idx on work_packages(phase_id, status);
create index risks_phase_status_idx on risks(phase_id, status, severity);
create index risks_mitigation_owner_status_idx on risks(mitigation_owner_user_id, mitigation_status);
