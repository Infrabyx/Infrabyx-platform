-- @infrabyx/notify 0008: attachments on email notifications and their receipt (Udofin PR-UDF-055;
-- R1-D-224; threat model §3.153). Expand-only; both columns are nullable, so existing rows and
-- writers are unchanged.
--   notification.attachments  the request's references: STORAGE key, SHA-256, file name and media
--                             type of each document (a file name may name a person: CONFIDENTIAL);
--   delivery.attachments      the receipt: the SHA-256 and size of each file as handed to the EMAIL
--                             adapter, written when the adapter accepted the message.
-- No grant changes: `app_rw` already inserts notifications and updates deliveries; the dispatcher's
-- column grants do not include either column.
set lock_timeout = '5s';
set statement_timeout = '60s';

alter table notify.notification add column attachments jsonb
  constraint notification_attachments_array check (
    attachments is null
    or (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) between 1 and 10)
  );
comment on column notify.notification.attachments is 'dataclass:CONFIDENTIAL';

alter table notify.delivery add column attachments jsonb
  constraint delivery_attachments_array check (
    attachments is null
    or (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) between 1 and 10)
  );
comment on column notify.delivery.attachments is 'dataclass:INTERNAL';
