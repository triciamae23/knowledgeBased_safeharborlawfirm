"""Reader proposals stay separate from published documents until admin approval."""
import hashlib
import json
import secrets
from datetime import datetime, timezone

from supabase_store import StorageError

FIELDS = ('title', 'body', 'space_id', 'status', 'updated')


def version(document):
    return hashlib.sha256(json.dumps({k:document[k] for k in FIELDS}, sort_keys=True).encode()).hexdigest()


def get(store, revision_id):
    row = store.one('kb_settings', {'key':'eq.revision:'+revision_id}, order='key.asc')
    if not row:
        raise StorageError('Submission not found.', 404)
    return row, json.loads(row['value'])


def visible(user, revision):
    return user['role']=='admin' or (revision['submitted_by']==user['id'] and revision['proposed']['space_id'] in user['folder_ids'])


def listing(store, user):
    result = []
    for row in store.rows('kb_settings', {'key':'like.revision:*'}, order='key.asc'):
        revision = json.loads(row['value'])
        if visible(user, revision):
            result.append({k:v for k,v in revision.items() if k not in ('base','proposed')})
    return sorted(result, key=lambda r:r['submitted_at'], reverse=True)


def submit(store, user, data):
    if user['role']!='reader' or not user.get('can_submit_edits'):
        raise StorageError('Your administrator has not enabled editing for approval.',403)
    doc = store.one('kb_documents', {'id':'eq.'+str(int(data.get('id',0)))})
    if not doc or doc['status']!='published' or doc['space_id'] not in user['folder_ids']:
        raise StorageError('Document not found or access is not enabled.',404)
    if data.get('base_version') != version(doc):
        raise StorageError('This page changed while you were editing. Reopen the latest page and apply your changes.',409)
    title, body = data.get('title'), data.get('body')
    if not isinstance(title,str) or not title.strip() or len(title.strip())>200 or not isinstance(body,str):
        raise ValueError('Enter a title of up to 200 characters and valid page content.')
    if int(data.get('space_id',0)) != doc['space_id']:
        raise ValueError('Readers cannot move documents to another folder.')
    revision = {'id':secrets.token_hex(16), 'document_id':doc['id'], 'title':title.strip(),
                'submitted_by':user['id'], 'submitted_name':user['name'],
                'submitted_at':datetime.now(timezone.utc).isoformat(), 'status':'pending',
                'base':{k:doc[k] for k in FIELDS},
                'proposed':{'title':title.strip(),'body':body.strip(),'space_id':doc['space_id']}}
    store.insert('kb_settings', {'key':'revision:'+revision['id'], 'value':json.dumps(revision)})
    return {'id':doc['id'], 'revision_id':revision['id'], 'status':'pending'}


def decide(store, user, data):
    if user['role']!='admin':
        raise StorageError('Administrator access required.',403)
    decision = data.get('decision')
    if decision not in ('approve','reject'):
        raise ValueError('Choose approve or reject.')
    row, revision = get(store, str(data.get('id','')))
    if revision['status'] not in ('pending','approving'):
        raise StorageError('This submission has already been reviewed.',409)
    if revision['status']=='approving' and decision=='reject':
        raise StorageError('Approval has started. Retry approval to finish it.',409)
    if revision['status']=='pending':
        revision.update(status='approving' if decision=='approve' else 'rejected',
                        reviewed_by=user['id'], reviewed_at=datetime.now(timezone.utc).isoformat())
        claimed = store.update('kb_settings', {'key':'eq.'+row['key'],'value':'eq.'+row['value']}, {'value':json.dumps(revision)})
        if not claimed:
            raise StorageError('Another administrator is reviewing this submission. Refresh the queue.',409)
    if decision=='reject':
        return {'status':'rejected'}
    doc = store.one('kb_documents', {'id':'eq.'+str(revision['document_id'])})
    # Recover a successful publication if saving the decision previously failed.
    published = doc and doc['status']=='published' and all(doc[k]==v for k,v in revision['proposed'].items())
    if not published:
        if not doc or version(doc)!=version(revision['base']):
            revision['status']='conflict'
            store.update('kb_settings',{'key':'eq.'+row['key']},{'value':json.dumps(revision)})
            raise StorageError('The original page changed or was deleted. This submission cannot overwrite it; request a new edit.',409)
        changed = store.update('kb_documents', {'id':'eq.'+str(doc['id']),'updated':'eq.'+doc['updated']},
                               {**revision['proposed'],'status':'published','updated':datetime.now(timezone.utc).isoformat()})
        if not changed:
            raise StorageError('The page changed during approval. Refresh and retry.',409)
    revision['status']='approved'
    store.update('kb_settings',{'key':'eq.'+row['key']},{'value':json.dumps(revision)})
    return {'status':'approved'}
