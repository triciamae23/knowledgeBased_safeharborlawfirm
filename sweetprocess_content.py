"""SweetProcess content conversion for the Supabase exporter."""
from html.parser import HTMLParser
import json
import re

class Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.links = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ('script', 'style'):
            self.skip += 1
        if self.skip:
            return
        if tag in ('p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'tr'):
            self.parts.append('\n\n')
        elif tag == 'br':
            self.parts.append('\n')
        elif tag == 'li':
            self.parts.append('\n• ')
        elif tag in ('td', 'th'):
            self.parts.append(' | ')
        elif tag == 'a':
            self.links.append(attrs.get('href', ''))
        elif tag == 'img':
            self.parts.append('\n[Image: ' + attrs.get('alt', attrs.get('src', 'see source document')) + ']\n')
        elif tag in ('iframe', 'video', 'audio', 'source') and attrs.get('src'):
            self.parts.append('\nMedia: ' + attrs['src'] + '\n')

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.skip = max(0, self.skip - 1)
            return
        if self.skip:
            return
        if tag == 'a' and self.links:
            url = self.links.pop()
            if url.startswith(('https://', 'http://', 'mailto:')):
                self.parts.append(' (' + url + ')')
        elif tag in ('p', 'div', 'li', 'ul', 'ol', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            self.parts.append('\n')

    def handle_data(self, value):
        if not self.skip:
            self.parts.append(value)

def plain(value):
    parser = Text()
    parser.feed(value or '')
    return re.sub(r'\n[ \t]*\n(?:[ \t]*\n)+', '\n\n', ''.join(parser.parts).replace('\xa0', ' ')).strip()

def media(block):
    result = []
    for group in ('files', 'images', 'embeds', 'videos'):
        for item in block.get(group, []) or []:
            if not isinstance(item, dict):
                result.append(str(item))
                continue
            ref = item.get('file_ref') or item.get('image_ref')
            if ref:
                result.append('Attachment: ' + item.get('file_name', ref) + '\nSource file reference: ' + ref)
            if item.get('embed_ref'):
                result.append('Media: ' + item['embed_ref'])
            elif item.get('embed_html'):
                result.append(plain(item['embed_html']))
    if block.get('image_ref'):
        result.append('Image reference: ' + block['image_ref'])
    return '\n\n'.join(result)

def folder_paths(folders):
    lookup = {f['hashid']: f for f in folders}
    def path(key, seen=None):
        seen = set() if seen is None else seen
        if key in seen:
            raise ValueError('Cyclic folder hierarchy')
        seen.add(key)
        f = lookup[key]
        parent = f.get('parent')
        return (path(parent, seen) + ' / ' if parent in lookup else '') + f['name']
    return {key: path(key) for key in lookup}

def render(record, paths):
    connections = sorted({paths.get(c['folder']['hashid'], c['folder']['name']) for c in record.get('connections', []) if c.get('folder')})
    heading = [
        'Source: ' + record['html_url'],
        'SweetProcess ' + record['content_type'].capitalize(),
        'Source author: ' + (record.get('author') or {}).get('name', 'Unknown'),
        'Source modified: ' + record['modified_at'],
        'Source status: ' + ('Approved' if record.get('approved_at') else 'Draft'),
    ]
    if connections:
        heading.append('Source folders: ' + '; '.join(connections))
    chunks = ['\n'.join(heading)]
    if record['content_type'] == 'procedure':
        desc = record.get('description') or {}
        chunks += [plain(desc.get('content', '')), media(desc)]
        steps = json.loads(record['content']) if isinstance(record['content'], str) else record['content']
        labels = {s['id']: 'Step ' + str(s.get('n', i + 1)) + (': ' + s['title'] if s.get('title') else '') for i, s in enumerate(steps)}
        for i, step in enumerate(steps):
            chunks += [labels[step['id']], plain(step.get('content', '')), media(step)]
            for choice in step.get('choices', []) or []:
                chunks.append('Decision: ' + choice.get('name', '') + ' → ' + labels.get(choice.get('dest'), str(choice.get('dest') or 'End')))
            if step.get('next'):
                chunks.append('Continue to: ' + labels.get(step['next'], str(step['next'])))
            if step.get('type') == 'ending':
                chunks.append('End of this branch.')
    else:
        chunks += [plain(record.get('content', '')), media(record.get('attachments') or {})]
    return '\n\n'.join(c for c in chunks if c), connections

