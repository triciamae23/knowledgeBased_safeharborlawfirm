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
        with patch.object(server, 'STORE', store):
            admin, reader = self.client(), self.client()
            self.request(reader, 'vsa', {'question':'vacation'}, status=401)
            self.request(admin, 'login', {'email':'admin@atlas.local','password':'test-admin-password'})
            self.request(admin, 'users', {'name':'VSA Reader','email':'vsa@example.com','password':'test-reader-password','role':'reader'})
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
            self.request(admin, 'users', {'name':'Chat Reader','email':'chat@example.com','password':'test-reader-password','role':'reader'})
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
        self.request(admin, 'users', {'name':'Test Reader','email':'reader@example.com','password':'test-reader-password','role':'reader'})
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
        self.request(admin,'users',{'name':'Enabled Reader','email':'enabled@example.com','password':'another-test-password','role':'reader','folder_ids':[3]})
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


if __name__ == '__main__':
    unittest.main()
