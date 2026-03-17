create table public.message_reactions (
  id            uuid         primary key default gen_random_uuid(),
  message_id    uuid         not null references public.memo_messages(id) on delete cascade,
  user_id       text         not null references public.users(id) on delete cascade,
  reaction_type text         not null,
  created_at    timestamptz  not null default now(),
  unique (message_id, user_id, reaction_type)
);

create index message_reactions_message_idx
  on public.message_reactions (message_id, created_at desc);

alter table public.message_reactions enable row level security;
