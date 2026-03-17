create table public.memo_rooms (
  id            uuid         primary key default gen_random_uuid(),
  owner_user_id text         not null references public.users(id) on delete cascade,
  title         text         not null,
  description   text,
  created_at    timestamptz  not null default now()
);

create index memo_rooms_owner_created_idx
  on public.memo_rooms (owner_user_id, created_at desc);

create table public.memo_room_memos (
  memo_room_id uuid         not null references public.memo_rooms(id) on delete cascade,
  memo_id      uuid         not null references public.memos(id) on delete cascade,
  created_at   timestamptz  not null default now(),
  primary key (memo_room_id, memo_id)
);

create index memo_room_memos_memo_idx
  on public.memo_room_memos (memo_id, memo_room_id);

create table public.memo_room_participants (
  id                 uuid         primary key default gen_random_uuid(),
  memo_room_id       uuid         not null references public.memo_rooms(id) on delete cascade,
  participant_type   text         not null check (participant_type in ('human', 'agent', 'system')),
  user_id            text         references public.users(id) on delete cascade,
  agent_id           uuid,
  system_key         text,
  role               text         not null check (role in ('owner', 'member', 'guest', 'observer')),
  capability         text         not null check (capability in ('read_only', 'comment_only', 'full_participation')),
  default_visibility text         not null check (default_visibility in ('public', 'owner_only', 'restricted')),
  status             text         not null default 'active' check (status in ('active', 'removed')),
  invited_by_user_id text         references public.users(id) on delete set null,
  created_at         timestamptz  not null default now(),
  removed_at         timestamptz,
  constraint memo_room_participants_identity_check check (
    (
      participant_type = 'human'
      and user_id is not null
      and agent_id is null
      and system_key is null
    ) or (
      participant_type = 'agent'
      and user_id is null
      and agent_id is not null
      and system_key is null
    ) or (
      participant_type = 'system'
      and user_id is null
      and agent_id is null
      and system_key is not null
    )
  )
);

create unique index memo_room_participants_room_user_unique
  on public.memo_room_participants (memo_room_id, user_id)
  where user_id is not null;

create unique index memo_room_participants_room_agent_unique
  on public.memo_room_participants (memo_room_id, agent_id)
  where agent_id is not null;

create unique index memo_room_participants_room_system_unique
  on public.memo_room_participants (memo_room_id, system_key)
  where system_key is not null;

create index memo_room_participants_room_status_idx
  on public.memo_room_participants (memo_room_id, status, created_at);

create index memo_room_participants_room_status_identity_idx
  on public.memo_room_participants (memo_room_id, status, id);

create table public.memo_messages (
  id                       uuid         primary key,
  memo_room_id             uuid         not null references public.memo_rooms(id) on delete cascade,
  memo_id                  uuid         not null references public.memos(id) on delete cascade,
  author_participant_id    uuid         not null references public.memo_room_participants(id) on delete cascade,
  content                  text         not null,
  visibility               text         not null check (visibility in ('public', 'owner_only', 'restricted')),
  restricted_participant_ids uuid[],
  reply_to_message_id      uuid         references public.memo_messages(id) on delete cascade,
  root_message_id          uuid         not null references public.memo_messages(id) on delete cascade,
  anchor_start_ms          integer,
  anchor_end_ms            integer,
  anchor_segment_ids       bigint[],
  created_at               timestamptz  not null default now(),
  constraint memo_messages_anchor_bounds_check check (
    (
      anchor_start_ms is null
      and anchor_end_ms is null
    ) or (
      anchor_start_ms is not null
      and anchor_end_ms is not null
      and anchor_start_ms >= 0
      and anchor_end_ms > anchor_start_ms
    )
  ),
  constraint memo_messages_restricted_scope_check check (
    (
      visibility = 'restricted'
      and coalesce(array_length(restricted_participant_ids, 1), 0) > 0
    ) or (
      visibility <> 'restricted'
      and coalesce(array_length(restricted_participant_ids, 1), 0) = 0
    )
  ),
  constraint memo_messages_room_memo_fkey
    foreign key (memo_room_id, memo_id)
    references public.memo_room_memos (memo_room_id, memo_id)
    on delete cascade
);

create index memo_messages_room_created_idx
  on public.memo_messages (memo_room_id, created_at desc);

create index memo_messages_root_idx
  on public.memo_messages (root_message_id);

create index memo_messages_reply_idx
  on public.memo_messages (reply_to_message_id);

alter table public.memo_rooms enable row level security;
alter table public.memo_room_memos enable row level security;
alter table public.memo_room_participants enable row level security;
alter table public.memo_messages enable row level security;
