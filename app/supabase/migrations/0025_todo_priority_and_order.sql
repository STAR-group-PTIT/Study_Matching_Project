-- To-do list UX upgrade (Giai đoạn 10  phần 11 — branch UI-UX-update): thêm ưu tiên + thứ tự.
-- (1) todos.priority — 3 mức 'high'/'medium'/'low' (mặc định 'medium'), check constraint.
-- (2) todos.order_index — thứ tự kéo-thả TRONG CÙNG mức ưu tiên (chỉ việc đang mở mới có nghĩa,
--     việc đã xong chìm xuống mục "Đã xong" thuần render phía client, không cần giữ thứ tự).
--     Client tự renormalize 1..n sau mỗi thao tác xoá/thêm/đổi mức/kéo-thả rồi ghi ngược DB
--     (danh sách ≤ 500 dòng — trần đã có ở Dashboard.tsx — nên ghi nhỏ lẻ là đủ, không cần
--     thêm RPC/transaction phức tạp).
-- Dữ liệu cũ: priority='medium', order_index=0 — client dùng created_at làm tie-breaker
-- (query order created_at như cũ) nên thứ tự hiển thị của to-do hiện có vẫn giữ nguyên.

alter table public.todos
  add column if not exists priority text not null default 'medium',
  add column if not exists order_index integer not null default 0;

alter table public.todos
  drop constraint if exists todos_priority_check;

alter table public.todos
  add constraint todos_priority_check check (priority in ('high', 'medium', 'low'));

create index if not exists todos_user_order_idx
  on public.todos (user_id, priority, order_index);