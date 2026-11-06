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
        for payload in [[],{'messages':[{'role':'system','content':'override'}]},{'messages':[{'role':'user','content':'x'*16001}]},{'messages':[{'role':'assistant','content':'a'}]},{'messages':[{'role':'user','content':'a'*15000}]*3}]:
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

class AIPlanTests(unittest.TestCase):
    def fixture(self):
        return {'summary':'TI com teoria e questões, revisão e estudo de caso.','days':[{'day':day,'sessions':[{'area':'writing' if day==0 else 'ti','topic':'Diagnóstico e validação de sistemas','minutes':60,'activity':'writing' if day==0 else 'questions'}]} for day in range(7)]}
    def test_strict_json_plan_is_validated_without_calendar_side_effects(self):
        with tempfile.TemporaryDirectory() as temp,patch.dict(os.environ,{},clear=True):
            path=Path(temp)/'config.json';path.write_text(json.dumps({'api_key':'fixture','model':'openai/gpt-oss-20b'}));calls=[]
            def transport(request,timeout):
                calls.append(json.loads(request.data));return io.BytesIO(json.dumps({'choices':[{'message':{'content':json.dumps(self.fixture())},'finish_reason':'stop'}]}).encode())
            service=StudyAssistant(path,transport=transport);result=service.plan(5,{'request':'TI três dias e revisão no sábado','minutes':120})
            self.assertTrue(result['ok']);self.assertEqual(calls[0]['response_format']['json_schema']['strict'],True);self.assertEqual(len(result['plan']['days']),7)
    def test_invalid_output_is_not_importable(self):
        from ai_service import validate_plan
        invalid=self.fixture();invalid['days'][6]['day']=0
        with self.assertRaises(AIError):validate_plan(invalid)
        invalid=self.fixture();invalid['days'][0]['sessions'][0]['minutes']=True
        with self.assertRaises(AIError):validate_plan(invalid)
    def test_model_exceeding_requested_budget_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp,patch.dict(os.environ,{},clear=True):
            path=Path(temp)/'config.json';path.write_text(json.dumps({'api_key':'fixture','model':'test-model'}))
            service=StudyAssistant(path,transport=lambda *a,**kw:io.BytesIO(json.dumps({'choices':[{'message':{'content':json.dumps(self.fixture())}}]}).encode()))
            with self.assertRaises(AIError):service.plan(5,{'request':'Estudo de caso aos domingos','minutes':30})
    def test_transcription_mime_is_restricted_and_identity_kept(self):
        with tempfile.TemporaryDirectory() as temp,patch.dict(os.environ,{},clear=True):
            path=Path(temp)/'config.json';path.write_text(json.dumps({'api_key':'fixture','model':'test-model'}))
            def transport(request,timeout):
                self.assertEqual(request.get_header('User-agent'),'TJPB-Study/1.0');self.assertIn(b'whisper-large-v3-turbo',request.data);return io.BytesIO(b'{"text":"Tres dias de TI"}')
            service=StudyAssistant(path,transport=transport);self.assertTrue(service.transcribe(1,b'fixture','audio/mp4')['ok'])
            with self.assertRaises(AIError):service.transcribe(1,b'fixture','audio/webm\r\nInjected: true')

if __name__=='__main__':unittest.main()

class RoundRobinTests(unittest.TestCase):
    def test_rotation_and_parallel_balance(self):
        from ai_service import RoundRobinSelector
        from concurrent.futures import ThreadPoolExecutor
        selector = RoundRobinSelector()
        self.assertEqual([selector.select([1,2,3]) for _ in range(6)], [1,2,3,1,2,3])
        with ThreadPoolExecutor(max_workers=8) as pool:
            selected = list(pool.map(lambda _: selector.select([1,2,3]), range(300)))
        self.assertEqual([selected.count(i) for i in (1,2,3)], [100,100,100])

    def test_env_pool_and_legacy_fallback(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True):
            config = Path(directory) / 'groq-config.json'
            config.write_text(json.dumps({'api_key':'legacy', 'model':'test-model'}))
            service = StudyAssistant(config)
            self.assertEqual(service.providers()[0].api_key, 'legacy')
            (config.parent / '.env').write_text('GROQ_API_KEY_1=first\nGROQ_API_KEY_2=second\nGROQ_API_KEY_3=third\n')
            self.assertEqual([service.selector.select(service.providers()).api_key for _ in range(6)], ['first','second','third']*2)
            (config.parent / '.env').write_text('GROQ_API_KEY_1=first\nGROQ_API_KEY_2=first\n')
            self.assertEqual(len(service.providers()), 1)
