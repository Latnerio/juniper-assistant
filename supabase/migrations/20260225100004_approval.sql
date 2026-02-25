-- Add approval workflow
alter table user_profiles add column if not exists is_approved boolean not null default false;

-- Existing admin user is auto-approved
update user_profiles set is_approved = true where is_admin = true;
