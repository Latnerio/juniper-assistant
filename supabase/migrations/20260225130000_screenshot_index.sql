create table if not exists screenshot_index (
  id serial primary key,
  lesson_id text not null,
  page_id int not null,
  filename text not null,
  storage_path text not null,
  public_url text not null,
  title text,
  context text,
  original_url text
);
