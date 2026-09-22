# SweetProcess → Supabase

1. Fill `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the project's local `.env`. A Supabase server-side `sb_secret_` key is also accepted in the latter field. Never expose it in frontend code.
2. Run `sweetprocess_schema.sql` in your destination project's SQL editor. It creates two dedicated import tables with row-level security and service-role-only access. Existing application tables are unchanged.
3. Validate the local exports: `python3 export_sweetprocess_supabase.py`
4. Upload: `python3 export_sweetprocess_supabase.py --upload`

The current export contains 90 folders and 515 documents (487 procedures and 28 policies), with 516 unique document/folder connections. Four referenced folders are absent from `folders.json`; their hash IDs and original reference metadata are preserved in the document rows. They are not invented as complete folder records.

Source JSON, procedure steps, HTML, metadata, source permissions, attachment references, and folder hierarchy references are retained. Readable document text is stored alongside the original JSON. Media binaries are not downloaded or uploaded to Supabase Storage. Source permission metadata is not converted into Supabase Auth grants. These import tables remain inaccessible to ordinary clients until a separate application/auth integration is implemented. The Atlas runtime now targets separate `kb_*` Supabase tables. The app is already connected and populated; see the project README.

Each batch is upserted by source identity and read back for verification. Rerunning updates matching imports and does not delete unrelated rows. Uploads are not one global transaction; an interrupted upload can leave completed batches. Retry the same export to finish. Re-exporting does not remove records absent from a later source snapshot.

References: [Supabase Data API](https://supabase.com/docs/guides/api), [Row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).
