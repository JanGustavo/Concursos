import sqlite3
import hashlib
import os
import secrets
from pathlib import Path
from datetime import datetime, timezone

DB_PATH = Path(__file__).resolve().parent / 'dados' / 'tjpb_users.db'

def get_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH, timeout=10.0)
    con.row_factory = sqlite3.Row
    return con

def init_db():
    with get_db() as con:
        con.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            nome TEXT NOT NULL,
            salt TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        ''')
        con.execute('''
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        ''')
        con.execute('''
        CREATE TABLE IF NOT EXISTS user_attempts (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            questao_id TEXT NOT NULL,
            resposta TEXT NOT NULL,
            gabarito TEXT NOT NULL,
            correta INTEGER NOT NULL,
            bloco TEXT NOT NULL,
            confianca TEXT,
            justificativa TEXT,
            quando DATETIME NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        ''')
        con.execute('CREATE INDEX IF NOT EXISTS idx_attempts_user ON user_attempts(user_id);')
        con.execute('CREATE INDEX IF NOT EXISTS idx_attempts_quando ON user_attempts(quando);')
        con.execute('''CREATE TABLE IF NOT EXISTS published_games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            subject TEXT NOT NULL,
            description TEXT NOT NULL,
            html TEXT NOT NULL,
            created_by INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(created_by) REFERENCES users(id)
        )''')

def list_games():
    with get_db() as con:
        return [dict(row) for row in con.execute(
            'SELECT id, title, subject, description, created_at FROM published_games ORDER BY id DESC')]

def get_game(game_id):
    with get_db() as con:
        row = con.execute('SELECT html FROM published_games WHERE id = ?', (game_id,)).fetchone()
        return row['html'] if row else None

def publish_game(user_id, title, subject, description, html):
    with get_db() as con:
        cursor = con.execute('INSERT INTO published_games (title, subject, description, html, created_by) VALUES (?, ?, ?, ?, ?)',
                             (title, subject, description, html, user_id))
        return cursor.lastrowid

def hash_password(password, salt=None):
    if not salt:
        salt = os.urandom(16).hex()
    hashed = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 100000).hex()
    return salt, hashed

def register_user(username, nome, password):
    username = username.strip().lower()
    nome = nome.strip()
    if len(username) < 3 or len(password) < 4:
        raise ValueError('Usuário deve ter pelo menos 3 caracteres e senha 4 caracteres.')
    salt, p_hash = hash_password(password)
    with get_db() as con:
        cur = con.cursor()
        cur.execute('INSERT INTO users (username, nome, salt, password_hash) VALUES (?, ?, ?, ?)',
                    (username, nome or username, salt, p_hash))
        user_id = cur.lastrowid
        token = secrets.token_hex(24)
        con.execute('INSERT INTO sessions (token, user_id) VALUES (?, ?)', (token, user_id))
        return {'id': user_id, 'username': username, 'nome': nome or username, 'token': token}

def login_user(username, password):
    username = username.strip().lower()
    with get_db() as con:
        user = con.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
        if not user:
            raise ValueError('Usuário ou senha incorretos.')
        salt = user['salt']
        _, p_hash = hash_password(password, salt)
        if p_hash != user['password_hash']:
            raise ValueError('Usuário ou senha incorretos.')
        token = secrets.token_hex(24)
        con.execute('INSERT INTO sessions (token, user_id) VALUES (?, ?)', (token, user['id']))
        return {'id': user['id'], 'username': user['username'], 'nome': user['nome'], 'token': token}

def get_user_by_token(token):
    if not token:
        return None
    with get_db() as con:
        row = con.execute('''
        SELECT u.id, u.username, u.nome FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token = ?
        ''', (token,)).fetchone()
        if row:
            return {'id': row['id'], 'username': row['username'], 'nome': row['nome']}
        return None

def save_attempts_for_user(user_id, attempts):
    saved_count = 0
    with get_db() as con:
        for a in attempts:
            try:
                con.execute('''
                INSERT INTO user_attempts (id, user_id, questao_id, resposta, gabarito, correta, bloco, confianca, justificativa, quando)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    resposta=excluded.resposta,
                    correta=excluded.correta,
                    confianca=excluded.confianca,
                    justificativa=excluded.justificativa,
                    quando=excluded.quando
                ''', (
                    a['id'], user_id, a['questao_id'], a['resposta'], a['gabarito'],
                    1 if a['correta'] else 0, a['bloco'], a.get('confianca', 'duvida'),
                    a.get('justificativa', ''), a['quando']
                ))
                saved_count += 1
            except Exception:
                pass
    return saved_count

def get_leaderboard():
    with get_db() as con:
        users = con.execute('SELECT id, username, nome FROM users').fetchall()
        leaderboard = []
        for u in users:
            uid = u['id']
            stats = con.execute('''
            SELECT 
                count(*) as total,
                sum(case when correta = 1 then 1 else 0 end) as acertos,
                max(quando) as ultima_atividade,
                count(distinct date(quando)) as dias_ativos
            FROM user_attempts WHERE user_id = ?
            ''', (uid,)).fetchone()
            
            total = stats['total'] or 0
            acertos = stats['acertos'] or 0
            taxa = round((acertos * 100 / total)) if total > 0 else 0
            
            leaderboard.append({
                'id': uid,
                'username': u['username'],
                'nome': u['nome'],
                'total': total,
                'acertos': acertos,
                'taxa': taxa,
                'dias_ativos': stats['dias_ativos'] or 0,
                'ultima_atividade': stats['ultima_atividade'] or None
            })
            
        leaderboard.sort(key=lambda x: (x['acertos'], x['total'], x['dias_ativos']), reverse=True)
        for idx, item in enumerate(leaderboard):
            item['posicao'] = idx + 1
            
        return leaderboard

init_db()
