"""Download the authorized SweetProcess library without modifying the source."""
import json
import time
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'sweetprocess_data'

def get(url):
    if not url.startswith('https://www.sweetprocess.com/api/'):
        raise ValueError('Unexpected API host')
    token = next(line.split('=', 1)[1].strip() for line in (ROOT / '.env').read_text().splitlines() if line.startswith('SWEETPROCESS_API_TOKEN='))
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={'Authorization': 'Token ' + token})
            with urllib.request.urlopen(req, timeout=60) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == 3:
                raise RuntimeError('SweetProcess HTTP ' + str(error.code)) from None
            time.sleep(3 * (attempt + 1))

def main():
    OUT.mkdir(mode=0o700, exist_ok=True)
    for endpoint in ('procedures', 'policy', 'folders'):
        rows, pages = [], []
        url = 'https://www.sweetprocess.com/api/v1/' + endpoint + '/'
        while url:
            page = get(url)
            pages.append(page)
            rows.extend(page['results'])
            url = page['next']
            print(endpoint, len(rows), '/', page['count'], flush=True)
        if len(rows) != pages[0]['count'] or len({r['id'] for r in rows}) != len(rows):
            raise RuntimeError('Incomplete or duplicate listing')
        (OUT / (endpoint + '.json')).write_text(json.dumps(rows, ensure_ascii=False, indent=2))
        (OUT / (endpoint + '_pages.json')).write_text(json.dumps(pages, ensure_ascii=False))

if __name__ == '__main__':
    main()
