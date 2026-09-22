"""Validate the local export; use --upload to copy it to a configured Supabase.

Run supabase/sweetprocess_schema.sql in the destination project first.
Only the dedicated sweetprocess_* import tables are written. Repeated uploads
upsert by source identity. Raw source JSON and every folder connection survive.
"""
import argparse
import json
import os
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request

from sweetprocess_content import folder_paths, render

ROOT = Path(__file__).resolve().parent


def prepare(data_dir):
    folders = json.loads((data_dir / 'folders.json').read_text())
    documents = json.loads((data_dir / 'procedures.json').read_text()) + json.loads((data_dir / 'policy.json').read_text())
    paths = folder_paths(folders)
    lookup = {f['hashid']: f['id'] for f in folders}
    if len(lookup) != len(folders) or len({f['id'] for f in folders}) != len(folders):
        raise ValueError('Duplicate folder identity')
    prepared_folders = []
    for f in folders:
        if f.get('parent') and f['parent'] not in lookup:
            raise ValueError('A folder has a missing parent in the export')
        prepared_folders.append(dict(source_id=f['id'], hashid=f['hashid'], name=f['name'], parent_hashid=f.get('parent'), path=paths[f['hashid']], raw_json=f))
    prepared_docs = []
    seen = set()
    for d in documents:
        key = (d['content_type'], d['id'])
        if key in seen:
            raise ValueError('Duplicate document identity')
        seen.add(key)
        folder_hashids = set()
        for c in d.get('connections', []):
            folder = c.get('folder')
            if folder:
                folder_hashids.add(folder['hashid'])
        body, _ = render(d, paths)
        prepared_docs.append(dict(source_type=key[0],source_id=key[1],title=d['name'],body_text=body,status='published' if d.get('approved_at') else 'draft',folder_hashids=sorted(folder_hashids),source_url=d['html_url'],modified_at=d.get('modified_at'),raw_json=d))
    return {'sweetprocess_folders': prepared_folders, 'sweetprocess_documents': prepared_docs}


def load_env():
    p = ROOT / '.env'
    if p.exists():
        for line in p.read_text().splitlines():
            if '=' not in line or line.lstrip().startswith('#'):
                continue
            key, value = line.split('=', 1)
            os.environ.setdefault(key.strip(), value.strip().strip('\"\''))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def upload(tables):
    load_env()
    url = os.environ.get('SUPABASE_URL', '').rstrip('/')
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.path or parsed.query or parsed.fragment or parsed.username:
        raise ValueError('Set SUPABASE_URL to the HTTPS project URL in .env')
    if not key:
        raise ValueError('Set SUPABASE_SERVICE_ROLE_KEY in .env')
    headers = {'apikey':key, 'Content-Type':'application/json'}
    if not key.startswith('sb_secret_'):
        headers['Authorization'] = 'Bearer ' + key
    opener = urllib.request.build_opener(NoRedirect())
    def request(path, data=None):
        req = urllib.request.Request(url + '/rest/v1/' + path, data=json.dumps(data,ensure_ascii=False).encode() if data is not None else None, headers={**headers,'Prefer':'resolution=merge-duplicates,return=minimal'})
        try:
            with opener.open(req,timeout=90) as response:
                content = response.read()
                return json.loads(content) if content else None
        except urllib.error.HTTPError as error:
            # Do not echo response bodies: they may contain private source content.
            raise RuntimeError('Supabase returned HTTP '+str(error.code)+'. Check the project credentials and apply supabase/sweetprocess_schema.sql. Completed batches may be safely retried.') from None
        except urllib.error.URLError:
            raise RuntimeError('Cannot connect to Supabase. Check network access and SUPABASE_URL.') from None
    # Check both tables before writing any data.
    for table in tables:
        request(table+'?select=source_id&limit=0')
    for table, records in tables.items():
        conflict = 'source_id' if table.endswith('folders') else 'source_type,source_id'
        for start in range(0,len(records),20):
            batch=records[start:start+20]
            request(table+'?on_conflict='+conflict,batch)
            # Read back exact identities and compare all imported fields.
            ids=','.join(str(r['source_id']) for r in batch)
            found=request(table+'?select=*&source_id=in.('+ids+')')
            identify=lambda r:(r.get('source_type'),r['source_id'])
            indexed={identify(r):r for r in found}
            for record in batch:
                saved=indexed.get(identify(record))
                if not saved or any(saved.get(k)!=v for k,v in record.items() if k!='modified_at'):
                    raise RuntimeError('Read-back verification failed for '+table)
        print(table+': uploaded and verified '+str(len(records))+' records')


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--upload',action='store_true')
    parser.add_argument('--data-dir',type=Path,default=ROOT/'sweetprocess_data')
    args=parser.parse_args()
    try:
        tables=prepare(args.data_dir)
        print(json.dumps({'folders':len(tables['sweetprocess_folders']),'documents':len(tables['sweetprocess_documents']),'folder_connections':sum(len(d['folder_hashids']) for d in tables['sweetprocess_documents']),'referenced_folders_missing_from_export':len({h for d in tables['sweetprocess_documents'] for h in d['folder_hashids']} - {f['hashid'] for f in tables['sweetprocess_folders']}),'mode':'upload' if args.upload else 'validation only'}))
        if args.upload:
            upload(tables)
    except (ValueError,RuntimeError) as error:
        parser.exit(1,str(error)+'\n')
