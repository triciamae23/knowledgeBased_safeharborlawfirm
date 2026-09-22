"""Server-only Supabase REST storage. No local database fallback."""
import datetime
import re
import json
import os
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent


class StorageError(Exception):
    def __init__(self, message, status=503):
        super().__init__(message)
        self.status = status


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def configuration():
    env = ROOT / '.env'
    if env.exists():
        for line in env.read_text().splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                key, value = line.split('=', 1)
                os.environ.setdefault(key.strip(), value.strip().strip('\"\''))
    url = os.environ.get('SUPABASE_URL', '').rstrip('/')
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.path or parsed.query or parsed.fragment or parsed.username or not key:
        raise StorageError('Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.')
    return url, key


class SupabaseStore:
    def __init__(self):
        self.url, key = configuration()
        self.headers = {'apikey': key, 'Content-Type': 'application/json'}
        if not key.startswith('sb_secret_'):
            self.headers['Authorization'] = 'Bearer ' + key

    def request(self, resource, method='GET', params=None, data=None, prefer=None):
        suffix = '?' + urllib.parse.urlencode(params) if params else ''
        headers = dict(self.headers)
        if prefer:
            headers['Prefer'] = prefer
        request = urllib.request.Request(self.url+'/rest/v1/'+resource+suffix, method=method, headers=headers, data=json.dumps(data).encode() if data is not None else None)
        try:
            with urllib.request.build_opener(NoRedirect()).open(request, timeout=45) as response:
                content = response.read()
                return json.loads(content) if content else None
        except urllib.error.HTTPError as error:
            try:
                code = json.loads(error.read()).get('code')
            except (ValueError, AttributeError):
                code = None
            if code in ('PGRST205', 'PGRST202'):
                raise StorageError('Supabase app schema is missing. Run supabase/atlas_schema.sql.') from None
            if error.code == 409:
                raise StorageError('That record already exists or is still in use.', 409) from None
            if code == '23514':
                raise StorageError('The record contains invalid values.', 400) from None
            raise StorageError('Supabase request failed (HTTP '+str(error.code)+'). No local database fallback is used.') from None
        except (urllib.error.URLError, TimeoutError, OSError):
            raise StorageError('Supabase is unavailable. Please try again.') from None

    def rows(self, table, filters=None, select='*', order='id.asc', limit=None):
        rows, offset = [], 0
        while True:
            size = min(limit-len(rows), 500) if limit is not None else 500
            if size <= 0:
                return rows
            params = {'select':select, 'order':order, 'limit':size, 'offset':offset, **(filters or {})}
            batch = self.request(table, params=params)
            rows.extend(batch)
            # Continue until empty: custom PostgREST limits may be below 500.
            if not batch or (limit is not None and len(rows) >= limit):
                return rows
            offset += len(batch)

    def one(self, table, filters, select='*', order='id.asc'):
        rows = self.rows(table, filters, select, order, limit=1)
        return rows[0] if rows else None

    def insert(self, table, data):
        return self.request(table, 'POST', data=data, prefer='return=representation')[0]

    def update(self, table, filters, data):
        return self.request(table, 'PATCH', params=filters, data=data, prefer='return=representation')

    def delete(self, table, filters):
        return self.request(table, 'DELETE', params=filters, prefer='return=minimal')

    def upsert(self, table, data, conflict):
        return self.request(table, 'POST', params={'on_conflict':conflict}, data=data, prefer='resolution=merge-duplicates,return=representation')

    def rpc(self, name, data):
        return self.request('rpc/'+name, 'POST', data=data)


def parse_timestamp(value):
    """Accept PostgreSQL's variable-width fractional seconds on Python 3.9."""
    value = value.replace('Z', '+00:00')
    value = re.sub(r'\.(\d+)(?=[+-]\d{2}:\d{2}$|$)', lambda m: '.' + m.group(1)[:6].ljust(6, '0'), value)
    result = datetime.datetime.fromisoformat(value)
    return result if result.tzinfo else result.replace(tzinfo=datetime.timezone.utc)
