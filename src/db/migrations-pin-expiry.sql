
-- A temporary PIN issued by an administrator and sent to the person, which
-- stops working on its own.
--
-- Sending credentials through a chat application puts a working key into two
-- phones' message history, where it stays long after it was needed. It cannot
-- be unsent, so instead it is made to stop mattering: the PIN must be changed
-- at first sign-in, and it expires whether it is used or not.
ALTER TABLE users ADD COLUMN pin_expires_at TEXT;
