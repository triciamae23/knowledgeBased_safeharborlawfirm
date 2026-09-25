import contextlib
import base64
import http.cookiejar
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

import server
import sys
sys.path.insert(0,str(Path(__file__).parent / 'tests'))
from fake_supabase import FakeSupabase
from vsa import answer as local_answer


class KnowledgeBaseTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.store = FakeSupabase(server.password_hash('test-admin-password'))
        server.STORE = cls.store
        cls.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.url = 'http://127.0.0.1:' + str(cls.http.server_port) + '/api/'
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()


    def client(self):
        return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(self, client, path, data=None, status=200):
        request = urllib.request.Request(self.url+path, data=json.dumps(data).encode() if data is not None else None, headers={'Content-Type':'application/json'})
        try:
            response = client.open(request)
        except urllib.error.HTTPError as error:
            response = error
        self.assertEqual(response.code, status)
        return json.loads(response.read())

    def test_vsa_search_and_permissions(self):
        store = FakeSupabase(server.password_hash('test-admin-password'))
        store.tables['kb_documents'][0].update(title='Request time off', body='Submit your vacation request to your manager.')
        store.tables['kb_documents'][1].update(title='Restricted vacation policy', body='Private vacation rules.')
        store.tables['kb_documents'][5].update(title='Draft vacation policy', body='Unapproved vacation rules.', space_id=1)
        # This permission test must not depend on an external Azure deployment.
        with patch.object(server, 'STORE', store), patch.object(server, 'azure_chat',
                side_effect=lambda question, history, documents: local_answer(question, documents)):
            admin, reader = self.client(), self.client()
            self.request(reader, 'vsa', {'question':'vacation'}, status=401)
            self.request(admin, 'login', {'email':'admin@atlas.local','password':'test-admin-password'})
            self.request(admin, 'users', {'name':'VSA Reader','email':'vsa@example.com','password':'test-reader-password','role':'reader','department_ids':['leadership']})
            self.request(reader, 'login', {'email':'vsa@example.com','password':'test-reader-password'})
            self.assertEqual(self.request(reader,'vsa',{'question':'vacation'})['sources'], [])
            reader_id = store.tables['kb_users'][-1]['id']
            self.request(admin,'users/access',{'id':reader_id,'folder_ids':[1]})
            result = self.request(reader,'vsa',{'question':'How do I request vacation?'})
            self.assertEqual([source['id'] for source in result['sources']], [1])
            self.assertIn('Submit your vacation request',result['sources'][0]['excerpt'])
            self.assertNotIn('Private',json.dumps(result))
            self.assertNotIn('Unapproved',json.dumps(result))
            store.tables['kb_documents'][0]['body']='Source: https://example.com\n\nStep 1: Request vacation\n\n[Image: files/1/test.png]\n\nStep 2: Submit vacation request'
            illustrated=self.request(reader,'vsa',{'question':'vacation request'})
            self.assertEqual([block['type'] for block in illustrated['blocks']],['text','image','text'])
            self.assertEqual(illustrated['blocks'][1]['url'],'/api/documents/1/images/0')
            self.assertIn('Step 2',illustrated['blocks'][2]['text'])
            self.assertNotIn('Source:',illustrated['blocks'][0]['text'])
            self.assertNotIn(6,[source['id'] for source in self.request(admin,'vsa',{'question':'vacation'})['sources']])
            self.assertEqual(self.request(reader,'vsa',{'question':'quasar telescope'})['sources'], [])
            for question in ('', ' '*3, 'x'*1001, None, []):
                self.request(reader,'vsa',{'question':question},status=400)
            self.request(admin,'users/access',{'id':reader_id,'folder_ids':[]})
            self.assertEqual(self.request(reader,'vsa',{'question':'vacation'})['sources'], [])
            store.fail=True
            self.request(reader,'vsa',{'question':'vacation'},status=503)

    def test_chat_only_receives_accessible_documents(self):
        store = FakeSupabase(server.password_hash('test-admin-password'))
        image='data:image/gif;base64,'+base64.b64encode(b'GIF89a attached').decode()
        store.tables['kb_documents'][0]['body']='::rich2::'+json.dumps({'content':'<p>Vacation request</p>','media':[{'kind':'image','src':image,'name':'Vacation image'}]})
        with patch.object(server, 'STORE', store):
            admin, reader = self.client(), self.client()
            self.request(reader, 'chat', {'question':'vacation'}, status=401)
            self.request(admin, 'login', {'email':'admin@atlas.local','password':'test-admin-password'})
            self.request(admin, 'users', {'name':'Chat Reader','email':'chat@example.com','password':'test-reader-password','role':'reader','department_ids':['leadership']})
            self.request(reader, 'login', {'email':'chat@example.com','password':'test-reader-password'})
            reader_id = store.tables['kb_users'][-1]['id']
            self.request(admin,'users/access',{'id':reader_id,'folder_ids':[1]})
            captured = []
            def fake_chat(question, history, documents):
                captured.extend(documents)
                return {'answer':'Test answer','sources':[{'id':1,'title':'Vacation request','folder':'HR'}]}
            with patch.object(server, 'azure_chat', side_effect=fake_chat):
                result=self.request(reader,'chat',{'question':'vacation'})
                self.assertEqual(result['answer'],'Test answer')
                self.assertEqual(result['sources'][0]['images'][0]['url'],'/api/documents/1/attachments/0')
            with reader.open(self.url+'documents/1/attachments/0') as response:
                self.assertEqual(response.headers['Content-Type'],'image/gif')
                self.assertEqual(response.read(),b'GIF89a attached')
            self.assertTrue(captured)
            self.assertTrue(all(doc['status']=='published' and doc['space_id']==1 for doc in captured))
            self.request(reader,'chat',{'question':' '},status=400)
            self.request(admin,'users/access',{'id':reader_id,'folder_ids':[]})
            try:
                reader.open(self.url+'documents/1/attachments/0')
            except urllib.error.HTTPError as exc:
                self.assertEqual(exc.code,404)
            else:
                self.fail('Revoked reader could still fetch an attachment')

    def test_complete_workflow(self):
        admin, reader = self.client(), self.client()
        self.request(admin, 'bootstrap', status=401)
        self.request(admin, 'login', {'email':'admin@atlas.local','password':'incorrect'}, status=401)
        self.request(admin, 'login', {'email':'admin@atlas.local','password':'test-admin-password'})
        initial = self.request(admin, 'bootstrap')
        self.assertEqual(len(initial['documents']), 8)
        self.assertTrue(any(d['status']=='draft' for d in initial['documents']))
        self.request(admin, 'users', {'name':'Test Reader','email':'reader@example.com','password':'test-reader-password','role':'reader','department_ids':['leadership']})
        self.request(reader, 'login', {'email':'reader@example.com','password':'test-reader-password'})
        visible = self.request(reader, 'bootstrap')
        self.assertEqual(visible['documents'], [])
        self.assertEqual(visible['spaces'], [])
        self.assertEqual(visible['user']['folder_ids'], [])
        reader_id = next(u['id'] for u in self.request(admin,'users') if u['email']=='reader@example.com')
        self.request(admin,'users/access',{'id':reader_id,'folder_ids':[1,2]})
        visible = self.request(reader,'bootstrap')
        self.assertEqual({f['id'] for f in visible['spaces']},{1,2})
        self.assertEqual(len(visible['documents']),3)
        self.assertEqual(visible['user']['folder_ids'],[1,2])
        self.assertNotIn('Design system foundations',json.dumps(visible))
        self.assertNotIn('Q4 product roadmap',json.dumps(visible))
        self.assertTrue(all(d['space_id'] in (1,2) for d in visible['documents']))
        self.store.tables['kb_documents'][0]['body']='Text before\n\n[Image: files/1/test.png]\n\nText after'
        image_doc=self.request(reader,'documents/1')
        self.assertEqual(image_doc['images'][0]['url'],'/api/documents/1/images/0')
        with patch('server.fetch_image',return_value=(b'\x89PNG\r\n\x1a\n','image/png')) as fetch:
            response=reader.open(self.url+'documents/1/images/0')
            self.assertEqual(response.headers['Content-Type'],'image/png')
            self.assertEqual(response.headers['Cache-Control'],'private, no-store')
            self.assertTrue(response.read().startswith(b'\x89PNG'))
            self.request(reader,'documents/2/images/0',status=404)
            self.assertEqual(fetch.call_count,1)

        self.request(reader,'documents/2',status=404)
        self.request(reader,'documents/7',status=404)
        self.request(reader,'documents/9999',status=404)
        self.request(admin,'documents/7')
        self.request(reader,'users/access',{'id':reader_id,'folder_ids':[3]},status=403)
        self.request(admin,'users/access',{'id':reader_id,'folder_ids':[1,9999]},status=400)
        self.request(admin,'users/access',{'id':reader_id,'folder_ids':['1']},status=400)
        self.request(admin,'users/access',{'id':reader_id},status=400)
        self.request(admin,'users/access',{'id':1,'folder_ids':[]},status=400)
        self.request(admin,'users/access',{'id':9999,'folder_ids':[]},status=404)
        self.assertEqual({f['id'] for f in self.request(reader,'bootstrap')['spaces']},{1,2})
        self.assertTrue(all(d['status']=='published' for d in visible['documents']))
        for endpoint, payload in [('documents',{'title':'Forbidden','space_id':1}),('settings',{'workspace_name':'Forbidden'}),('users',{}),('spaces',{'name':'Forbidden'}),('documents/delete',{'id':1})]:
            self.request(reader, endpoint, payload, status=403)
        doc = {'title':'Integration document','body':'Persisted content','space_id':1,'status':'draft'}
        doc['id'] = self.request(admin, 'documents', doc)['id']
        self.assertEqual(self.request(admin,'documents/'+str(doc['id']))['status'],'draft')
        self.assertFalse(any(d['id']==doc['id'] for d in self.request(reader,'bootstrap')['documents']))
        self.request(reader,'documents/'+str(doc['id']),status=404)
        self.request(reader,'documents/'+str(doc['id'])+'/images/0',status=404)
        doc['status'] = 'published'
        self.request(admin, 'documents', doc)
        self.assertTrue(any(d['id']==doc['id'] for d in self.request(reader,'bootstrap')['documents']))
        self.assertEqual(server.STORE.one('kb_documents',{'id':'eq.'+str(doc['id'])})['body'],'Persisted content')
        doc['space_id'] = 3
        self.request(admin, 'documents', doc)
        self.assertFalse(any(d['id']==doc['id'] for d in self.request(reader,'bootstrap')['documents']))
        self.request(reader,'documents/'+str(doc['id']),status=404)
        doc['space_id'] = 1
        doc['status'] = 'draft'
        self.request(admin, 'documents', doc)
        self.assertFalse(any(d['id']==doc['id'] for d in self.request(reader,'bootstrap')['documents']))
        self.request(admin, 'documents/delete', {'id':doc['id']})
        self.request(admin, 'users/delete', {'id':1},status=400)
        self.request(admin, 'settings', {'workspace_name':'Test workspace'})
        self.assertEqual(self.request(reader,'bootstrap')['settings']['workspace_name'],'Test workspace')
        self.request(admin, 'spaces', {'name':'New space'})
        self.request(admin, 'spaces', {'name':'New space'},status=409)
        self.assertEqual({f['id'] for f in self.request(reader,'bootstrap')['spaces']},{1,2})
        self.request(admin,'users/access',{'id':reader_id,'folder_ids':[]})
        self.assertEqual(self.request(reader,'bootstrap')['documents'],[])
        self.assertEqual(self.request(reader,'bootstrap')['spaces'],[])
        self.request(reader,'documents/1',status=404)
        with patch('server.fetch_image') as fetch:
            self.request(reader,'documents/1/images/0',status=404)
            fetch.assert_not_called()
        self.request(admin,'users',{'name':'Enabled Reader','email':'enabled@example.com','password':'another-test-password','role':'reader','department_ids':['leadership'],'folder_ids':[3]})
        enabled=self.client()
        self.request(enabled,'login',{'email':'enabled@example.com','password':'another-test-password'})
        self.assertEqual({f['id'] for f in self.request(enabled,'bootstrap')['spaces']},{3})
        self.assertEqual(len(self.request(enabled,'bootstrap')['documents']),1)
        server.STORE = self.store # Sessions and grants live in storage, not a server session dictionary.
        self.assertEqual({f['id'] for f in self.request(enabled,'bootstrap')['spaces']},{3})
        enabled_id=next(u['id'] for u in self.request(admin,'users') if u['email']=='enabled@example.com')
        self.request(admin,'users/delete',{'id':enabled_id})
        self.request(enabled,'bootstrap',status=401)
        self.assertIsNone(server.STORE.one('kb_users',{'id':'eq.'+str(enabled_id)}))
        self.request(reader, 'logout', {})
        self.request(reader, 'bootstrap', status=401)
        self.assertTrue(any(c[0]=='kb_documents' and c[2] and c[2].get('space_id')=='in.(1,2)' and c[2].get('status')=='eq.published' for c in self.store.calls))
        self.store.fail=True
        try:
            self.request(admin,'bootstrap',status=503)
        finally:
            self.store.fail=False

    def test_department_and_folder_access_intersection(self):
        store = FakeSupabase(server.password_hash('test-admin-password'))
        # Start with the unconfigured production state, not fixture mappings.
        store.tables['kb_settings'] = [{'key':'workspace_name','value':'Atlas'}]
        with patch.object(server, 'STORE', store):
            admin, reader = self.client(), self.client()
            self.request(admin, 'login', {'email':'admin@atlas.local','password':'test-admin-password'})
            self.request(admin, 'users', {'name':'Department reader','email':'dept@example.com',
                         'password':'test-reader-password','role':'reader','folder_ids':[1,2,3,4]})
            reader_id=store.tables['kb_users'][-1]['id']
            self.request(reader, 'login', {'email':'dept@example.com','password':'test-reader-password'})
            initial=self.request(reader,'bootstrap')
            self.assertEqual(initial['departments'], [])
            self.assertEqual(initial['documents'], [])
            self.assertEqual(len(self.request(admin,'bootstrap')['departments']),10)
            self.request(admin,'departments/folders',{'id':'leadership','folder_ids':[1,2]})
            self.request(admin,'departments/folders',{'id':'hr','folder_ids':[2,3]})
            self.request(admin,'departments/folders',{'id':'admin','folder_ids':[4]})
            self.request(admin,'users/access',{'id':reader_id,'department_ids':['leadership'],'folder_ids':[1,3,4]})
            visible=self.request(reader,'bootstrap')
            self.assertEqual(visible['user']['folder_ids'],[1])
            self.assertEqual(visible['departments'],[{'id':'leadership','name':'Leadership','folder_ids':[1]}])
            self.assertEqual(visible['settings'],{'workspace_name':'Atlas'})
            self.assertEqual({d['space_id'] for d in visible['documents']},{1})
            self.request(reader,'documents/3',status=404) # Department alone does not grant folder 2.
            self.request(reader,'documents/4',status=404) # Folder alone does not grant HR access.
            self.request(reader,'departments/folders',{'id':'leadership','folder_ids':[3]},status=403)
            self.request(reader,'users/access',{'id':reader_id,'department_ids':['hr'],'folder_ids':[3]},status=403)
            self.request(reader,'users',status=403)
            for bad in (['unknown'],[1],None,'hr',[True]):
                self.request(admin,'users/access',{'id':reader_id,'department_ids':bad,'folder_ids':[1]},status=400)
            self.request(admin,'departments/folders',{'id':'hr','folder_ids':[999]},status=400)
            self.request(admin,'departments/folders',{'id':'missing','folder_ids':[1]},status=400)
            self.assertEqual(self.request(reader,'bootstrap')['user']['folder_ids'],[1])

            # A mapping change applies to the next request on the same session.
            self.request(admin,'departments/folders',{'id':'leadership','folder_ids':[2]})
            self.request(reader,'documents/1',status=404)
            self.request(reader,'documents/1/images/0',status=404)
            self.request(reader,'documents/1/attachments/0',status=404)
            self.assertEqual(self.request(reader,'vsa',{'question':'Example'})['sources'],[])
            self.assertEqual(self.request(reader,'bootstrap')['documents'],[])

            # Shared folders are accessible through either granted department.
            self.request(admin,'users/access',{'id':reader_id,'department_ids':['leadership','hr'],'folder_ids':[2,3]})
            self.assertEqual(self.request(reader,'bootstrap')['user']['folder_ids'],[2,3])
            self.request(reader,'documents/7',status=404) # Drafts stay private.
            self.request(admin,'users/access',{'id':reader_id,'department_ids':[],'folder_ids':[2,3]})
            self.assertEqual(self.request(reader,'bootstrap')['documents'],[])

            # The department called Admin does not confer management privileges.
            self.request(admin,'users/access',{'id':reader_id,'department_ids':['admin'],'folder_ids':[4]})
            self.assertEqual(self.request(reader,'bootstrap')['user']['role'],'reader')
            self.request(reader,'settings',{'workspace_name':'Unauthorized'},status=403)
            self.request(reader,'documents/2')

            # Both grant sets are replaced in a single storage write.
            before=store.one('kb_settings',{'key':'eq.department_access:'+str(reader_id)},order='key.asc')['value']
            original=store.upsert
            def fail_access(table, data, conflict):
                if data['key'].startswith('department_access:'):
                    raise server.StorageError('Simulated write failure')
                return original(table,data,conflict)
            with patch.object(store,'upsert',side_effect=fail_access):
                self.request(admin,'users/access',{'id':reader_id,'department_ids':['hr'],'folder_ids':[3]},status=503)
                failed=self.request(admin,'users',{'name':'Pending reader','email':'pending@example.com',
                    'password':'test-reader-password','role':'reader','department_ids':['hr'],'folder_ids':[3]},status=503)
                self.assertIn('Account created',failed['error'])
            self.assertEqual(store.one('kb_settings',{'key':'eq.department_access:'+str(reader_id)},order='key.asc')['value'],before)
            self.assertEqual(self.request(reader,'bootstrap')['user']['folder_ids'],[4])
            pending=self.client()
            self.request(pending,'login',{'email':'pending@example.com','password':'test-reader-password'})
            self.assertEqual(self.request(pending,'bootstrap')['documents'],[])

    def test_reader_edits_require_admin_approval(self):
        store=FakeSupabase(server.password_hash('test-admin-password'))
        with patch.object(server,'STORE',store):
            admin,reader,other=self.client(),self.client(),self.client()
            self.request(admin,'login',{'email':'admin@atlas.local','password':'test-admin-password'})
            for name in ('reader','other'):
                self.request(admin,'users',{'name':name,'email':name+'@example.com','password':'test-reader-password',
                    'role':'reader','department_ids':['leadership'],'folder_ids':[1]})
            self.request(reader,'login',{'email':'reader@example.com','password':'test-reader-password'})
            self.request(other,'login',{'email':'other@example.com','password':'test-reader-password'})
            def proposal():
                doc=self.request(reader,'documents/1')
                return {'id':1,'title':'Proposed title','body':'Updated instructions','space_id':1,'base_version':doc['version']}
            data=proposal()
            self.request(reader,'revisions',data,status=403)
            self.request(admin,'users/access',{'id':2,'folder_ids':[1],'department_ids':['leadership'],'can_submit_edits':True})
            self.assertTrue(self.request(reader,'bootstrap')['user']['can_submit_edits'])
            self.request(reader,'documents',{**data,'status':'published'},status=403)
            self.request(reader,'documents',{**data,'status':'draft'},status=403)
            self.request(reader,'revisions',{**data,'id':2},status=404)
            self.request(reader,'revisions',{**data,'space_id':2},status=400)
            self.request(reader,'revisions',{**data,'base_version':'stale'},status=409)
            submitted=self.request(reader,'revisions',{**data,'status':'published','submitted_by':1})
            rid=submitted['revision_id']
            self.assertEqual(self.request(reader,'documents/1')['title'],'Document 1')
            self.assertNotIn('Updated instructions',json.dumps(self.request(other,'bootstrap')))
            self.assertEqual(self.request(other,'revisions'),[])
            self.request(other,'revisions/'+rid,status=404)
            self.request(reader,'revisions/review',{'id':rid,'decision':'approve'},status=403)
            detail=self.request(admin,'revisions/'+rid)
            self.assertEqual(detail['submitted_by'],2)
            self.assertEqual(detail['base']['title'],'Document 1')
            self.assertEqual(detail['proposed']['body'],'Updated instructions')
            self.request(admin,'revisions/review',{'id':rid,'decision':'approve'})
            self.assertEqual(self.request(reader,'documents/1')['body'],'Updated instructions')
            self.assertEqual(self.request(reader,'revisions/'+rid)['status'],'approved')
            self.request(admin,'revisions/review',{'id':rid,'decision':'approve'},status=409)

            rejected=self.request(reader,'revisions',{**proposal(),'body':'Reject this'})['revision_id']
            self.request(admin,'revisions/review',{'id':rejected,'decision':'reject'})
            self.assertEqual(self.request(reader,'documents/1')['body'],'Updated instructions')
            self.assertEqual(self.request(reader,'revisions/'+rejected)['status'],'rejected')

            stale=self.request(reader,'revisions',{**proposal(),'body':'Outdated proposal'})['revision_id']
            self.request(admin,'documents',{'id':1,'title':'New admin version','body':'Newer content','space_id':1,'status':'published'})
            self.request(admin,'revisions/review',{'id':stale,'decision':'approve'},status=409)
            self.assertEqual(self.request(reader,'documents/1')['body'],'Newer content')
            self.assertEqual(self.request(reader,'revisions/'+stale)['status'],'conflict')
            self.request(admin,'users/access',{'id':2,'department_ids':['leadership'],'folder_ids':[1],'can_submit_edits':False})
            self.request(reader,'revisions',proposal(),status=403)
            self.request(admin,'users/access',{'id':2,'department_ids':[],'folder_ids':[1]})
            self.assertEqual(self.request(reader,'revisions'),[])
            self.request(reader,'revisions/'+rid,status=404)


if __name__ == '__main__':
    unittest.main()
