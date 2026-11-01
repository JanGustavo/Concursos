import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('estudo',ROOT/'estudo.py')
app=importlib.util.module_from_spec(spec);spec.loader.exec_module(app)


class DatabaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.dir=Path(self.tmp.name);app.DB=str(self.dir/'estudo.db')
        self.data={'textos':['Texto de teste'],'bloco':'p3','fonte':'https://example.org/prova',
                   'questoes':[{'id':'Q1','texto_id':0,'assunto':['Português','Crase'],'prova':'FGV - Teste - 2026',
                   'enunciado':'Questão fictícia','gabarito':'A','alternativas':{'A':'Certa','B':'Errada'}}]}
    def tearDown(self): self.tmp.cleanup()
    def run_import(self,data=None,update=False):
        path=self.dir/'q.json';path.write_text(json.dumps(self.data if data is None else data))
        with contextlib.redirect_stdout(io.StringIO()):app.importar(path,update)
    def one(self,sql):
        with sqlite3.connect(app.DB) as c:return c.execute(sql).fetchone()
    def test_idempotent(self):
        self.run_import();self.run_import();self.assertEqual(self.one('SELECT COUNT(*) FROM questoes')[0],1)
    def test_update_keeps_block_and_attempt(self):
        self.run_import()
        with sqlite3.connect(app.DB) as c:c.execute("INSERT INTO tentativas(questao_id,resposta,correta,quando,gabarito_em_uso) VALUES('Q1','A',1,'2026-10-26','A')")
        self.data.pop('bloco');self.data['questoes'][0]['gabarito']='B';self.run_import(update=True)
        self.assertEqual(self.one('SELECT bloco,gabarito FROM questoes'),('p3','B'))
        self.assertEqual(self.one('SELECT COUNT(*),gabarito_em_uso,correta FROM tentativas'),(1,'A',1))
    def test_invalid_key_rejected_without_change(self):
        self.run_import();self.data['questoes'][0]['gabarito']='Z'
        with self.assertRaises(ValueError):self.run_import(update=True)
        self.assertEqual(self.one('SELECT gabarito FROM questoes'),('A',))
    def test_all_or_nothing(self):
        self.run_import();self.data['questoes'].append(dict(self.data['questoes'][0],id='Q2',gabarito='Z'))
        with self.assertRaises(ValueError):self.run_import()
        self.assertEqual(self.one('SELECT COUNT(*) FROM questoes'),(1,))
    def test_bad_text_reference(self):
        self.data['questoes'][0]['texto_id']=2
        with self.assertRaises(ValueError):self.run_import()
    def test_duplicate_ids(self):
        self.data['questoes']*=2
        with self.assertRaises(ValueError):self.run_import()
    def test_invalid_answer_is_not_recorded(self):
        self.run_import()
        with patch('builtins.input',side_effect=['Z','A','Entendi a relação']),contextlib.redirect_stdout(io.StringIO()):app.simulado(1,None,False,'p3')
        self.assertEqual(self.one('SELECT COUNT(*),resposta,gabarito_em_uso FROM tentativas'),(1,'A','A'))
    def test_progress_and_mark(self):
        self.run_import();out=self.dir/'progresso.json'
        with patch('builtins.input',side_effect=['B','Dúvida']),contextlib.redirect_stdout(io.StringIO()):app.simulado(1,None,False,'p3');app.progresso(out)
        p=json.loads(out.read_text())['blocos']['p3']
        self.assertEqual((p['questoes'],p['respondidas'],p['tentativas'],p['acertos'],p['pct']),(1,1,1,0,0))
        with contextlib.redirect_stdout(io.StringIO()):app.marcar('p2','Crase')
        self.assertEqual(self.one('SELECT bloco FROM questoes'),('p2',))
    def test_old_schema_migration(self):
        old=ROOT/'referencias'/'estudo_claude_2026-10-26.py'
        legacy='''CREATE TABLE questoes(id TEXT PRIMARY KEY,texto_id INTEGER,disciplina TEXT,assunto TEXT,prova TEXT,banca TEXT,ano INTEGER,enunciado TEXT NOT NULL,gabarito TEXT NOT NULL);
        CREATE TABLE tentativas(id INTEGER PRIMARY KEY,questao_id TEXT,resposta TEXT,correta INTEGER,justificativa TEXT,quando TEXT);'''
        with sqlite3.connect(app.DB) as c:c.executescript(legacy)
        self.run_import();self.assertEqual(self.one('SELECT bloco,fonte FROM questoes'),('p3','https://example.org/prova'))
    def test_wrong_review_uses_latest_attempt(self):
        self.run_import()
        with patch('builtins.input',side_effect=['B','','A','']),contextlib.redirect_stdout(io.StringIO()):app.simulado(1,None,False,'p3');app.simulado(1,None,False,'p3')
        with patch('builtins.input',side_effect=AssertionError('Já acertou')),contextlib.redirect_stdout(io.StringIO()):app.simulado(1,None,True,'p3')


if __name__=='__main__':unittest.main()
