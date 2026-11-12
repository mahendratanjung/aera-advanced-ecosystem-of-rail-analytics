-- AERA durable records (settings, staff users, devices, incidents, audit log) for Supabase
-- Postgres. Applied as the Supabase migration "aera_schema"; safe to run again.
--
-- The tables sit in their own "aera" schema, which Supabase does not expose through its REST
-- API, so nothing here is reachable with the public anon key. The backend connects as the
-- "aera_backend" login role (created separately with its own password) through the pooler.

create schema if not exists aera;

create table if not exists aera.settings (
  id          smallint primary key default 1 check (id = 1),
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

create table if not exists aera.users (
  id             text primary key,
  email          text not null unique,
  display_name   text not null,
  role           text not null check (role in ('operator', 'admin')),
  station_id     text,
  password_hash  text not null,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Parked IoT devices: kept as one JSON document each (the model may still change).
create table if not exists aera.devices (
  id          text primary key,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

create table if not exists aera.incidents (
  id             text primary key,
  station_id     text not null,
  zone_id        text,
  type           text not null,
  description    text not null,
  alert_id       text,
  created_by     text not null,
  created_at_ms  bigint not null
);
create index if not exists incidents_created_at on aera.incidents (created_at_ms desc);

create table if not exists aera.audit_log (
  id          text primary key,
  actor       text not null,
  action      text not null,
  target      text not null,
  station_id  text,
  before      jsonb,
  after       jsonb,
  ts_ms       bigint not null
);
create index if not exists audit_log_ts on aera.audit_log (ts_ms desc);

-- Belt and braces: row level security on, no policies, so even if the schema were exposed
-- the anon and authenticated roles could read nothing. The backend role is made the tables'
-- owner (db/backend_role.sql), and owners are not subject to RLS.
alter table aera.settings  enable row level security;
alter table aera.users     enable row level security;
alter table aera.devices   enable row level security;
alter table aera.incidents enable row level security;
alter table aera.audit_log enable row level security;

revoke all on schema aera from public, anon, authenticated;
revoke all on all tables in schema aera from public, anon, authenticated;
