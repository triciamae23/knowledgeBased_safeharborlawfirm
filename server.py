"""Safe Harbor Law Firm HTTP app backed exclusively by Supabase (server-side credentials)."""
import datetime
import hashlib
import hmac
import json
import os
import secrets
import revisions
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from http.cookies import SimpleCookie
from pathlib import Path

from document_images import image_manifest, fetch_image
from page_attachments import embedded_images, attachment_bytes
from azure_chat import chat as azure_chat, ChatUnavailable
from vsa import content_text
from supabase_store import SupabaseStore, StorageError, parse_timestamp

ROOT = Path(__file__).resolve().parent
STORE = None
DEPARTMENTS = [
    {'id': name.lower().replace(' ', '-'), 'name': name}
    for name in ('Leadership', 'Attorney', 'Paralegal', 'CEC', 'Intake', 'VA',
                 'Admin', 'Operation Support', 'HR', 'Accounting')
]


def department_setting(key, default):
    row = STORE.one('kb_settings', {'key': 'eq.'+key}, order='key.asc')
    return json.loads(row['value']) if row else default


def departments():
    keys = ['department_folders:'+d['id'] for d in DEPARTMENTS]
    mappings = {r['key']:json.loads(r['value']) for r in
                STORE.rows('kb_settings', {'key':'in.('+','.join(keys)+')'}, order='key.asc')}
    return [{**d, 'folder_ids': mappings.get('department_folders:'+d['id'], [])} for d in DEPARTMENTS]


def validated_departments(ids):
    if not isinstance(ids, list) or any(not isinstance(i, str) for i in ids):
        raise ValueError('Select valid departments.')
    if not set(ids).issubset({d['id'] for d in DEPARTMENTS}):
        raise ValueError('Select valid departments.')
    return sorted(set(ids))


def save_departments(user_id, ids, folders, can_submit_edits=False):
    STORE.upsert('kb_settings', {'key': 'department_access:'+str(user_id),
                               'value': json.dumps({'department_ids':ids, 'folder_ids':folders,
                                                    'can_submit_edits':can_submit_edits})}, 'key')


def assigned_access(user):
    access = department_setting('department_access:'+str(user['id']),
                                {'department_ids':[], 'folder_ids':user['folder_ids']})
    return {**user, 'department_ids':access['department_ids'], 'folder_ids':access['folder_ids'],
            'can_submit_edits':access.get('can_submit_edits') is True}


def user_access(user):
    user = assigned_access(user)
    if user['role'] != 'admin':
        mapped = {f for d in departments() if d['id'] in user['department_ids'] for f in d['folder_ids']}
        user['folder_ids'] = sorted(mapped.intersection(user['folder_ids']))
    return user


def utcnow():
    return datetime.datetime.now(datetime.timezone.utc)


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    return salt + ':' + hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 260000).hex()


def public_user(user):
    return {key:user[key] for key in ('id','name','email','role','folder_ids','department_ids','can_submit_edits')}


def initialize():
    global STORE
    STORE = SupabaseStore()
    # Validate every runtime table, so a partial setup cannot silently start.
    for table in ('kb_users','kb_spaces','kb_documents','kb_settings','kb_sessions'):
        STORE.request(table, params={'select':'*','limit':0})


def validated_folders(ids):
    if not isinstance(ids,list) or any(type(i) is not int for i in ids):
        raise ValueError('Select valid folders.')
    available = {row['id'] for row in STORE.rows('kb_spaces',select='id')}
    if not set(ids).issubset(available):
        raise ValueError('One or more folders no longer exist. Refresh and try again.')
    return sorted(set(ids))


def document_rows(user, doc_id=None):
    filters = {}
    if doc_id is not None:
        filters['id'] = 'eq.'+str(doc_id)
    if user['role'] != 'admin':
        if not user['folder_ids']:
            return []
        filters.update(status='eq.published',space_id='in.('+','.join(map(str,user['folder_ids']))+')')
    rows = STORE.rows('kb_documents',filters,select='*,author:kb_users!author_id(name),space:kb_spaces!space_id(name)',order='updated.desc,id.desc')
    for row in rows:
        row['version'] = revisions.version(row)
        row['author'] = row['author']['name']
        row['space'] = row['space']['name']
        row['updated'] = parse_timestamp(row['updated']).astimezone(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
    return rows


def chat_source_images(doc):
    base = '/api/documents/' + str(doc['id'])
    imported = [{'url':base+'/images/'+str(index),'alt':item['alt']}
                for index,item in enumerate(image_manifest(doc, STORE))]
    uploaded = [{'url':base+'/attachments/'+str(index),'alt':item['alt'] or 'Attached image'}
                for index,item in enumerate(embedded_images(doc))]
    return imported + uploaded


def chat_source_blocks(doc):
    base = '/api/documents/' + str(doc['id'])
    blocks, cursor = [], 0
    for index, item in enumerate(image_manifest(doc, STORE)):
        text = content_text(doc['body'][cursor:item['start']])
        if text:
            blocks.append({'type':'text','text':text})
        blocks.append({'type':'image','alt':item['alt'],'url':base+'/images/'+str(index)})
        cursor = item['end']
    text = content_text(doc['body'][cursor:])
    if text:
        blocks.append({'type':'text','text':text})
    for index, item in enumerate(embedded_images(doc)):
        blocks.append({'type':'image','alt':item['alt'] or 'Attached image',
                       'url':base+'/attachments/'+str(index)})
    return blocks


class Handler(BaseHTTPRequestHandler):
    def send_json(self, data, status=200, cookie=None):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type','application/json')
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        if cookie:
            self.send_header('Set-Cookie',cookie)
        self.end_headers()
        self.wfile.write(body)

    def session_hash(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get('Cookie',''))
        except Exception:
            return None
        token = cookie.get('session')
        return hashlib.sha256(token.value.encode()).hexdigest() if token else None

    def user(self):
        token_hash = self.session_hash()
        if not token_hash:
            return None
        session = STORE.one('kb_sessions',{'token_hash':'eq.'+token_hash,'expires_at':'gt.'+utcnow().isoformat()},order='token_hash.asc')
        if not session:
            return None
        # Always load current permissions; no session-cached role or folder grants.
        user = STORE.one('kb_users',{'id':'eq.'+str(session['user_id'])},select='id,name,email,role,folder_ids')
        return user_access(user) if user else None

    def do_GET(self):
        path = self.path.split('?')[0]
        if not path.startswith('/api/'):
            files = {'/':'index.html','/app.js':'app.js','/style.css':'style.css','/safe-harbor-logo.png':'safe-harbor-logo.png'}
            if path not in files:
                return self.send_error(404)
            self.send_response(200)
            self.send_header('Content-Type',{'/':'text/html; charset=utf-8','/app.js':'text/javascript; charset=utf-8','/style.css':'text/css; charset=utf-8','/safe-harbor-logo.png':'image/png'}[path])
            self.send_header('Cache-Control','no-cache')
            self.send_header('X-Content-Type-Options','nosniff')
            self.send_header('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data: https:; media-src 'self' data: https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
            self.end_headers()
            self.wfile.write((ROOT/'static'/files[path]).read_bytes())
            return
        try:
            user = self.user()
            if not user:
                return self.send_json({'error':'Please sign in to continue.'},401)
            if path == '/api/bootstrap':
                if user['role']=='admin':
                    spaces = STORE.rows('kb_spaces')
                elif user['folder_ids']:
                    spaces = STORE.rows('kb_spaces',{'id':'in.('+','.join(map(str,user['folder_ids']))+')'})
                else:
                    spaces = []
                visible_departments = departments()
                if user['role'] != 'admin':
                    visible_departments = [{**d, 'folder_ids': [f for f in d['folder_ids'] if f in user['folder_ids']]}
                                           for d in visible_departments if d['id'] in user['department_ids']]
                return self.send_json({'user':public_user(user),'documents':document_rows(user),'spaces':spaces,
                                       'departments':visible_departments,
                                       'settings':{r['key']:r['value'] for r in STORE.rows('kb_settings',{'key':'eq.workspace_name'},order='key.asc')}})
            if path == '/api/revisions':
                return self.send_json(revisions.listing(STORE,user))
            if path.startswith('/api/revisions/'):
                _, revision = revisions.get(STORE,path.rsplit('/',1)[-1])
                if not revisions.visible(user,revision):
                    return self.send_json({'error':'Submission not found.'},404)
                return self.send_json(revision)
            if path.startswith('/api/documents/') and '/images/' in path:
                parts=path.strip('/').split('/')
                try:
                    if len(parts)!=5 or parts[3]!='images':raise ValueError()
                    doc_id,index=int(parts[2]),int(parts[4])
                    if index<0:raise ValueError()
                except ValueError:
                    return self.send_json({'error':'Image not found.'},404)
                docs=document_rows(user,doc_id)
                if not docs:
                    return self.send_json({'error':'Image not found or access is not enabled.'},404)
                images=image_manifest(docs[0],STORE)
                if index>=len(images):
                    return self.send_json({'error':'Image not found.'},404)
                data,content_type=fetch_image(images[index]['ref'])
                self.send_response(200)
                self.send_header('Content-Type',content_type)
                self.send_header('Content-Length',str(len(data)))
                self.send_header('Cache-Control','private, no-store')
                self.send_header('X-Content-Type-Options','nosniff')
                self.end_headers()
                self.wfile.write(data)
                return
            if path.startswith('/api/documents/') and '/attachments/' in path:
                parts=path.strip('/').split('/')
                try:
                    if len(parts)!=5 or parts[3]!='attachments':raise ValueError()
                    doc_id,index=int(parts[2]),int(parts[4])
                    if index<0:raise ValueError()
                except ValueError:
                    return self.send_json({'error':'Image not found.'},404)
                docs=document_rows(user,doc_id)
                if not docs:
                    return self.send_json({'error':'Image not found or access is not enabled.'},404)
                try:
                    data,content_type=attachment_bytes(docs[0],index)
                except StorageError as exc:
                    return self.send_json({'error':str(exc)},exc.status)
                self.send_response(200)
                self.send_header('Content-Type',content_type)
                self.send_header('Content-Length',str(len(data)))
                self.send_header('Cache-Control','private, no-store')
                self.send_header('X-Content-Type-Options','nosniff')
                self.end_headers()
                self.wfile.write(data)
                return
            if path.startswith('/api/documents/'):
                try:
                    doc_id = int(path.rsplit('/',1)[1])
                except ValueError:
                    return self.send_json({'error':'Document not found.'},404)
                rows = document_rows(user,doc_id)
                if not rows:
                    return self.send_json({'error':'Document not found or access is not enabled.'},404)
                rows[0]['images']=[{'placeholder':item['placeholder'],'alt':item['alt'],'url':'/api/documents/'+str(doc_id)+'/images/'+str(i)} for i,item in enumerate(image_manifest(rows[0],STORE))]
                return self.send_json(rows[0])
            if path=='/api/users':
                if user['role']!='admin':
                    return self.send_json({'error':'Administrator access required.'},403)
                users = STORE.rows('kb_users',select='id,name,email,role,folder_ids')
                return self.send_json([assigned_access(u) for u in users])
            return self.send_json({'error':'Not found'},404)
        except StorageError as error:
            return self.send_json({'error':str(error)},error.status)

    def do_POST(self):
        origin = self.headers.get('Origin')
        if origin and origin not in ('http://'+self.headers.get('Host',''),'https://'+self.headers.get('Host','')):
            return self.send_json({'error':'Invalid origin'},403)
        try:
            length = int(self.headers.get('Content-Length',0))
            if length < 0 or length > 1000000:
                return self.send_json({'error':'Request too large'},413)
            data = json.loads(self.rfile.read(length))
            if not isinstance(data,dict):
                raise ValueError()
        except (ValueError,TypeError):
            return self.send_json({'error':'Invalid request'},400)
        try:
            path = self.path
            if path=='/api/login':
                row = STORE.one('kb_users',{'email':'eq.'+str(data.get('email','')).lower().strip()})
                if not row or not hmac.compare_digest(row['password'],password_hash(str(data.get('password','')),row['password'].split(':')[0])):
                    return self.send_json({'error':'The email or password is incorrect.'},401)
                token = secrets.token_urlsafe(32)
                STORE.delete('kb_sessions',{'expires_at':'lt.'+utcnow().isoformat()})
                STORE.insert('kb_sessions',{'token_hash':hashlib.sha256(token.encode()).hexdigest(),'user_id':row['id'],'expires_at':(utcnow()+datetime.timedelta(days=1)).isoformat()})
                return self.send_json({'ok':True},cookie='session='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400')
            if path=='/api/logout':
                token_hash = self.session_hash()
                if token_hash:
                    STORE.delete('kb_sessions',{'token_hash':'eq.'+token_hash})
                return self.send_json({'ok':True},cookie='session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
            user = self.user()
            if not user:
                return self.send_json({'error':'Please sign in to continue.'},401)
            if path == '/api/chat':
                question = data.get('question')
                if not isinstance(question,str) or not question.strip() or len(question)>1000:
                    raise ValueError('Enter a question of up to 1,000 characters.')
                try:
                    documents=document_rows(user)
                    result=azure_chat(question.strip(),data.get('history'),documents)
                    by_id={doc['id']:doc for doc in documents}
                    for source in result['sources']:
                        doc=by_id.get(source['id'])
                        source['images']=chat_source_images(doc) if doc else []
                        source['blocks']=chat_source_blocks(doc) if doc else []
                    return self.send_json(result)
                except ChatUnavailable as exc:
                    return self.send_json({'error':str(exc)},503)
            if path == '/api/vsa':
                question = data.get('question')
                if not isinstance(question, str) or not question.strip() or len(question) > 1000:
                    raise ValueError('Enter a question of up to 1,000 characters.')
                documents = document_rows(user)
                try:
                    result = azure_chat(question.strip(),data.get('history'),documents)
                except ChatUnavailable as exc:
                    return self.send_json({'error':str(exc)},503)
                first=next((doc for doc in documents if result['sources'] and doc['id']==result['sources'][0]['id']),None)
                result['title']=first['title'] if first else ''
                result['blocks']=chat_source_blocks(first) if first else []
                return self.send_json(result)
            if path == '/api/revisions':
                return self.send_json(revisions.submit(STORE,user,data))
            if path == '/api/revisions/review':
                return self.send_json(revisions.decide(STORE,user,data))
            if user['role']!='admin':
                return self.send_json({'error':'Administrator access required.'},403)
            if path=='/api/documents':
                title = str(data.get('title','')).strip()
                status = data.get('status','draft')
                if not title or len(title)>200 or status not in ('published','draft'):
                    raise ValueError('Enter a title of up to 200 characters and a valid status.')
                space_id = int(data.get('space_id',0))
                if not STORE.one('kb_spaces',{'id':'eq.'+str(space_id)}):
                    raise ValueError('Select a valid folder.')
                record = {'title':title,'body':str(data.get('body','')).strip(),'space_id':space_id,'status':status,'updated':utcnow().isoformat()}
                if data.get('id'):
                    doc_id = int(data['id'])
                    if not STORE.update('kb_documents',{'id':'eq.'+str(doc_id)},record):
                        return self.send_json({'error':'Document not found.'},404)
                else:
                    record['author_id'] = user['id']
                    doc_id = STORE.insert('kb_documents',record)['id']
                return self.send_json({'id':doc_id})
            if path=='/api/documents/delete':
                STORE.delete('kb_documents',{'id':'eq.'+str(int(data['id']))})
            elif path=='/api/spaces':
                name = str(data.get('name','')).strip()
                if not name or len(name)>80:
                    raise ValueError('Enter a folder name (up to 80 characters).')
                STORE.insert('kb_spaces',{'name':name,'icon':'folder'})
            elif path=='/api/departments/folders':
                ids = validated_departments([data.get('id')])
                folders = validated_folders(data.get('folder_ids'))
                STORE.upsert('kb_settings', {'key':'department_folders:'+ids[0], 'value':json.dumps(folders)}, 'key')
            elif path=='/api/settings':
                name = str(data.get('workspace_name','')).strip()
                if not name or len(name)>40:
                    raise ValueError('Enter a workspace name (up to 40 characters).')
                STORE.upsert('kb_settings',{'key':'workspace_name','value':name},'key')
            elif path=='/api/users':
                name,email = (str(data.get(k,'')).strip() for k in ('name','email'))
                password = str(data.get('password',''))
                role = data.get('role','reader')
                if not name or '@' not in email or len(password)<10 or role not in ('admin','reader'):
                    raise ValueError('Enter a name, valid email, and a password of at least 10 characters.')
                folders = validated_folders(data.get('folder_ids',[]))
                department_ids = validated_departments(data.get('department_ids', []))
                can_submit_edits = data.get('can_submit_edits',False)
                if type(can_submit_edits) is not bool:
                    raise ValueError('Select a valid reader editing permission.')
                created = STORE.insert('kb_users',{'name':name,'email':email.lower(),'password':password_hash(password),'role':role,'folder_ids':folders if role=='reader' else []})
                if (department_ids or can_submit_edits) and role == 'reader':
                    try:
                        save_departments(created['id'], department_ids, folders, can_submit_edits)
                    except StorageError:
                        raise StorageError('Account created, but access could not be saved. Refresh People & permissions and assign access to the existing account. The reader has no document access.') from None
            elif path=='/api/users/access':
                user_id = int(data['id'])
                target = STORE.one('kb_users',{'id':'eq.'+str(user_id)},select='id,role,folder_ids')
                if not target:
                    return self.send_json({'error':'User not found.'},404)
                if target['role']=='admin':
                    raise ValueError('Administrators have access to all folders.')
                folders = validated_folders(data.get('folder_ids'))
                department_ids = validated_departments(data.get('department_ids', assigned_access(target)['department_ids']))
                can_submit_edits = data.get('can_submit_edits',assigned_access(target)['can_submit_edits'])
                if type(can_submit_edits) is not bool:
                    raise ValueError('Select a valid reader editing permission.')
                # One row replaces both sets of grants atomically.
                save_departments(user_id, department_ids, folders, can_submit_edits)
            elif path=='/api/users/delete':
                user_id = int(data['id'])
                if user_id==user['id']:
                    raise ValueError('You cannot remove your own account.')
                if STORE.one('kb_documents',{'author_id':'eq.'+str(user_id)},select='id'):
                    raise ValueError('This user owns documents and cannot be removed.')
                STORE.delete('kb_users',{'id':'eq.'+str(user_id)})
                STORE.delete('kb_settings',{'key':'eq.department_access:'+str(user_id)})
            else:
                return self.send_json({'error':'Not found'},404)
            return self.send_json({'ok':True})
        except StorageError as error:
            return self.send_json({'error':str(error)},error.status)
        except (ValueError,TypeError,KeyError) as error:
            return self.send_json({'error':str(error) if isinstance(error,ValueError) else 'Invalid request.'},400)


if __name__=='__main__':
    try:
        initialize()
    except StorageError as error:
        raise SystemExit(str(error))
    port = int(os.environ.get('PORT','8000'))
    print('Safe Harbor Law Firm (Supabase) is running at http://127.0.0.1:'+str(port),flush=True)
    ThreadingHTTPServer(('127.0.0.1',port),Handler).serve_forever()
