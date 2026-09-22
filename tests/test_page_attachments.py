import base64
import json
import unittest

from page_attachments import attachment_bytes, embedded_images
from supabase_store import StorageError


class PageAttachmentsTests(unittest.TestCase):
    def test_inline_and_gallery_images_keep_order(self):
        first = 'data:image/gif;base64,' + base64.b64encode(b'GIF89a inline').decode()
        second = 'data:image/gif;base64,' + base64.b64encode(b'GIF89a gallery').decode()
        doc = {'body': '::rich2::' + json.dumps({
            'content': '<p>Step <img src="' + first + '" alt="First"></p>',
            'media': [{'kind':'image','src':second,'name':'Second'}],
        })}
        self.assertEqual([item['alt'] for item in embedded_images(doc)], ['First', 'Second'])
        self.assertEqual(attachment_bytes(doc, 1), (b'GIF89a gallery', 'image/gif'))
        with self.assertRaises(StorageError):
            attachment_bytes(doc, 2)

    def test_external_or_invalid_images_are_not_exposed(self):
        doc = {'body': '::rich::<img src="https://example.com/a.png"><img src="data:image/png;base64,AAAA">'}
        self.assertEqual(len(embedded_images(doc)), 1)
        with self.assertRaises(StorageError):
            attachment_bytes(doc, 0)


if __name__ == '__main__':
    unittest.main()
