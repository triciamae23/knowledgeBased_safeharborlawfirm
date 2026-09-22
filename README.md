# Atlas knowledge base

Atlas uses Supabase exclusively for users, password hashes, sessions, folders, documents, folder permissions, and workspace settings. The Python backend keeps the service key private and enforces access before querying Supabase.

## Run

Configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`, then run:

```sh
python3 server.py
```

Open http://127.0.0.1:8000. Existing accounts and credentials are stored in Supabase. Python 3.9+ is required; no third-party Python dependencies are needed. `PORT` overrides the default localhost port.

The configured project is already populated. `supabase/atlas_schema.sql` describes the app's `kb_*` tables. `supabase/sweetprocess_schema.sql` describes the separate source archive tables. These schema files do not create starter accounts.

## Access and storage

- Home topics, page listings, search results, and direct page reads respect enabled folders.
- Readers can view published pages only in their enabled folders. Administrators manage all pages and account permissions.
- Folder grants are saved atomically and checked on each request.
- Sessions are stored as token hashes in Supabase, persist across server restarts, and expire after 24 hours. Logout and account deletion revoke access.
- Browser clients cannot directly read the database tables. The backend uses a server-side key, with no local data fallback during outages.
- Accounts use the existing application login system; they are not Supabase Auth accounts.

The editable app library contains the migrated pages, including 515 SweetProcess documents. Full source JSON, HTML, source folder hierarchy, and media references remain in the Supabase source archive. The app retains its existing primary-folder model. Media binaries are not stored locally or copied to Supabase Storage by the export tool.

## SweetProcess exports

`python3 export_sweetprocess_supabase.py` validates the JSON export in `sweetprocess_data/`. Add `--upload` to upsert the source archive in Supabase and verify it. Content conversion helpers live in `sweetprocess_content.py`. Source archive updates do not overwrite editable app pages.

## Tests

`python3 test_server.py` tests the HTTP API against a deterministic PostgREST test double. It covers login, publishing, permissions, revocation, user management, and database outages without modifying the live project.

The app binds to localhost. Public deployment requires HTTPS, login throttling, and an account-recovery workflow.

Imported image placeholders are rendered inline through authenticated document image endpoints. The server retrieves supported raster images from the original media host; each request rechecks document visibility and folder access. Images remain dependent on source availability and are not copied into public storage.

## KB Assistant

Signed-in users can select **KB Assistant** in the lower-right corner to ask about procedures and policies. The chat panel searches published pages in permitted folders and quotes the best matching page’s full instructions in its reply, preserving wording and step order while removing import metadata. Questions and replies remain visible while the panel is open. Each question is matched independently. It uses keyword relevance against existing content, requires no AI service, and does not generate new policy advice. Each request rechecks folder permissions. Restart `python3 server.py` after installing this change, then refresh the browser.

## Home chat

The home page has a conversational question box. The server searches the signed-in user's accessible, published pages and sends matching passages to Azure OpenAI for a grounded answer. Replies also show images attached to the matching pages. Imported and editor-uploaded images are served through authenticated page URLs, so each image request rechecks folder access. Chat history stays in browser memory for the current session; it is not stored in the database.

Configure these server-side values in the ignored `.env` file, then restart the server:

```text
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_API_KEY=your-key
AZURE_OPENAI_DEPLOYMENT=your-deployment-name
```

The deployment name is the **Name** shown under **Models + endpoints → Deployments** in Azure AI Foundry. It is required even when the endpoint and region are known. The key is never sent to the browser. If no accessible page matches a question, the server does not call Azure OpenAI.
