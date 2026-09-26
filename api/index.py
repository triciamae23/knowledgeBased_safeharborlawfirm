"""Vercel entrypoint for the existing standard-library HTTP application."""
from threading import Lock

import server
from supabase_store import StorageError, SupabaseStore

_store_lock = Lock()


class handler(server.Handler):
    def _prepare_store(self):
        try:
            with _store_lock:
                if server.STORE is None:
                    server.STORE = SupabaseStore()
            return True
        except StorageError as error:
            self.send_json({'error': str(error)}, error.status)
            return False

    def do_GET(self):
        # Serve the login page even when database configuration is missing.
        if self.path.startswith('/api/') and not self._prepare_store():
            return
        super().do_GET()

    def do_POST(self):
        if self._prepare_store():
            super().do_POST()
