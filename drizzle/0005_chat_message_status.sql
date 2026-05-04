ALTER TABLE chat_messages ADD COLUMN status TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('complete','stopped','error'));
