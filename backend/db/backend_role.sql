-- The login role the backend uses (run once per project, as the project owner). The password is
-- generated at deploy time and kept only in the backend host's AERA_DATABASE_URL; it is never
-- committed. Connection string (Supavisor session pooler, IPv4):
--   postgresql://aera_backend.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require

-- create role aera_backend login password '<generated>';
-- create rights are needed to take ownership of the tables
grant usage, create on schema aera to aera_backend;
alter table aera.settings  owner to aera_backend;
alter table aera.users     owner to aera_backend;
alter table aera.devices   owner to aera_backend;
alter table aera.incidents owner to aera_backend;
alter table aera.audit_log owner to aera_backend;
