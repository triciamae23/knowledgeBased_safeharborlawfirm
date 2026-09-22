"""Extract relevant passages from authorized, published knowledge pages."""
import re
import json
from html import unescape
from collections import Counter
from math import log

STOP_WORDS = set('a an the is are was were be been to of for in on at and or with from by i we you my our me how what when where who can could should do does please tell about procedure procedures policy policies'.split())


def terms(text):
    words = re.findall(r"[a-z0-9]+", text.lower())
    return [word[:-1] if len(word) > 4 and word.endswith('s') else word
            for word in words if word not in STOP_WORDS and len(word) > 1]


def content_text(body):
    # Strip import provenance, but preserve instructional text and step order.
    if body.startswith('::rich2::'):
        try:
            body = json.loads(body[len('::rich2::'):]).get('content', '')
            body = '::rich::' + body
        except (ValueError, TypeError, AttributeError):
            return ''
    if body.startswith('::rich::'):
        html = body[len('::rich::'):]
        html = re.sub(r'<br\s*/?>|</(?:p|div|li|h[1-6]|tr)>', '\n', html, flags=re.I)
        body = unescape(re.sub(r'<[^>]*>', '', html))
    lines = body.splitlines()
    metadata = re.compile(r'^(?:Source(?: author| modified| status| folders| file reference)?:|SweetProcess (?:Procedure|Policy)$|Image reference:|\[Image:)')
    clean = '\n'.join(line for line in lines if not metadata.match(line.strip()))
    return re.sub(r'\n{3,}', '\n\n', clean).strip()


def answer(question, documents):
    query = set(terms(question))
    pages = [doc for doc in documents if doc['status'] == 'published']
    prepared = [(doc, set(terms(doc['title'])), Counter(terms(content_text(doc['body'])))) for doc in pages]
    frequency = Counter(token for _, title, body in prepared for token in title | set(body))
    weights = {token: log(1 + (len(pages) + 1) / (frequency[token] + 1)) for token in query}
    matches = []
    for doc, title, body in prepared:
        overlap = query & (title | set(body))
        if not overlap or len(overlap) / len(query) < 0.5:
            continue
        score = sum(weights[token] * (15 * (token in title) + min(body[token], 3)) for token in overlap)
        excerpt = content_text(doc['body'])
        matches.append((score, {'id': doc['id'], 'title': doc['title'], 'folder': doc['space'], 'excerpt': excerpt}))
    matches.sort(key=lambda item: (-item[0], item[1]['id']))
    sources = [item[1] for item in matches[:3]]
    return {'message': 'Here is the exact text from the best matching published page.' if sources else 'I couldn’t find a matching published page in your available folders. Try a specific task, policy name, or different keywords.', 'sources': sources, 'answer': sources[0]['excerpt'] if sources else '', 'title': sources[0]['title'] if sources else ''}
