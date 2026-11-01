#!/usr/bin/env python3
"""Servidor do app com PWA, sincronização, autenticação de usuários e placar da turma."""
import argparse
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import auth_db

APP = ROOT / 'tjpb-mapa-estudo.html'
MANIFEST = ROOT / 'manifest.json'
SW = ROOT / 'service-worker.js'
ASSETS = ROOT / 'assets'
SYNC_BACKUP = ROOT / 'dados' / 'ultimo_backup_sincronizado.json'


class Handler(BaseHTTPRequestHandler):
    def send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    def send_json(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_cors_headers()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def get_token(self):
        auth = self.headers.get('Authorization', '')
        if auth.startswith('Bearer '):
            return auth.split('Bearer ', 1)[1].strip()
        cookie = self.headers.get('Cookie', '')
        for part in cookie.split(';'):
            part = part.strip()
            if part.startswith('tjpb_token='):
                return part.split('=', 1)[1].strip()
        return None

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        route = urlsplit(self.path).path

        if route in ['/', '/tjpb-mapa-estudo.html', '/baixar', '/relatorio_visual_fgv_ti_tribunais.html']:
            document = ROOT / 'relatorio_visual_fgv_ti_tribunais.html' if route == '/relatorio_visual_fgv_ti_tribunais.html' else APP
            data = document.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            if route == '/baixar':
                self.send_header('Content-Disposition', 'attachment; filename="tjpb-estudo-offline.html"')
            self.end_headers()
            self.wfile.write(data)
            return

        if route == '/manifest.json' and MANIFEST.exists():
            data = MANIFEST.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'application/manifest+json; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return

        if route == '/service-worker.js' and SW.exists():
            data = SW.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'application/javascript; charset=utf-8')
            self.send_header('Service-Worker-Allowed', '/')
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return

        if route.startswith('/assets/'):
            asset_name = os.path.basename(route)
            asset_file = ASSETS / asset_name
            if asset_file.exists() and asset_file.is_file():
                data = asset_file.read_bytes()
                mime = 'image/png' if asset_name.endswith('.png') else 'application/octet-stream'
                self.send_response(200)
                self.send_header('Content-Type', mime)
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return

        if route == '/api/me':
            token = self.get_token()
            user = auth_db.get_user_by_token(token)
            if user:
                self.send_json(200, {'ok': True, 'user': user})
            else:
                self.send_json(200, {'ok': False, 'user': None})
            return

        if route == '/api/leaderboard':
            board = auth_db.get_leaderboard()
            self.send_json(200, {'ok': True, 'leaderboard': board})
            return

        self.send_error(404)

    def do_POST(self):
        route = urlsplit(self.path).path
        length = int(self.headers.get('Content-Length', 0))
        if length > 50 * 1024 * 1024:
            self.send_json(400, {'ok': False, 'error': 'Payload muito grande'})
            return

        body = self.rfile.read(length) if length > 0 else b'{}'
        try:
            payload = json.loads(body.decode('utf-8'))
        except Exception:
            payload = {}

        if route == '/api/register':
            try:
                username = payload.get('username', '')
                nome = payload.get('nome', '')
                password = payload.get('password', '')
                user_info = auth_db.register_user(username, nome, password)
                self.send_json(200, {'ok': True, 'user': user_info})
            except Exception as e:
                self.send_json(400, {'ok': False, 'error': str(e)})
            return

        if route == '/api/login':
            try:
                username = payload.get('username', '')
                password = payload.get('password', '')
                user_info = auth_db.login_user(username, password)
                self.send_json(200, {'ok': True, 'user': user_info})
            except Exception as e:
                self.send_json(400, {'ok': False, 'error': str(e)})
            return

        if route == '/api/sync':
            token = self.get_token()
            user = auth_db.get_user_by_token(token)
            tentativas = payload.get('tentativas', [])
            
            saved_db = 0
            if user and tentativas:
                saved_db = auth_db.save_attempts_for_user(user['id'], tentativas)

            # Salva também cópia raw local de conveniência
            try:
                SYNC_BACKUP.parent.mkdir(parents=True, exist_ok=True)
                SYNC_BACKUP.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
            except Exception:
                pass

            msg = f"Sincronizado! {len(tentativas)} respostas salvas no seu perfil ({user['nome'] if user else 'anônimo'})."
            self.send_json(200, {'ok': True, 'msg': msg, 'saved_user': bool(user), 'count': saved_db})
            return

        self.send_error(404)

    def log_message(self, fmt, *args):
        print(fmt % args, flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='0.0.0.0')
    parser.add_argument('--port', type=int, default=8766)
    args = parser.parse_args()
    auth_db.init_db()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f'App disponível na porta {args.port}.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
