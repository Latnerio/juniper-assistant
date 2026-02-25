alter table screenshot_index add column if not exists topics text[] default '{}';
alter table screenshot_index drop constraint if exists screenshot_index_filename_key;
alter table screenshot_index add constraint screenshot_index_filename_key unique (filename);
-- Make lesson_id and page_id nullable since we're using topic-based indexing
alter table screenshot_index alter column lesson_id drop not null;
alter table screenshot_index alter column page_id drop not null;
