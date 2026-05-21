create table projects (
  id text primary key,
  name text not null,
  product_line text,
  owner_user_id text not null,
  status text not null,
  created_at timestamptz not null default now()
);

create table phases (
  id text primary key,
  project_id text not null references projects(id),
  name text not null,
  sequence int not null,
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
  approved_at timestamptz
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
  content_json jsonb,
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
  accepted_by_user_id text
);

create table agent_runs (
  id text primary key,
  work_package_id text not null references work_packages(id),
  agent_key text not null,
  status text not null,
  input_refs jsonb not null default '[]'::jsonb,
  output_ref text,
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

create table audit_events (
  id text primary key,
  project_id text,
  actor_type text not null,
  actor_id text not null,
  event_type text not null,
  object_type text not null,
  object_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_object_idx on audit_events(object_type, object_id);
create index work_packages_phase_status_idx on work_packages(phase_id, status);
create index risks_phase_status_idx on risks(phase_id, status, severity);

