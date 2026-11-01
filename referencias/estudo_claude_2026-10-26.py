#!/usr/bin/env python3
"""Banco de questões de concurso (SQLite) + simulado no terminal.

Uso:
  python estudo.py importar questoes.json [--atualizar]   # importa (--atualizar sobrescreve existentes)
  python estudo.py simulado [-n 10] [-a "Crase"] [-b p3] [--erradas]
  python estudo.py marcar p3 -a "Crase"           # define o bloco das questões já importadas (por assunto)
  python estudo.py stats                          # desempenho por assunto
  python estudo.py progresso [-o progresso.json]  # desempenho por bloco, para o mapa de estudos carregar
  python estudo.py exportar                       # gera questoes.csv e tentativas.csv (abrem no Excel)
"""
import argparse, csv, json, random, re, sqlite3, sys
from datetime import datetime

DB = "estudo.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS textos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, conteudo TEXT UNIQUE);
CREATE TABLE IF NOT EXISTS questoes (
  id TEXT PRIMARY KEY, texto_id INTEGER REFERENCES textos(id),
  disciplina TEXT, assunto TEXT, bloco TEXT, prova TEXT, banca TEXT, ano INTEGER,
  enunciado TEXT NOT NULL, gabarito TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS alternativas (
  questao_id TEXT REFERENCES questoes(id), letra TEXT, texto TEXT,
  PRIMARY KEY (questao_id, letra));
CREATE TABLE IF NOT EXISTS tentativas (
  id INTEGER PRIMARY KEY AUTOINCREMENT, questao_id TEXT REFERENCES questoes(id),
  resposta TEXT, correta INTEGER, justificativa TEXT, quando TEXT);
"""


def conn():
    c = sqlite3.connect(DB)
    c.executescript(SCHEMA)
    cols = [r[1] for r in c.execute("PRAGMA table_info(questoes)")]
    if "bloco" not in cols:  # banco criado pela versão anterior
        c.execute("ALTER TABLE questoes ADD COLUMN bloco TEXT")
    return c


def importar(path, atualizar=False):
    data = json.load(open(path, encoding="utf-8"))
    c = conn()
    mapa_texto = {}
    for i, t in enumerate(data.get("textos", [])):
        c.execute("INSERT OR IGNORE INTO textos(conteudo) VALUES (?)", (t,))
        mapa_texto[i] = c.execute("SELECT id FROM textos WHERE conteudo=?", (t,)).fetchone()[0]
    novas = 0
    for q in data["questoes"]:
        if not q.get("gabarito"):
            print(f"pulando {q['id']}: sem gabarito")
            continue
        ass = q.get("assunto", [])
        ano = re.search(r"(20\d\d)\s*$", q.get("prova", ""))
        banca = q["prova"].split(" - ")[0] if q.get("prova") else None
        bloco = q.get("bloco") or data.get("bloco")
        existe = c.execute("SELECT 1 FROM questoes WHERE id=?", (q["id"],)).fetchone()
        if existe and not atualizar:
            if bloco:
                c.execute("UPDATE questoes SET bloco=? WHERE id=?", (bloco, q["id"]))
            continue
        if existe:
            c.execute("DELETE FROM alternativas WHERE questao_id=?", (q["id"],))
        c.execute(
            "INSERT OR REPLACE INTO questoes(id,texto_id,disciplina,assunto,bloco,prova,banca,ano,enunciado,gabarito)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            (q["id"], mapa_texto.get(q.get("texto_id")), ass[0] if ass else None,
             " > ".join(ass[1:]) or None, bloco, q.get("prova"), banca,
             int(ano.group(1)) if ano else None, q["enunciado"], q["gabarito"]))
        novas += 0 if existe else 1
        for letra, txt in q["alternativas"].items():
            c.execute("INSERT INTO alternativas VALUES (?,?,?)", (q["id"], letra, txt))
    c.commit()
    print(f"{novas} questões novas (de {len(data['questoes'])} no arquivo)." + (" Existentes foram atualizadas." if atualizar else ""))


def simulado(n, assunto, so_erradas, bloco=None):
    c = conn()
    sql = "SELECT id FROM questoes WHERE 1=1"
    args = []
    if assunto:
        sql += " AND assunto LIKE ?"
        args.append(f"%{assunto}%")
    if bloco:
        sql += " AND bloco=?"
        args.append(bloco)
    if so_erradas:
        sql += (" AND id IN (SELECT questao_id FROM tentativas t WHERE correta=0 AND NOT EXISTS"
                " (SELECT 1 FROM tentativas u WHERE u.questao_id=t.questao_id AND u.correta=1 AND u.id>t.id))")
    ids = [r[0] for r in c.execute(sql, args)]
    if not ids:
        print("Nenhuma questão encontrada com esse filtro.")
        return
    random.shuffle(ids)
    acertos = total = 0
    for qid in ids[:n]:
        q = c.execute("SELECT enunciado,gabarito,assunto,prova,texto_id FROM questoes WHERE id=?", (qid,)).fetchone()
        enun, gab, ass, prova, tid = q
        print(f"\n{'='*70}\n{qid} | {ass} | {prova}")
        if tid:
            txt = c.execute("SELECT conteudo FROM textos WHERE id=?", (tid,)).fetchone()[0]
            print(f"\n[TEXTO]\n{txt}\n")
        print(enun)
        alts = c.execute("SELECT letra,texto FROM alternativas WHERE questao_id=? ORDER BY letra", (qid,)).fetchall()
        for letra, txt in alts:
            print(f"{letra}) {txt}")
        resp = input("\nSua resposta (letra, ou 's' para sair): ").strip().upper()
        if resp == "S":
            break
        just = input("Por quê? (Enter para pular): ").strip()
        ok = int(resp == gab)
        c.execute("INSERT INTO tentativas(questao_id,resposta,correta,justificativa,quando) VALUES (?,?,?,?,?)",
                  (qid, resp, ok, just, datetime.now().isoformat(timespec="seconds")))
        c.commit()
        total += 1
        acertos += ok
        print("CERTO!" if ok else f"ERRADO. Gabarito: {gab}")
    if total:
        print(f"\nResultado: {acertos}/{total} ({100*acertos//total}%)")


def stats():
    c = conn()
    rows = c.execute("""
      SELECT q.assunto, COUNT(*), SUM(t.correta), ROUND(100.0*SUM(t.correta)/COUNT(*),0)
      FROM tentativas t JOIN questoes q ON q.id=t.questao_id
      GROUP BY q.assunto ORDER BY 4 ASC""").fetchall()
    if not rows:
        print("Ainda não há tentativas. Rode o simulado primeiro.")
        return
    print(f"{'Assunto':45} {'Tent.':>5} {'Acertos':>7} {'%':>4}")
    for a, tot, ac, pct in rows:
        print(f"{(a or '-')[:45]:45} {tot:>5} {ac:>7} {int(pct):>4}")


def marcar(bloco, assunto):
    c = conn()
    cur = c.execute("UPDATE questoes SET bloco=? WHERE assunto LIKE ?", (bloco, f"%{assunto}%"))
    c.commit()
    print(f"{cur.rowcount} questões marcadas como bloco {bloco}.")


def progresso(saida):
    c = conn()
    blocos = {}
    for b, q in c.execute("SELECT bloco, COUNT(*) FROM questoes WHERE bloco IS NOT NULL GROUP BY bloco"):
        blocos[b] = {"questoes": q, "tentativas": 0, "acertos": 0, "respondidas": 0, "pct": None, "assuntos": []}
    for b, tent, ac, resp in c.execute("""
        SELECT q.bloco, COUNT(*), SUM(t.correta), COUNT(DISTINCT t.questao_id)
        FROM tentativas t JOIN questoes q ON q.id=t.questao_id
        WHERE q.bloco IS NOT NULL GROUP BY q.bloco"""):
        blocos[b].update(tentativas=tent, acertos=ac, respondidas=resp, pct=round(100 * ac / tent))
    for b, a, tent, ac in c.execute("""
        SELECT q.bloco, COALESCE(q.assunto,'(sem assunto)'), COUNT(*), SUM(t.correta)
        FROM tentativas t JOIN questoes q ON q.id=t.questao_id
        WHERE q.bloco IS NOT NULL GROUP BY q.bloco, q.assunto"""):
        blocos[b]["assuntos"].append({"assunto": a, "tentativas": tent, "acertos": ac, "pct": round(100 * ac / tent)})
    for d in blocos.values():
        d["assuntos"].sort(key=lambda x: (x["pct"], -x["tentativas"]))
    sem = c.execute("SELECT COUNT(*) FROM questoes WHERE bloco IS NULL").fetchone()[0]
    json.dump({"gerado_em": datetime.now().isoformat(timespec="seconds"), "blocos": blocos},
              open(saida, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"gerado {saida} ({len(blocos)} blocos)." + (f" Atenção: {sem} questões sem bloco (use 'marcar')." if sem else ""))


def exportar():
    c = conn()
    for nome, sql in (
        ("questoes.csv", "SELECT q.id,q.disciplina,q.assunto,q.banca,q.ano,q.prova,q.enunciado,q.gabarito FROM questoes q"),
        ("tentativas.csv", "SELECT t.quando,t.questao_id,q.assunto,t.resposta,q.gabarito,t.correta,t.justificativa "
                           "FROM tentativas t JOIN questoes q ON q.id=t.questao_id ORDER BY t.id")):
        cur = c.execute(sql)
        with open(nome, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f)
            w.writerow([d[0] for d in cur.description])
            w.writerows(cur)
        print("gerado", nome)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    s = p.add_subparsers(dest="cmd", required=True)
    si = s.add_parser("importar")
    si.add_argument("arquivo")
    si.add_argument("--atualizar", action="store_true", help="sobrescreve questões já existentes (ex.: após corrigir a extração)")
    sm = s.add_parser("simulado")
    sm.add_argument("-n", type=int, default=10)
    sm.add_argument("-a", "--assunto")
    sm.add_argument("--erradas", action="store_true")
    sm.add_argument("-b", "--bloco", help="id do bloco do mapa de estudos (ex.: p3)")
    sk = s.add_parser("marcar")
    sk.add_argument("bloco")
    sk.add_argument("-a", "--assunto", required=True)
    s.add_parser("stats")
    sp = s.add_parser("progresso")
    sp.add_argument("-o", "--saida", default="progresso.json")
    s.add_parser("exportar")
    a = p.parse_args()
    if a.cmd == "importar":
        importar(a.arquivo, a.atualizar)
    elif a.cmd == "simulado":
        simulado(a.n, a.assunto, a.erradas, a.bloco)
    elif a.cmd == "marcar":
        marcar(a.bloco, a.assunto)
    elif a.cmd == "progresso":
        progresso(a.saida)
    elif a.cmd == "stats":
        stats()
    else:
        exportar()
