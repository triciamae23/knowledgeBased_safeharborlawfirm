"""Deterministic PostgREST test double; never connects to a real project."""
import copy
from supabase_store import SupabaseStore, StorageError


class FakeSupabase(SupabaseStore):
    def __init__(self, password):
        self.tables={
            'kb_users':[{'id':1,'name':'Test Admin','email':'admin@atlas.local','password':password,'role':'admin','folder_ids':[]}],
            'kb_spaces':[{'id':i,'name':'Folder '+str(i),'icon':'folder'} for i in range(1,5)],
            'kb_documents':[{'id':i,'title':'Document '+str(i),'body':'Example body','space_id':f,'author_id':1,'status':'draft' if i in (6,7) else 'published','updated':'2026-09-15T00:00:00+00:00'} for i,f in enumerate((1,4,2,3,4,3,2,1),1)],
            'kb_settings':[{'key':'workspace_name','value':'Atlas'}],
            'kb_sessions':[],
        }
        self.calls=[]
        self.fail=False

    def request(self,resource,method='GET',params=None,data=None,prefer=None):
        if self.fail:
            raise StorageError('Supabase is unavailable. Please try again.')
        self.calls.append((resource,method,copy.deepcopy(params)))
        rows=self.tables[resource]
        params=params or {}
        def matches(row):
            for key,condition in params.items():
                if key in ('select','order','limit','offset','on_conflict'):
                    continue
                op,value=condition.split('.',1)
                actual=str(row.get(key))
                if op=='eq' and actual!=value: return False
                if op=='in' and actual not in value.strip('()').split(','): return False
                if op=='gt' and actual<=value: return False
                if op=='lt' and actual>=value: return False
            return True
        selected=[r for r in rows if matches(r)]
        if method=='GET':
            order=params.get('order','id.asc').split(',')[0].split('.')
            selected=sorted(selected,key=lambda r:r.get(order[0],0),reverse=order[-1]=='desc')
            start=int(params.get('offset',0));selected=selected[start:start+int(params.get('limit',500))]
            fields=params.get('select','*')
            result=[]
            for row in selected:
                item=copy.deepcopy(row)
                if 'author:kb_users' in fields:
                    item['author']={'name':next(u['name'] for u in self.tables['kb_users'] if u['id']==row['author_id'])}
                    item['space']={'name':next(s['name'] for s in self.tables['kb_spaces'] if s['id']==row['space_id'])}
                elif fields!='*':
                    item={key:item[key] for key in fields.split(',')}
                result.append(item)
            return result
        if method=='POST':
            row=copy.deepcopy(data)
            unique={'kb_users':'email','kb_spaces':'name','kb_settings':'key','kb_sessions':'token_hash'}.get(resource)
            duplicate=next((r for r in rows if unique and r[unique]==row[unique]),None)
            if duplicate:
                if params.get('on_conflict'):
                    duplicate.update(row);return [copy.deepcopy(duplicate)]
                raise StorageError('Already exists',409)
            if resource in ('kb_users','kb_spaces','kb_documents'):
                row.setdefault('id',max([r['id'] for r in rows],default=0)+1)
            rows.append(row)
            return [copy.deepcopy(row)]
        if method=='PATCH':
            for row in selected:row.update(copy.deepcopy(data))
            return copy.deepcopy(selected)
        if method=='DELETE':
            self.tables[resource]=[r for r in rows if r not in selected]
            if resource=='kb_users':
                ids={r['id'] for r in selected}
                self.tables['kb_sessions']=[r for r in self.tables['kb_sessions'] if r['user_id'] not in ids]
            return None
        raise AssertionError('Unexpected request')
