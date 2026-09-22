"""Resolve imported image placeholders without rendering untrusted source HTML."""
import re
from html.parser import HTMLParser
from urllib.parse import urlparse
import urllib.request
import urllib.error

from supabase_store import NoRedirect, StorageError

MEDIA_ROOT = 'https://d1kejwy1bsvw2.cloudfront.net/site_media/media/1000x1000/'
MAX_IMAGE_BYTES = 15 * 1024 * 1024
PLACEHOLDERS = re.compile(r'\[Image: ([^\]\n]*)\]|Image reference: ([^\n]+)|Attachment: [^\n]+\nSource file reference: ([^\n]+)')


def media_ref(value):
    value = value.strip()
    if value.startswith('https://'):
        url = urlparse(value)
        if url.hostname != 'd1kejwy1bsvw2.cloudfront.net' or url.query or url.fragment:
            return None
        match = re.search(r'/site_media/media/(?:\d+x\d+/)?(files/.+)$',url.path)
        if not match:
            return None
        value = match.group(1)
    if not re.fullmatch(r'files/[A-Za-z0-9_./-]+\.(?:png|jpe?g|gif|webp|avif)',value,re.I):
        return None
    if any(part in ('..','.') for part in value.split('/')):
        return None
    return value


class SourceImages(HTMLParser):
    def __init__(self):
        super().__init__()
        self.images = []

    def handle_starttag(self,tag,attrs):
        if tag=='img':
            attrs=dict(attrs)
            ref=media_ref(attrs.get('src',''))
            if ref:
                self.images.append((attrs.get('alt'),ref))


def source_images(value):
    import json
    result=[]
    if isinstance(value,dict):
        for item in value.values():result.extend(source_images(item))
    elif isinstance(value,list):
        for item in value:result.extend(source_images(item))
    elif isinstance(value,str):
        if value.lstrip().startswith(('[','{')):
            try:return source_images(json.loads(value))
            except (ValueError,TypeError):pass
        if '<img' in value.lower():
            parser=SourceImages();parser.feed(value);result.extend(parser.images)
    return result


def image_manifest(doc,store):
    matches=list(PLACEHOLDERS.finditer(doc['body']))
    source=None
    images=[]
    for match in matches:
        label=next((g for g in match.groups() if g is not None),'')
        ref=media_ref(label)
        if not ref and match.group(1) is not None and doc.get('source_type') and doc.get('source_id'):
            if source is None:
                rows=store.rows('sweetprocess_documents',{'source_type':'eq.'+doc['source_type'],'source_id':'eq.'+str(doc['source_id'])},select='raw_json',order='source_id.asc',limit=1)
                source=source_images(rows[0]['raw_json']) if rows else []
            candidates={r for alt,r in source if alt==label}
            if len(candidates)==1:ref=candidates.pop()
        if ref:
            images.append({'start':match.start(),'end':match.end(),'placeholder':match.group(0),'ref':ref,'alt':label if not media_ref(label) else 'Document illustration'})
    return images


def image_type(data):
    if data.startswith(b'\x89PNG\r\n\x1a\n'):return 'image/png'
    if data.startswith(b'\xff\xd8\xff'):return 'image/jpeg'
    if data.startswith((b'GIF87a',b'GIF89a')):return 'image/gif'
    if data[:4]==b'RIFF' and data[8:12]==b'WEBP':return 'image/webp'
    if data[4:8]==b'ftyp' and data[8:12] in (b'avif',b'avis'):return 'image/avif'
    raise StorageError('The source did not return a supported image.',502)


def fetch_image(ref):
    if not media_ref(ref):
        raise StorageError('Invalid image reference.',404)
    request=urllib.request.Request(MEDIA_ROOT+ref,headers={'Accept':'image/png,image/jpeg,image/gif,image/webp,image/avif','Accept-Encoding':'identity'})
    try:
        with urllib.request.build_opener(NoRedirect()).open(request,timeout=30) as response:
            data=response.read(MAX_IMAGE_BYTES+1)
            if len(data)>MAX_IMAGE_BYTES:
                raise StorageError('Image exceeds the size limit.',413)
            return data,image_type(data)
    except (urllib.error.URLError,OSError):
        raise StorageError('This source image is currently unavailable.',502) from None
