import unittest
from unittest.mock import Mock
from document_images import media_ref,image_manifest,image_type
from supabase_store import StorageError

class ImagesTest(unittest.TestCase):
    def test_manifest_preserves_order_and_handles_alt_text(self):
        store=Mock()
        store.rows.return_value=[{'raw_json':{'content':'<p><img src="files/1/one.png" alt="Screen"></p>'}}]
        doc={'body':'Before\n\n[Image: files/1/two.png]\n\n[Image: Screen]\n\nAfter','source_type':'procedure','source_id':1}
        images=image_manifest(doc,store)
        self.assertEqual([i['ref'] for i in images],['files/1/two.png','files/1/one.png'])
        self.assertEqual(images[1]['alt'],'Screen')
    def test_references_cannot_fetch_arbitrary_urls(self):
        for value in ('https://127.0.0.1/secret.png','files/../secret.png','files/1/script.svg','https://evil.test/file.png','files/1/test.png?token=1'):
            self.assertIsNone(media_ref(value))
        self.assertEqual(media_ref('https://d1kejwy1bsvw2.cloudfront.net/site_media/media/1000x1000/files/1/test.png'),'files/1/test.png')
    def test_non_image_attachment_is_not_converted(self):
        doc={'body':'Attachment: report.pdf\nSource file reference: files/1/report.pdf'}
        self.assertEqual(image_manifest(doc,Mock()),[])
    def test_response_must_be_raster_image(self):
        self.assertEqual(image_type(b'\x89PNG\r\n\x1a\n'),'image/png')
        with self.assertRaises(StorageError):image_type(b'<html>Login required</html>')

if __name__=='__main__':unittest.main()
