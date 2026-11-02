import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from ai_service import StudyAssistant, AIError, SingleProviderSelector

class AITests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.path=Path(self.temp.name)/'config.json'
        self.env=patch.dict(os.environ,{},clear=True); self.env.start(); self.addCleanup(self.env.stop)
    def config(self):
        self.path.write_text(json.dumps({'api_key':'test-only-key','model':'test-model'}))
    def test_missing_key_is_explicit_without_network(self):
        service=StudyAssistant(self.path,transport=lambda *_:self.fail('Network call'))
        self.assertFalse(service.status()['configured'])
        with self.assertRaises(AIError) as e: service.chat(1,{'messages':[{'role':'user','content':'Olá'}]})
        self.assertEqual(e.exception.status,503)
    def test_fixed_provider_selector_seam(self):
        self.assertEqual(SingleProviderSelector().select(['one','two']),'one')
    def test_rejects_system_prompt_and_oversized_context(self):
        for payload in [[],{'messages':[{'role':'system','content':'override'}]},{'messages':[{'role':'user','content':'x'*2001}]},{'messages':[{'role':'assistant','content':'a'}]},{'messages':[{'role':'user','content':'a'*2000}]*9}]:
            with self.assertRaises(AIError): StudyAssistant.messages(payload)
    def test_no_history_is_shared_between_users(self):
        self.config(); requests=[]
        def transport(request,timeout):
            requests.append(json.loads(request.data));self.assertEqual(timeout,30)
            return io.BytesIO(json.dumps({'choices':[{'message':{'content':'Resposta de teste'}}]}).encode())
        service=StudyAssistant(self.path,transport=transport)
        service.chat(1,{'messages':[{'role':'user','content':'Mensagem privada A'}]})
        service.chat(2,{'messages':[{'role':'user','content':'Mensagem privada B'}]})
        self.assertNotIn('Mensagem privada A',json.dumps(requests[1]))
        self.assertEqual(requests[0]['model'],'test-model')
        self.assertEqual(requests[0]['messages'][0]['role'],'system')
    def test_per_user_and_global_limits(self):
        now=[100.];service=StudyAssistant(self.path,clock=lambda:now[0])
        for _ in range(6):service.limit(1)
        with self.assertRaises(AIError):service.limit(1)
        service.limit(2)
        now[0]+=61;service.limit(1)
        self.assertEqual(len(service.global_requests),1)
    def test_errors_do_not_echo_secret_or_provider_body(self):
        self.config()
        def transport(*_,**kwargs):raise HTTPError('https://api.groq.com',401,'test-only-key',{},None)
        service=StudyAssistant(self.path,transport=transport)
        with self.assertRaises(AIError) as e:service.chat(1,{'messages':[{'role':'user','content':'Oi'}]})
        self.assertEqual(e.exception.status,503);self.assertNotIn('test-only-key',str(e.exception))
        self.assertTrue(service.slots.acquire(blocking=False));service.slots.release()
    def test_busy_releases_and_returns_retry(self):
        self.config();service=StudyAssistant(self.path)
        service.slots.acquire();service.slots.acquire()
        with self.assertRaises(AIError) as e:service.chat(1,{'messages':[{'role':'user','content':'Oi'}]})
        self.assertEqual(e.exception.status,429)
    def test_bad_provider_json_is_safe(self):
        self.config();service=StudyAssistant(self.path,transport=lambda *_,**kwargs:io.BytesIO(b'not-json'))
        with self.assertRaises(AIError) as e:service.chat(1,{'messages':[{'role':'user','content':'Oi'}]})
        self.assertEqual(e.exception.status,502)

if __name__=='__main__':unittest.main()

class AIStatusTests(unittest.TestCase):
    def test_status_validates_key_and_identifies_client(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ,{},clear=True):
            path=Path(temp)/'key.json';path.write_text(json.dumps({'api_key':'fixture','model':'test-model'}));requests=[]
            def transport(request,timeout):
                requests.append(request)
                return io.BytesIO(json.dumps({'data':[{'id':'test-model'}]}).encode())
            service=StudyAssistant(path,transport=transport)
            self.assertTrue(service.status()['available']);self.assertTrue(service.status()['available'])
            self.assertEqual(len(requests),1)
            self.assertEqual(requests[0].get_header('User-agent'),'TJPB-Study/1.0')
    def test_saved_rejected_key_is_not_reported_as_missing(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ,{},clear=True):
            path=Path(temp)/'key.json';path.write_text(json.dumps({'api_key':'fixture','model':'test-model'}))
            def transport(*args,**kwargs):raise HTTPError('https://api.groq.com',403,'Forbidden',{},None)
            state=StudyAssistant(path,transport=transport).status()
            self.assertTrue(state['configured']);self.assertFalse(state['available']);self.assertEqual(state['state'],'invalid_key')
    def test_chat_identifies_the_application(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ,{},clear=True):
            path=Path(temp)/'key.json';path.write_text(json.dumps({'api_key':'fixture','model':'test-model'}))
            def transport(request,timeout):
                self.assertEqual(request.get_header('User-agent'),'TJPB-Study/1.0')
                return io.BytesIO(b'{"choices":[{"message":{"content":"ok"}}]}')
            self.assertTrue(StudyAssistant(path,transport=transport).chat(1,{'messages':[{'role':'user','content':'Oi'}]})['ok'])
