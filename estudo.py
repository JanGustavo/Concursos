#!/usr/bin/env python3
"""Banco local SQLite. Use --help; os simulados no Android estão no HTML."""
import argparse
import csv
import json
from pathlib import Path
import random
import re
import sqlite3
from datetime import datetime

DB = str(Path(__file__).resolve().with_name('estudo.db'))
BLOCOS = {f'{p}{n}' for p, total in [('p', 4), ('r', 4), ('t', 11)] for n in range(1, total + 1)}
SCHEMA = """
CREATE TABLE IF NOT EXISTS textos(id INTEGER PRIMARY KEY AUTOINCREMENT,conteudo TEXT UNIQUE);
CREATE TABLE IF NOT EXISTS questoes(id TEXT PRIMARY KEY,texto_id INTEGER REFERENCES textos(id),
 disciplina TEXT,assunto TEXT,bloco TEXT,prova TEXT,banca TEXT,ano INTEGER,
 enunciado TEXT NOT NULL,gabarito TEXT NOT NULL,fonte TEXT,gerado_em TEXT);
CREATE TABLE IF NOT EXISTS alternativas(questao_id TEXT REFERENCES questoes(id),letra TEXT,texto TEXT,
 PRIMARY KEY(questao_id,letra));
CREATE TABLE IF NOT EXISTS tentativas(id INTEGER PRIMARY KEY AUTOINCREMENT,
 questao_id TEXT REFERENCES questoes(id),resposta TEXT,correta INTEGER,justificativa TEXT,quando TEXT,
 gabarito_em_uso TEXT);
"""


def conn():
    c = sqlite3.connect(DB)
    c.execute('PRAGMA foreign_keys=ON')
    c.executescript(SCHEMA)
    for table, fields in [('questoes', ['bloco', 'fonte', 'gerado_em']), ('tentativas', ['gabarito_em_uso'])]:
        existing = {r[1] for r in c.execute(f'PRAGMA table_info({table})')}
        for field in fields:
            if field not in existing:
                c.execute(f'ALTER TABLE {table} ADD COLUMN {field} TEXT')
    # O banco antigo não tinha fotografia do gabarito; usa o disponível na migração.
    c.execute('UPDATE tentativas SET gabarito_em_uso=(SELECT gabarito FROM questoes q '
              'WHERE q.id=tentativas.questao_id) WHERE gabarito_em_uso IS NULL')
    c.commit()
    return c


def validate_import(data):
    if not isinstance(data, dict) or not isinstance(data.get('questoes'), list):
        raise ValueError('O JSON deve conter uma lista questoes.')
    for field in ['fonte', 'gerado_em']:
        if data.get(field) is not None and not isinstance(data[field], str):
            raise ValueError(f'{field} deve ser texto.')
    texts = data.get('textos', [])
    if not isinstance(texts, list) or not all(isinstance(t, str) for t in texts):
        raise ValueError('textos deve ser uma lista de textos.')
    seen, valid, skipped = set(), [], []
    for q in data['questoes']:
        if not isinstance(q, dict) or not isinstance(q.get('id'), str) or not q['id'].strip():
            raise ValueError('Questão sem identificador válido.')
        qid = q['id'].strip()
        if qid in seen:
            raise ValueError(f'ID repetido no mesmo arquivo: {qid}')
        seen.add(qid)
        if not q.get('gabarito'):
            skipped.append(qid)
            continue
        if not isinstance(q.get('enunciado'), str) or not q['enunciado'].strip():
            raise ValueError(f'{qid}: enunciado vazio.')
        alts = q.get('alternativas')
        if (not isinstance(alts, dict) or len(alts) < 2 or
                not all(k in 'ABCDE' and len(k) == 1 and isinstance(v, str) and v.strip() for k, v in alts.items())):
            raise ValueError(f'{qid}: alternativas inválidas.')
        gab = str(q['gabarito']).strip().upper()
        if gab not in alts:
            raise ValueError(f'{qid}: gabarito não pertence às alternativas.')
        tid = q.get('texto_id')
        if tid is not None and (type(tid) is not int or tid < 0 or tid >= len(texts)):
            raise ValueError(f'{qid}: referência de texto inválida.')
        subjects = q.get('assunto', [])
        if not isinstance(subjects, list) or not all(isinstance(a, str) for a in subjects):
            raise ValueError(f'{qid}: assunto deve ser uma lista de textos.')
        block = q.get('bloco') or data.get('bloco')
        if block is not None and block not in BLOCOS:
            raise ValueError(f'{qid}: bloco desconhecido: {block}')
        for field in ['prova', 'fonte', 'gerado_em']:
            if q.get(field) is not None and not isinstance(q[field], str):
                raise ValueError(f'{qid}: {field} deve ser texto.')
        valid.append(dict(q, id=qid, gabarito=gab, assunto=subjects, bloco=block))
    return texts, valid, skipped


def importar(path, atualizar=False):
    data = json.loads(Path(path).read_text(encoding='utf-8-sig'))
    texts, questions, skipped = validate_import(data)  # antes de qualquer alteração
    c = conn()
    new = updated = 0
    with c:
        textmap = {}
        for i, text in enumerate(texts):
            c.execute('INSERT OR IGNORE INTO textos(conteudo) VALUES (?)', (text,))
            textmap[i] = c.execute('SELECT id FROM textos WHERE conteudo=?', (text,)).fetchone()[0]
        for q in questions:
            exists = c.execute('SELECT 1 FROM questoes WHERE id=?', (q['id'],)).fetchone()
            if exists and not atualizar:
                if q['bloco']:
                    c.execute('UPDATE questoes SET bloco=? WHERE id=?', (q['bloco'], q['id']))
                continue
            prova = q.get('prova') or ''
            year = re.search(r'(20\d\d)\s*$', prova)
            ass = q['assunto']
            c.execute('''INSERT INTO questoes(id,texto_id,disciplina,assunto,bloco,prova,banca,ano,enunciado,gabarito,fonte,gerado_em)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
                texto_id=excluded.texto_id,disciplina=excluded.disciplina,assunto=excluded.assunto,
                bloco=COALESCE(excluded.bloco,questoes.bloco),prova=excluded.prova,banca=excluded.banca,
                ano=excluded.ano,enunciado=excluded.enunciado,gabarito=excluded.gabarito,
                fonte=COALESCE(excluded.fonte,questoes.fonte),gerado_em=COALESCE(excluded.gerado_em,questoes.gerado_em)''',
                (q['id'], textmap.get(q.get('texto_id')), ass[0] if ass else None,
                 ' > '.join(ass[1:]) or None, q['bloco'], prova, prova.split(' - ')[0] or None,
                 int(year.group(1)) if year else None, q['enunciado'], q['gabarito'],
                 q.get('fonte') or data.get('fonte'), q.get('gerado_em') or data.get('gerado_em')))
            c.execute('DELETE FROM alternativas WHERE questao_id=?', (q['id'],))
            c.executemany('INSERT INTO alternativas VALUES(?,?,?)', [(q['id'], k, v) for k, v in q['alternativas'].items()])
            new += not bool(exists)
            updated += bool(exists)
    c.close()
    print(f'{new} novas; {updated} atualizadas; {len(skipped)} sem gabarito ignoradas.')


def simulado(n, assunto, so_erradas, bloco=None):
    if n <= 0:
        raise ValueError('A quantidade deve ser maior que zero.')
    c = conn()
    sql, args = 'SELECT id FROM questoes WHERE 1=1', []
    if assunto:
        sql += ' AND assunto LIKE ?'; args.append(f'%{assunto}%')
    if bloco:
        sql += ' AND bloco=?'; args.append(bloco)
    if so_erradas:
        sql += (' AND id IN (SELECT t.questao_id FROM tentativas t WHERE t.id='
                '(SELECT MAX(u.id) FROM tentativas u WHERE u.questao_id=t.questao_id) AND t.correta=0)')
    ids = [r[0] for r in c.execute(sql, args)]
    if not ids:
        print('Nenhuma questão encontrada.'); c.close(); return
    random.shuffle(ids)
    total = acertos = 0
    for qid in ids[:n]:
        enun, gab, ass, prova, tid = c.execute('SELECT enunciado,gabarito,assunto,prova,texto_id FROM questoes WHERE id=?', (qid,)).fetchone()
        print(f'\n{qid} | {ass} | {prova}')
        if tid:
            print('\n[TEXTO]\n'+c.execute('SELECT conteudo FROM textos WHERE id=?', (tid,)).fetchone()[0]+'\n')
        print(enun)
        alts = c.execute('SELECT letra,texto FROM alternativas WHERE questao_id=? ORDER BY letra', (qid,)).fetchall()
        for letter, text in alts: print(f'{letter}) {text}')
        while True:
            resp = input("Sua resposta (letra, ou 's' para sair): ").strip().upper()
            if resp == 'S' or resp in dict(alts): break
            print('Informe uma das alternativas exibidas.')
        if resp == 'S': break
        just = input('Por quê? (Enter para pular): ').strip()
        ok = int(resp == gab)
        c.execute('INSERT INTO tentativas(questao_id,resposta,correta,justificativa,quando,gabarito_em_uso) VALUES(?,?,?,?,?,?)',
                  (qid, resp, ok, just, datetime.now().isoformat(timespec='seconds'), gab))
        c.commit(); total += 1; acertos += ok
        print('CERTO!' if ok else f'ERRADO. Gabarito importado: {gab}')
    if total: print(f'Resultado: {acertos}/{total} ({round(100*acertos/total)}%)')
    c.close()


def stats():
    c = conn()
    rows = c.execute('''SELECT q.assunto,COUNT(*),SUM(t.correta),ROUND(100.0*SUM(t.correta)/COUNT(*))
        FROM tentativas t JOIN questoes q ON q.id=t.questao_id GROUP BY q.assunto ORDER BY 4''').fetchall()
    if not rows: print('Ainda não há tentativas.')
    for a, total, hits, pct in rows: print(f'{a or "-"}: {hits}/{total} ({int(pct)}%)')
    c.close()


def marcar(bloco, assunto):
    if bloco not in BLOCOS or not assunto.strip(): raise ValueError('Bloco ou assunto inválido.')
    c = conn()
    with c: cur = c.execute('UPDATE questoes SET bloco=? WHERE assunto LIKE ?', (bloco, f'%{assunto}%'))
    print(f'{cur.rowcount} questões marcadas como {bloco}.'); c.close()


def progresso(saida):
    c = conn(); blocks = {}
    for b, count in c.execute('SELECT bloco,COUNT(*) FROM questoes WHERE bloco IS NOT NULL GROUP BY bloco'):
        blocks[b] = dict(questoes=count, tentativas=0, acertos=0, respondidas=0, pct=None, assuntos=[])
    for b, total, hits, seen in c.execute('''SELECT q.bloco,COUNT(*),SUM(t.correta),COUNT(DISTINCT t.questao_id)
        FROM tentativas t JOIN questoes q ON q.id=t.questao_id WHERE q.bloco IS NOT NULL GROUP BY q.bloco'''):
        blocks[b].update(tentativas=total, acertos=hits, respondidas=seen, pct=round(100*hits/total))
    for b, subject, total, hits in c.execute('''SELECT q.bloco,COALESCE(q.assunto,'(sem assunto)'),COUNT(*),SUM(t.correta)
        FROM tentativas t JOIN questoes q ON q.id=t.questao_id WHERE q.bloco IS NOT NULL GROUP BY q.bloco,q.assunto'''):
        blocks[b]['assuntos'].append(dict(assunto=subject, tentativas=total, acertos=hits, pct=round(100*hits/total)))
    for b in blocks.values(): b['assuntos'].sort(key=lambda a: (a['pct'], -a['tentativas']))
    unmapped = c.execute('SELECT COUNT(*) FROM questoes WHERE bloco IS NULL').fetchone()[0]
    Path(saida).write_text(json.dumps(dict(gerado_em=datetime.now().isoformat(timespec='seconds'), origem='sqlite', blocos=blocks, sem_bloco=unmapped), ensure_ascii=False, indent=2))
    print(f'Gerado {saida}; {len(blocks)} blocos; {unmapped} questões sem bloco.'); c.close()


def exportar():
    c = conn()
    for name, sql in [('questoes.csv', 'SELECT id,disciplina,assunto,bloco,banca,ano,prova,enunciado,gabarito,fonte,gerado_em FROM questoes'),
                      ('tentativas.csv', '''SELECT t.quando,t.questao_id,q.assunto,q.bloco,t.resposta,t.gabarito_em_uso,
                       q.gabarito AS gabarito_atual,t.correta,t.justificativa FROM tentativas t JOIN questoes q ON q.id=t.questao_id ORDER BY t.id''')]:
        cur = c.execute(sql)
        with open(name, 'w', newline='', encoding='utf-8-sig') as f:
            writer = csv.writer(f); writer.writerow([d[0] for d in cur.description]); writer.writerows(cur)
        print(f'Gerado {name}')
    c.close()


def main():
    global DB
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--db', help='Caminho alternativo do banco SQLite')
    sub = p.add_subparsers(dest='cmd', required=True)
    si = sub.add_parser('importar'); si.add_argument('arquivo'); si.add_argument('--atualizar', action='store_true')
    sm = sub.add_parser('simulado'); sm.add_argument('-n', type=int, default=10); sm.add_argument('-a', '--assunto'); sm.add_argument('-b', '--bloco', choices=sorted(BLOCOS)); sm.add_argument('--erradas', action='store_true')
    sk = sub.add_parser('marcar'); sk.add_argument('bloco', choices=sorted(BLOCOS)); sk.add_argument('-a', '--assunto', required=True)
    sp = sub.add_parser('progresso'); sp.add_argument('-o', '--saida', default='progresso.json')
    sub.add_parser('stats'); sub.add_parser('exportar')
    a = p.parse_args()
    if a.db: DB = str(Path(a.db).resolve())
    try:
        if a.cmd == 'importar': importar(a.arquivo, a.atualizar)
        elif a.cmd == 'simulado': simulado(a.n, a.assunto, a.erradas, a.bloco)
        elif a.cmd == 'marcar': marcar(a.bloco, a.assunto)
        elif a.cmd == 'progresso': progresso(a.saida)
        elif a.cmd == 'stats': stats()
        else: exportar()
    except (ValueError, OSError, sqlite3.Error) as exc: p.exit(1, f'Erro: {exc}\n')


if __name__ == '__main__': main()
