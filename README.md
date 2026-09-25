# Knowledge base app

Atlas uses Supabase exclusively for users, password hashes, sessions, folders, documents, folder permissions, and workspace settings. The Python backend keeps the service key private and enforces access before querying Supabase.

## Run

Configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`, then run:

```sh
python3 server.py
```

Open http://127.0.0.1:8000. Existing accounts and credentials are stored in Supabase. Python 3.9+ is required; no third-party Python dependencies are needed. `PORT` overrides the default localhost port.

The configured project is already populated. `supabase/atlas_schema.sql` describes the app's `kb_*` tables. `supabase/sweetprocess_schema.sql` describes the separate source archive tables. These schema files do not create starter accounts.

## Access and storage

- The sidebar and Home topics show enabled departments. The **Folders** dropdown beside **Home** and **Workspace** lists accessible folders.
- Readers can view published pages only when the folder is individually enabled and belongs to an enabled department. Administrators manage all pages, department mappings, and account permissions. The department named **Admin** does not grant the administrator role.
- Department and folder grants are saved together atomically and checked on each request, including direct links, images, attachments, and both chat endpoints.
- Sessions are stored as token hashes in Supabase, persist across server restarts, and expire after 24 hours. Logout and account deletion revoke access.
- Browser clients cannot directly read the database tables. The backend uses a server-side key, with no local data fallback during outages.
- Accounts use the existing application login system; they are not Supabase Auth accounts.

### Configure department access

The ten department names come from the Category column of `KB Category.xlsx`: Leadership, Attorney, Paralegal, CEC, Intake, VA, Admin, Operation Support, HR, and Accounting. The spreadsheet is reference data; names, emails, remarks, and blank category cells do not automatically create accounts or grant access.

After restarting the server and refreshing the browser:

1. Open **Administration → Department folders → Assign folders**. A folder can belong to several departments. New folders are available from the top **Folders → Create folder** menu and start without a department assignment.
2. Under **People & permissions**, select a reader’s access button. Enable their departments and individual folders, then select **Save access**. Existing folder selections are retained for review, but existing readers have no document access until an administrator assigns departments.
3. A reader sees only their enabled departments and the intersection of mapped and individually enabled folders. Removing either grant or removing a folder from a department takes effect on the next server request. Already downloaded content cannot be recalled.

No schema migration is required. Department mappings are JSON arrays in `kb_settings` keys `department_folders:<department-id>`. Each `department_access:<user-id>` value stores both `department_ids` and `folder_ids` as one JSON object. This value is authoritative when present; `kb_users.folder_ids` supplies legacy folder selections only before the first department access save. Bootstrap returns only the public workspace name from settings, never other users’ grants. Changes are stored in Supabase and persist across restarts.

### Reader edits and approval

In **Administration → People & permissions**, open a reader’s access settings and enable **Allow edits for admin approval**. Existing readers default to view-only. The setting can also be selected when creating a reader account. It never permits direct publishing, creating pages, moving pages between folders, or editing inaccessible/unpublished pages.

Enabled readers select **Edit document**, then **Submit for approval**. Their proposed title, formatted content, and attachments are stored separately from the published document. The original remains visible to other readers and is the only version used by search and chat. **My submissions** shows the reader’s own submission status while they retain folder access.

Administrators use **Approvals** to compare the original and proposed versions, then **Approve & publish** or **Reject**. Rejection leaves the document unchanged. If the document changed or was deleted after submission, approval refuses to overwrite it and the reader must submit a new edit from the latest version. Disabling reader editing blocks new submissions immediately; an administrator can still decide already-submitted changes.

The `can_submit_edits` boolean is stored with each reader’s access settings. Revision snapshots and decisions are stored in private `kb_settings` rows under `revision:<random-id>`; no schema migration is needed. Reviews claim the pending submission before publishing and use a conditional document update to prevent overwriting concurrent changes. If storage fails after approval starts, the queue exposes **Retry approval**, which can finish recording a successful publication without applying the update again.

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
