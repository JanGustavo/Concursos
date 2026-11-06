#!/usr/bin/env python3
"""Servidor do app com PWA, sincronização, autenticação de usuários e placar da turma."""
import argparse
import json
import cgi
import io
import os
import re
import sys
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from urllib.request import urlopen
from library_service import library, LibraryError
from ai_service import assistant, AIError

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

    def send_json(self, status, payload, extra_headers=None):
        data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_cors_headers()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'private, no-store')
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(data)

    def get_token(self):
        auth = self.headers.get('Authorization', '')
        if auth.startswith('Bearer '):
            return auth.split('Bearer ', 1)[1].strip()
        cookie = self.headers.get('Cookie', '')
        for part in cookie.split(';'):
            part = part.strip()
            if part.startswith(('tjpb_token=', 'tjpb_library=')):
                return part.split('=', 1)[1].strip()
        return None

    def library_cookie(self, token='', clear=False):
        secure = '; Secure' if self.headers.get('X-Forwarded-Proto') == 'https' else ''
        return 'tjpb_library=' + token + '; Path=/biblioteca; HttpOnly; SameSite=Strict; Max-Age=' + ('0' if clear else '1800') + secure

    def serve_library(self, route, head=False):
        user = auth_db.get_user_by_token(self.get_token())
        if not user:
            self.send_json(401, {'ok': False, 'error': 'Entre na sua conta para acessar os cursos.'})
            return
        try:
            if route == '/biblioteca/api/anki':
                self.send_json(200,{'ok':True,'decks':library.catalog().get('decks',[])})
                return
            if route == '/biblioteca/api/tree':
                self.send_json(200, library.catalog())
                return
            if not route.startswith('/biblioteca/api/media/'):
                self.send_json(404, {'ok': False, 'error': 'Recurso não encontrado.'})
                return
            file_id = route.removeprefix('/biblioteca/api/media/')
            with library.stream_slot(user['id']):
                status, headers, upstream = library.media(file_id, self.headers.get('Range'), head=head)
                self.send_response(status)
                for key, value in headers.items(): self.send_header(key, value)
                self.end_headers()
                if upstream:
                    try:
                        remaining = int(headers['Content-Length'])
                        while remaining:
                            chunk = upstream.read(min(64 * 1024, remaining))
                            if not chunk: break
                            self.wfile.write(chunk)
                            remaining -= len(chunk)
                    except (BrokenPipeError, ConnectionResetError, TimeoutError):
                        pass
                    finally:
                        upstream.close()
        except LibraryError as error:
            headers = {'Content-Range': error.content_range} if hasattr(error, 'content_range') else {}
            self.send_json(error.status, {'ok': False, 'error': error.message}, headers)

    def do_HEAD(self):
        route = urlsplit(self.path).path
        if route.startswith('/biblioteca/api/media/'):
            self.serve_library(route, head=True)
        else:
            self.send_error(405)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def serve_pix(self, query):
        amounts = parse_qs(query).get('amount', [])
        if (len(amounts) != 1 or not re.fullmatch(r'[0-9]{1,5}(\.[0-9]{1,2})?', amounts[0])
                or float(amounts[0]) < 1):
            self.send_json(422, {'detail': 'Informe um valor entre R$ 1 e R$ 99.999,99.'})
            return
        try:
            # KanbanDoro gera o código com a configuração do recebedor em produção.
            with urlopen('https://api.kanbandoro.jangustavo.me/support/pix?amount=' + amounts[0], timeout=5) as response:
                raw = response.read(65537)
            if len(raw) > 65536:
                raise ValueError('Oversized Pix response')
            data = json.loads(raw)
            payload = data['payload']
            qr = data['qrCode']
            if not isinstance(payload, str) or not payload or not isinstance(qr, str) or not qr.startswith('data:image/png;base64,'):
                raise ValueError('Invalid Pix response')
        except (OSError, ValueError, TypeError, KeyError):
            self.send_json(503, {'detail': 'Pix indisponível no momento. Tente novamente.'})
            return
        self.send_json(200, {'payload': payload, 'qrCode': qr})

    def do_GET(self):
        request = urlsplit(self.path)
        if request.path == '/support/pix':
            self.serve_pix(request.query)
            return
        if urlsplit(self.path).path == '/api/ai/status':
            if not auth_db.get_user_by_token(self.get_token()):
                self.send_json(401, {'ok': False, 'error': 'Entre para usar o assistente.'})
                return
            try:
                self.send_json(200, assistant.status())
            except AIError as error:
                self.send_json(error.status, {'ok': False, 'error': error.message})
            return
        route = urlsplit(self.path).path

        if route.startswith('/biblioteca/'):
            self.serve_library(route)
            return

        if route in ['/', '/tjpb-mapa-estudo.html', '/baixar', '/relatorio_visual_fgv_ti_tribunais.html', '/tjpb_desenvolvimento_sistemas_relatorio.html']:
            document = ROOT / route.removeprefix('/') if route in ('/relatorio_visual_fgv_ti_tribunais.html','/tjpb_desenvolvimento_sistemas_relatorio.html') else APP
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
                mime = mimetypes.guess_type(asset_name)[0] or 'application/octet-stream'
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
        try:
            length = int(self.headers.get('Content-Length', 0))
        except ValueError:
            self.send_json(400, {'ok': False, 'error': 'Tamanho de requisição inválido.'})
            return
        if length < 0 or (route == '/api/ai/chat' and length > 180000) or (route == '/api/ai/plan' and length > 40000):
            self.send_json(413, {'ok': False, 'error': 'Conversa muito grande. Reduza a mensagem.'})
            return
        if length > 50 * 1024 * 1024:
            self.send_json(400, {'ok': False, 'error': 'Payload muito grande'})
            return

        body = self.rfile.read(length) if length > 0 else b'{}'
        if route == '/api/ai/transcribe':
            user = auth_db.get_user_by_token(self.get_token())
            if not user:
                self.send_json(401, {'ok': False, 'error': 'Entre para usar o assistente.'})
                return
            try:
                content_type, params = cgi.parse_header(self.headers.get('Content-Type', ''))
                if content_type != 'multipart/form-data' or 'boundary' not in params:
                    raise AIError(400, 'Envie uma gravação de áudio válida.')
                fields = cgi.parse_multipart(io.BytesIO(body), {'boundary': params['boundary'].encode('ascii')})
                audio = fields.get('audio', [b''])[0]
                mime = (fields.get('mime', ['audio/webm'])[0] or 'audio/webm').decode('utf-8') if isinstance(fields.get('mime', ['audio/webm'])[0], bytes) else fields.get('mime', ['audio/webm'])[0]
                if not audio or len(audio) > 10 * 1024 * 1024:
                    raise AIError(413, 'A gravação está vazia ou muito grande.')
                self.send_json(200, assistant.transcribe(user['id'], audio, mime))
            except AIError as error:
                self.send_json(error.status, {'ok': False, 'error': error.message})
            except (UnicodeError, ValueError, KeyError, TypeError) as error:
                self.send_json(400, {'ok': False, 'error': f'Áudio inválido: {error}'})
            return
        try:
            payload = json.loads(body.decode('utf-8'))
        except Exception:
            payload = {}

        if route in ('/api/ai/chat', '/api/ai/plan'):
            user = auth_db.get_user_by_token(self.get_token())
            if not user:
                self.send_json(401, {'ok': False, 'error': 'Entre para usar o assistente.'})
                return
            try:
                self.send_json(200, assistant.plan(user['id'],payload) if route == '/api/ai/plan' else assistant.chat(user['id'], payload))
            except AIError as error:
                headers = {'Retry-After': '60'} if error.status == 429 else None
                self.send_json(error.status, {'ok': False, 'error': error.message}, headers)
            return

        if route == '/api/library/logout':
            self.send_json(200, {'ok': True}, {'Set-Cookie': self.library_cookie(clear=True)})
            return

        if route == '/api/library/session':
            user = auth_db.get_user_by_token(self.get_token())
            if not user:
                self.send_json(401, {'ok': False, 'error': 'Entre na sua conta para acessar os cursos.'}, {'Set-Cookie': self.library_cookie(clear=True)})
            else:
                self.send_json(200, {'ok': True, 'user': user}, {'Set-Cookie': self.library_cookie(self.get_token())})
            return

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
