import json
import os
import unittest
from unittest.mock import patch

from azure_chat import chat


class FakeResponse:
    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self):
        return b'{"choices":[{"message":{"content":"Follow the vacation request steps [Page 1]."}}]}'


class AzureChatTests(unittest.TestCase):
    def test_uses_published_sources_and_server_side_key(self):
        docs = [
            {'id': 1, 'title': 'Vacation request', 'body': 'Submit a vacation request to your manager.', 'space': 'HR', 'status': 'published'},
            {'id': 2, 'title': 'Vacation secret draft', 'body': 'Do not share this vacation draft.', 'space': 'HR', 'status': 'draft'},
        ]
        env = {'AZURE_OPENAI_ENDPOINT': 'https://example.openai.azure.com', 'AZURE_OPENAI_API_KEY': 'test-private-key', 'AZURE_OPENAI_DEPLOYMENT': 'test-deployment'}
        with patch.dict(os.environ, env), patch('azure_chat.request.urlopen', return_value=FakeResponse()) as post:
            result = chat('How do I request vacation?', [], docs)
        request = post.call_args.args[0]
        payload = json.loads(request.data)
        self.assertIn('Submit a vacation request', payload['messages'][0]['content'])
        self.assertNotIn('secret draft', payload['messages'][0]['content'].lower())
        self.assertEqual(request.get_header('Api-key'), 'test-private-key')
        self.assertEqual(result['sources'], [{'id': 1, 'title': 'Vacation request', 'folder': 'HR'}])
        self.assertNotIn('test-private-key', json.dumps(result))

    def test_no_match_does_not_call_azure(self):
        with patch('azure_chat.request.urlopen') as post:
            result = chat('quasar telescope', [], [])
        self.assertEqual(result['sources'], [])
        post.assert_not_called()


if __name__ == '__main__':
    unittest.main()
