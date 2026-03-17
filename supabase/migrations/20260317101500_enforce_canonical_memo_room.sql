with ranked_room_links as (
  select
    memo_room_id,
    memo_id,
    row_number() over (
      partition by memo_id
      order by created_at asc, memo_room_id asc
    ) as memo_rank
  from public.memo_room_memos
),
duplicate_room_links as (
  select
    memo_room_id,
    memo_id
  from ranked_room_links
  where memo_rank > 1
)
delete from public.memo_room_memos as memo_room_memos
using duplicate_room_links
where memo_room_memos.memo_room_id = duplicate_room_links.memo_room_id
  and memo_room_memos.memo_id = duplicate_room_links.memo_id;

create unique index if not exists memo_room_memos_memo_unique
  on public.memo_room_memos (memo_id);
