import io
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from http.server import ThreadingHTTPServer
from library_service import DriveLibrary, LibraryError, byte_range, CHUNK_BYTES
import servir


class FakeResponse(io.BytesIO):
    def __init__(self, data=b'1234', status=206, headers=None):
        super().__init__(data)
        self.status=status
        self.headers=headers or {}


class LibraryTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);(self.root/'dados').mkdir()
        self.catalog=[{'id':'v1','nome':'Aula 1.mp4','categoria':'video','mimeType':'video/mp4','tamanho':100},
                      {'id':'p1','nome':'Material.pdf','categoria':'pdf','mimeType':'application/pdf','tamanho':50},
                      {'id':'img1','nome':'Imagem.png','categoria':'imagem','mimeType':'image/png','tamanho':20}]
        self.tree={'id':'root','name':'TJPB','type':'folder','children':[{'id':'course','name':'01 - Dados','type':'folder','children':[{'id':'lesson','name':'01 - Conceitos','type':'folder','children':[{'id':'technical','name':'videos','type':'folder','children':[{'id':'v1','name':'Aula 1.mp4','type':'file'}]},{'id':'pdfs','name':'pdfs','type':'folder','children':[{'id':'p1','name':'Material.pdf','type':'file'}]},{'id':'img1','name':'Imagem.png','type':'file'}]}]}]}
        (self.root/'dados/drive_catalog.json').write_text(json.dumps(self.catalog));(self.root/'dados/drive_tree.json').write_text(json.dumps(self.tree))
        (self.root/'token.json').write_text(json.dumps({'token':'fake-secret-test','expiry':'2099-01-01T00:00:00Z'}))
        self.library=DriveLibrary(self.root)
    def tearDown(self): self.tmp.cleanup()
    def test_hierarchy_keeps_lesson_and_flattens_assets(self):
        data=self.library.catalog();lesson=data['courses'][0]['tree']['children'][0]
        self.assertEqual(lesson['name'],'01 - Conceitos');self.assertEqual({n['type'] for n in lesson['children']},{'video','pdf'})
        self.assertEqual((data['videos'],data['pdfs']),(1,1));self.assertNotIn('fake-secret-test',json.dumps(data));self.assertNotIn('drive_url',json.dumps(data))
    def test_unknown_id_denied_without_network(self):
        with self.assertRaises(LibraryError) as e:self.library.media('outside','bytes=0-3')
        self.assertEqual(e.exception.status,404)
    def test_image_denied(self):
        with self.assertRaises(LibraryError):self.library.media('img1',None)
    def test_head_does_not_fetch_oauth_or_drive(self):
        self.library.access_token=lambda: (_ for _ in ()).throw(AssertionError('Network'))
        status,headers,response=self.library.media('v1','bytes=0-9',head=True)
        self.assertEqual((status,headers['Content-Length'],response),(206,'10',None))
    def test_no_range_is_full_200(self):
        self.assertEqual(byte_range(None,100),(0,99,200))
    def test_suffix_range(self):self.assertEqual(byte_range('bytes=-20',100),(80,99,206))
    def test_requested_end_is_clamped(self):self.assertEqual(byte_range('bytes=90-999',100),(90,99,206))
    def test_large_range_is_streamed_in_bounded_chunks(self):self.assertEqual(byte_range('bytes=0-',CHUNK_BYTES*2),(0,CHUNK_BYTES-1,206))
    def test_invalid_ranges(self):
        for value in ['bytes=-0','bytes=','bytes=100-','bytes=9-2','bytes=0-2,3-4','wat','bytes=-']:
            with self.subTest(value=value),self.assertRaises(LibraryError):byte_range(value,100)
    def test_upstream_range_must_match(self):
        response=FakeResponse(headers={'Content-Range':'bytes 1-4/100'})
        self.library.opener=lambda *a,**k:response
        with self.assertRaises(LibraryError):self.library.media('v1','bytes=0-3')
        self.assertTrue(response.closed)
    def test_token_only_goes_to_google_header(self):
        captured=[]
        def opener(req,**kwargs):captured.append(req);return FakeResponse(headers={'Content-Range':'bytes 0-3/100'})
        self.library.opener=opener
        status,headers,response=self.library.media('v1','bytes=0-3')
        self.assertEqual(status,206);self.assertEqual(captured[0].get_header('Authorization'),'Bearer fake-secret-test')
        self.assertNotIn('fake-secret-test',captured[0].full_url);self.assertNotIn('fake-secret-test',json.dumps(headers));response.close()
    def test_network_error_is_redacted(self):
        def opener(*a,**k):raise HTTPError('https://www.googleapis.com',403,'fake-secret-test',{},None)
        self.library.opener=opener
        with self.assertRaises(LibraryError) as e:self.library.media('v1','bytes=0-3')
        self.assertNotIn('fake-secret-test',str(e.exception))
    def test_stream_limit_per_user_and_release(self):
        with self.library.stream_slot(1),self.library.stream_slot(1):
            with self.assertRaises(LibraryError) as e:
                with self.library.stream_slot(1): pass
            self.assertEqual(e.exception.status,429)
        with self.library.stream_slot(1): pass
    def test_missing_catalog_fails_closed(self):
        with self.assertRaises(LibraryError):DriveLibrary(self.root/'missing').catalog()
    def test_expired_oauth_refresh_is_atomic_and_private(self):
        path=self.root/'token.json'
        path.write_text(json.dumps({'token':'old','expiry':'2000-01-01T00:00:00Z','refresh_token':'refresh-test','client_id':'client-test','client_secret':'secret-test'}))
        def opener(request,**kwargs):
            self.assertEqual(request.full_url,'https://oauth2.googleapis.com/token')
            return FakeResponse(json.dumps({'access_token':'renewed-test','expires_in':3600}).encode(),status=200)
        self.library.opener=opener
        self.assertEqual(self.library.access_token(),'renewed-test')
        self.assertEqual(path.stat().st_mode&0o777,0o600)
        self.assertEqual(json.loads(path.read_text())['refresh_token'],'refresh-test')
        self.assertFalse(path.with_name('token.refresh.tmp').exists())
    def test_huge_range_number_is_rejected_cleanly(self):
        with self.assertRaises(LibraryError) as e:byte_range('bytes='+('9'*5000)+'-',100)
        self.assertEqual(e.exception.status,416)


class LibraryHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.auth=patch.object(servir.auth_db,'get_user_by_token',side_effect=lambda token:{'id':1,'nome':'Teste','username':'teste'} if token=='test-session' else None);cls.auth.start()
        cls.catalog=patch.object(servir.library,'catalog',return_value={'courses':[],'videos':0,'pdfs':0});cls.catalog.start()
        cls.server=ThreadingHTTPServer(('127.0.0.1',0),servir.Handler);cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start();cls.base='http://127.0.0.1:'+str(cls.server.server_port)
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join();cls.auth.stop();cls.catalog.stop()
    def test_anonymous_catalog_is_private(self):
        with self.assertRaises(HTTPError) as e:urlopen(self.base+'/biblioteca/api/tree')
        self.assertEqual(e.exception.code,401);self.assertIn('no-store',e.exception.headers['Cache-Control'])
    def test_anonymous_media_denied_before_drive(self):
        with self.assertRaises(HTTPError) as e:urlopen(self.base+'/biblioteca/api/media/v1')
        self.assertEqual(e.exception.code,401)
    def test_valid_bearer_can_read_catalog(self):
        with urlopen(Request(self.base+'/biblioteca/api/tree',headers={'Authorization':'Bearer test-session'})) as r:self.assertEqual(json.load(r)['courses'],[])
    def test_cookie_is_http_only_scoped_and_secure(self):
        req=Request(self.base+'/api/library/session',data=b'{}',headers={'Authorization':'Bearer test-session','X-Forwarded-Proto':'https'})
        with urlopen(req) as r:
            cookie=r.headers['Set-Cookie'];self.assertIn('HttpOnly',cookie);self.assertIn('Secure',cookie);self.assertIn('Path=/biblioteca',cookie);self.assertIn('SameSite=Strict',cookie)
    def test_invalid_session_cannot_get_cookie(self):
        with self.assertRaises(HTTPError) as e:urlopen(Request(self.base+'/api/library/session',data=b'{}'))
        self.assertEqual(e.exception.code,401);self.assertIn('Max-Age=0',e.exception.headers['Set-Cookie'])
    def test_media_cookie_can_read_tree(self):
        with urlopen(Request(self.base+'/biblioteca/api/tree',headers={'Cookie':'tjpb_library=test-session'})) as r:self.assertEqual(r.status,200)
    def test_logout_expires_media_cookie(self):
        with urlopen(Request(self.base+'/api/library/logout',data=b'{}')) as r:self.assertIn('Max-Age=0',r.headers['Set-Cookie'])
    def test_credentials_are_not_public(self):
        for path in ['/token.json','/credentials.json','/dados/drive_catalog.json','/groq-config.json']:
            with self.subTest(path=path),self.assertRaises(HTTPError) as e:urlopen(self.base+path)
            self.assertEqual(e.exception.code,404)

    def test_ai_requires_authentication(self):
        for request in [Request(self.base+'/api/ai/status'),Request(self.base+'/api/ai/chat',data=b'{}')]:
            with self.assertRaises(HTTPError) as e:urlopen(request)
            self.assertEqual(e.exception.code,401)
    def test_ai_private_status(self):
        with patch.object(servir.assistant,'status',return_value={'ok':True,'configured':False}):
            with urlopen(Request(self.base+'/api/ai/status',headers={'Authorization':'Bearer test-session'})) as r:
                self.assertFalse(json.load(r)['configured']);self.assertIn('no-store',r.headers['Cache-Control'])
    def test_ai_rejects_oversized_body(self):
        with self.assertRaises(HTTPError) as e:urlopen(Request(self.base+'/api/ai/chat',data=b'x'*40001,headers={'Authorization':'Bearer test-session'}))
        self.assertEqual(e.exception.code,413)



    def test_ai_chat_passes_only_authenticated_identity(self):
        payload={'messages':[{'role':'user','content':'Explique SQL'}]}
        with patch.object(servir.assistant,'chat',return_value={'ok':True,'answer':'Resposta simulada'}) as chat:
            req=Request(self.base+'/api/ai/chat',data=json.dumps(payload).encode(),headers={'Authorization':'Bearer test-session'})
            with urlopen(req) as r:self.assertEqual(json.load(r)['answer'],'Resposta simulada')
            chat.assert_called_once_with(1,payload)
    def test_unconfigured_ai_is_actionable(self):
        from ai_service import AIError
        with patch.object(servir.assistant,'chat',side_effect=AIError(503,'IA aguardando configuração.')):
            req=Request(self.base+'/api/ai/chat',data=b'{}',headers={'Authorization':'Bearer test-session'})
            with self.assertRaises(HTTPError) as e:urlopen(req)
            self.assertEqual(e.exception.code,503)

if __name__=='__main__':unittest.main()
