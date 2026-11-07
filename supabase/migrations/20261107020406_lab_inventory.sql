create schema rehema_lab;
revoke all on schema rehema_lab from public, anon, authenticated, service_role;

create table rehema_lab.lab_equipment (
  id text primary key,
  kind text not null check (kind in ('monitor', 'system-unit')),
  asset_tag text not null check (length(trim(asset_tag)) between 1 and 100),
  details text not null check (jsonb_typeof(details::jsonb) = 'object'),
  revision integer not null check (revision > 0),
  updated_at text not null,
  unique (id, kind)
);

create unique index lab_equipment_asset_tag on rehema_lab.lab_equipment (lower(asset_tag));

create table rehema_lab.workstation_edits (
  number integer primary key check (number between 1 and 13),
  revision integer not null check (revision > 0),
  details text not null check (jsonb_typeof(details::jsonb) = 'object'),
  notes text not null check (jsonb_typeof(notes::jsonb) = 'array'),
  updated_at text not null,
  monitor_id text,
  system_unit_id text,
  monitor_kind text generated always as ('monitor') stored,
  system_unit_kind text generated always as ('system-unit') stored,
  constraint station_monitor_once unique (monitor_id),
  constraint station_system_unit_once unique (system_unit_id),
  constraint station_monitor_kind foreign key (monitor_id, monitor_kind)
    references rehema_lab.lab_equipment (id, kind),
  constraint station_system_unit_kind foreign key (system_unit_id, system_unit_kind)
    references rehema_lab.lab_equipment (id, kind)
);

create role rehema_lab_app nologin;
grant usage on schema rehema_lab to rehema_lab_app;
grant select, insert, update on rehema_lab.lab_equipment, rehema_lab.workstation_edits to rehema_lab_app;

alter table rehema_lab.lab_equipment enable row level security;
alter table rehema_lab.workstation_edits enable row level security;
create policy lab_app_equipment on rehema_lab.lab_equipment
  for all to rehema_lab_app using (true) with check (true);
create policy lab_app_workstations on rehema_lab.workstation_edits
  for all to rehema_lab_app using (true) with check (true);
