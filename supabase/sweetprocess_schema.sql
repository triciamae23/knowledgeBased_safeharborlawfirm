-- Run once in the destination project's Supabase SQL editor.
-- Dedicated import tables; does not modify Atlas tables or grant reader access.
BEGIN;
CREATE TABLE IF NOT EXISTS public.sweetprocess_folders (
    source_id bigint PRIMARY KEY,
    hashid text UNIQUE NOT NULL,
    name text NOT NULL,
    parent_hashid text,
    path text NOT NULL,
    raw_json jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS public.sweetprocess_documents (
    source_type text NOT NULL CHECK (source_type IN ('procedure', 'policy')),
    source_id bigint NOT NULL,
    title text NOT NULL,
    body_text text NOT NULL,
    status text NOT NULL CHECK (status IN ('published', 'draft')),
    folder_hashids text[] NOT NULL DEFAULT '{}',
    source_url text NOT NULL,
    modified_at timestamptz,
    raw_json jsonb NOT NULL,
    PRIMARY KEY (source_type, source_id)
);
ALTER TABLE public.sweetprocess_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sweetprocess_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sweetprocess_folders, public.sweetprocess_documents FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sweetprocess_folders, public.sweetprocess_documents TO service_role;
COMMIT;
