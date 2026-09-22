"""Images embedded in editable rich pages, exposed only after page access checks."""
import base64
import binascii
import json
import re
from html.parser import HTMLParser

from document_images import image_type
from supabase_store import StorageError

DATA_IMAGE = re.compile(r'^data:image/(?:png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$')


class InlineImages(HTMLParser):
    def __init__(self):
        super().__init__()
        self.images = []

    def handle_starttag(self, tag, attrs):
        if tag == 'img':
            attrs = dict(attrs)
            self.images.append({'src': attrs.get('src', ''), 'alt': attrs.get('alt', '')})


def embedded_images(doc):
    body = doc.get('body', '')
    if body.startswith('::rich2::'):
        try:
            page = json.loads(body[len('::rich2::'):])
        except (ValueError, TypeError):
            return []
        if not isinstance(page, dict):
            return []
        html = page.get('content', '')
        gallery = page.get('media', [])
    elif body.startswith('::rich::'):
        html, gallery = body[len('::rich::'):], []
    else:
        return []
    parser = InlineImages()
    parser.feed(html if isinstance(html, str) else '')
    images = parser.images
    if isinstance(gallery, list):
        images.extend({'src': item.get('src', ''), 'alt': item.get('name', '')}
                      for item in gallery if isinstance(item, dict) and item.get('kind') == 'image')
    return [item for item in images if isinstance(item['src'], str)
            and len(item['src']) < 750000 and DATA_IMAGE.fullmatch(item['src'])]


def attachment_bytes(doc, index):
    images = embedded_images(doc)
    if index < 0 or index >= len(images):
        raise StorageError('Image not found.', 404)
    match = DATA_IMAGE.fullmatch(images[index]['src'])
    try:
        data = base64.b64decode(match.group(1), validate=True)
        content_type = image_type(data)
    except (ValueError, binascii.Error, StorageError):
        raise StorageError('Image not found.', 404) from None
    return data, content_type
