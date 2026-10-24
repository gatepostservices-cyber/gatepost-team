-- 2026-10-24 (additive). Admins/owners are always approved team members; owners can edit/delete shifts; every edit is audited.
-- 1) admins count as approved team members
create or replace function public.is_team_approved() returns boolean language sql stable security definer set search_path=public as
$$ select coalesce((select approved from public.team_members where user_id=auth.uid()),false) or public.is_admin() $$;
insert into public.team_members(user_id,name,email,approved)
  select p.id,coalesce(nullif(u.raw_user_meta_data->>'full_name',''),split_part(u.email,'@',1)),lower(u.email),true
  from public.profiles p join auth.users u on u.id=p.id where p.role in ('admin','owner') or coalesce(p.is_owner,false)
  on conflict (user_id) do update set approved=true;
-- future admins: whenever a profile becomes admin/owner, make sure they have an approved team_members row
create or replace function public.sync_admin_team_member() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.role in ('admin','owner') or coalesce(new.is_owner,false) then
    insert into public.team_members(user_id,name,email,approved)
      select new.id,coalesce(nullif(u.raw_user_meta_data->>'full_name',''),split_part(u.email,'@',1)),lower(u.email),true from auth.users u where u.id=new.id
      on conflict (user_id) do update set approved=true;
  end if; return new; end $$;
revoke execute on function public.sync_admin_team_member() from public, anon, authenticated;
drop trigger if exists profiles_admin_team_member on public.profiles;
create trigger profiles_admin_team_member after insert or update of role,is_owner on public.profiles for each row execute function public.sync_admin_team_member();

-- 2) owner edits: admin-only UPDATE/DELETE (worker insert/read policies unchanged)
drop policy if exists "team shifts admin update" on public.team_shifts;
create policy "team shifts admin update" on public.team_shifts for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "team shifts admin delete" on public.team_shifts;
create policy "team shifts admin delete" on public.team_shifts for delete to authenticated using ((select public.is_admin()));
drop policy if exists "paths admin update" on public.team_shift_paths;
create policy "paths admin update" on public.team_shift_paths for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "paths admin delete" on public.team_shift_paths;
create policy "paths admin delete" on public.team_shift_paths for delete to authenticated using ((select public.is_admin()));
grant update,delete on public.team_shifts to authenticated;
grant update,delete on public.team_shift_paths to authenticated;

-- 3) audit log, written only by trigger
create table if not exists public.team_shift_edits(
  id bigint generated always as identity primary key,
  shift_id uuid not null,
  action text not null check (action in ('update','delete')),
  edited_by uuid default auth.uid(),
  edited_at timestamptz not null default now(),
  old jsonb, new jsonb);
alter table public.team_shift_edits enable row level security;
drop policy if exists "edits admin read" on public.team_shift_edits;
create policy "edits admin read" on public.team_shift_edits for select to authenticated using ((select public.is_admin()));
grant select on public.team_shift_edits to authenticated;
create or replace function public.log_team_shift_edit() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='UPDATE' then insert into public.team_shift_edits(shift_id,action,edited_by,old,new) values(old.id,'update',auth.uid(),to_jsonb(old),to_jsonb(new)); return new;
  else insert into public.team_shift_edits(shift_id,action,edited_by,old,new) values(old.id,'delete',auth.uid(),to_jsonb(old),null); return old; end if; end $$;
revoke execute on function public.log_team_shift_edit() from public, anon, authenticated;
drop trigger if exists team_shifts_audit on public.team_shifts;
create trigger team_shifts_audit after update or delete on public.team_shifts for each row execute function public.log_team_shift_edit();
-- team_my_hours() reads team_shifts live, so edits/deletes show on the worker's next sync.

-- 4) test access: every current route for existing admins (Christian, Nate)
insert into public.route_assignments(user_id,route_id,assigned_by)
  select p.id,r,p.id from public.profiles p cross join unnest(array['Vista_Grande_Villa_Verde','South_Rio_Rancho_Numbered_Streets','Star_Heights_Arlene_Rd']) r
  join auth.users u on u.id=p.id where lower(u.email) in ('moseley0christian@icloud.com','nmessina@gatepost.services') and p.role in ('admin','owner') on conflict (user_id,route_id) do nothing;
