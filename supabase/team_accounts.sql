-- Gatepost Team accounts (additive). Existing team_shifts rows and anon inserts keep working.
create table if not exists public.team_members(
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text not null default '',
  approved boolean not null default false,
  created_at timestamptz not null default now());
alter table public.team_members enable row level security;
drop policy if exists "tm own read" on public.team_members;
create policy "tm own read" on public.team_members for select to authenticated using (user_id=(select auth.uid()) or (select public.is_admin()));
drop policy if exists "tm admin update" on public.team_members;
create policy "tm admin update" on public.team_members for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "tm admin delete" on public.team_members;
create policy "tm admin delete" on public.team_members for delete to authenticated using ((select public.is_admin()));
grant select,update,delete on public.team_members to authenticated;
-- profile row is created server-side for sign-ups tagged signup_as=team (works with email confirmation on)
create or replace function public.handle_new_team_member() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if coalesce(new.raw_user_meta_data->>'signup_as','')='team' then
    insert into public.team_members(user_id,name,email) values(new.id,left(coalesce(new.raw_user_meta_data->>'full_name',''),80),lower(new.email)) on conflict do nothing;
  end if; return new; end $$;
revoke execute on function public.handle_new_team_member() from public, anon, authenticated;
drop trigger if exists on_auth_user_created_team on auth.users;
create trigger on_auth_user_created_team after insert on auth.users for each row execute function public.handle_new_team_member();
create or replace function public.is_team_approved() returns boolean language sql stable security definer set search_path=public as
$$ select coalesce((select approved from public.team_members where user_id=auth.uid()),false) $$;

-- shifts
alter table public.team_shifts add column if not exists user_id uuid references auth.users(id) on delete set null;
create index if not exists team_shifts_user_idx on public.team_shifts(user_id);
grant insert on public.team_shifts to authenticated;
drop policy if exists "team shifts member insert" on public.team_shifts;
create policy "team shifts member insert" on public.team_shifts for insert to authenticated with check (user_id=(select auth.uid()) and (select public.is_team_approved()));
drop policy if exists "team shifts own read" on public.team_shifts;
create policy "team shifts own read" on public.team_shifts for select to authenticated using (user_id=(select auth.uid()));
-- worker-facing hours (no houses/pace/miles)
create or replace function public.team_my_hours() returns table(id uuid,clock_in timestamptz,clock_out timestamptz,hours numeric)
language sql stable security invoker set search_path=public as
$$ select id,clock_in,clock_out,hours from public.team_shifts where user_id=auth.uid() order by clock_in desc $$;
grant execute on function public.team_my_hours() to authenticated;

-- route assignments (route_id = index.json neighborhood slug)
create table if not exists public.route_assignments(
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  route_id text not null,
  assigned_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique(user_id,route_id));
alter table public.route_assignments enable row level security;
drop policy if exists "ra own read" on public.route_assignments;
create policy "ra own read" on public.route_assignments for select to authenticated using (user_id=(select auth.uid()));
drop policy if exists "ra admin all" on public.route_assignments;
create policy "ra admin all" on public.route_assignments for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
grant select,insert,update,delete on public.route_assignments to authenticated;

-- walked GPS path per shift: worker inserts own, admin-only read
create table if not exists public.team_shift_paths(
  shift_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  points jsonb not null default '[]',
  created_at timestamptz not null default now());
alter table public.team_shift_paths enable row level security;
drop policy if exists "paths member insert" on public.team_shift_paths;
create policy "paths member insert" on public.team_shift_paths for insert to authenticated with check (user_id=(select auth.uid()) and (select public.is_team_approved()));
drop policy if exists "paths admin read" on public.team_shift_paths;
create policy "paths admin read" on public.team_shift_paths for select to authenticated using ((select public.is_admin()));
drop policy if exists "paths admin delete" on public.team_shift_paths;
create policy "paths admin delete" on public.team_shift_paths for delete to authenticated using ((select public.is_admin()));
grant select,insert,delete on public.team_shift_paths to authenticated;
