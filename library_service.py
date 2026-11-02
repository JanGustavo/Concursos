"""Catálogo e streaming do Drive compartilhados pelos adaptadores HTTP.

Adapta as regras de hierarquia e Range do protótipo scripts/tjpb_library.py.
Nenhum token, caminho de credencial ou URL autenticada é entregue ao navegador.
"""
import datetime as dt
import json
import os
import re
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
CHUNK_BYTES = 4 * 1024 * 1024


class LibraryError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message
        super().__init__(message)


def natural(value):
    return [(0, int(p)) if p.isdigit() else (1, p.casefold()) for p in re.split(r'(\d+)', value)]


def title(value):
    return re.sub(r'-\d{8}T\d{6}Z-\d+-\d+$', '', value).strip()


def byte_range(raw, size):
    if size <= 0:
        raise LibraryError(409, 'Metadados da mídia incompletos. Atualize o catálogo.')
    if raw is None:
        return 0, size - 1, 200
    match = re.fullmatch(r'bytes=(\d{0,20})-(\d{0,20})', raw.strip())
    if not match or not any(match.groups()):
        raise LibraryError(416, 'Intervalo inválido.')
    first, last = match.groups()
    if first:
        start, end = int(first), min(int(last), size - 1) if last else size - 1
    else:
        suffix = int(last)
        if suffix <= 0:
            raise LibraryError(416, 'Intervalo inválido.')
        start, end = max(0, size - suffix), size - 1
    if start >= size or start > end:
        raise LibraryError(416, 'Intervalo fora da mídia.')
    return start, min(end, start + CHUNK_BYTES - 1), 206


class DriveLibrary:
    def __init__(self, root=ROOT, opener=urlopen):
        self.root = Path(root)
        self.opener = opener
        self._catalog_lock = threading.Lock()
        self._token_lock = threading.Lock()
        self._slots = threading.BoundedSemaphore(6)
        self._users_lock = threading.Lock()
        self._users = {}
        self._signature = None
        self.items = {}
        self._payload = None

    def load(self):
        paths = [self.root / 'dados' / name for name in ('drive_tree.json', 'drive_catalog.json')]
        try:
            signature = tuple((p.stat().st_mtime_ns, p.stat().st_size) for p in paths)
        except OSError:
            raise LibraryError(503, 'A biblioteca ainda não foi configurada no servidor.')
        with self._catalog_lock:
            if signature == self._signature:
                return
            try:
                raw_tree, catalog = [json.loads(p.read_text(encoding='utf-8')) for p in paths]
                valid = {x['id']: x for x in catalog if x.get('categoria') in ('video', 'pdf')}
                def branch(node):
                    if node.get('type') == 'file':
                        item = valid.get(node.get('id'))
                        if not item:
                            return None
                        return {'id': node['id'], 'name': node['name'], 'type': item['categoria']}
                    children = []
                    for child in node.get('children', []):
                        sub = branch(child)
                        if sub:
                            if sub['type'] == 'folder' and sub['name'].casefold() in ('videos', 'pdfs', 'images'):
                                children.extend(sub['children'])
                            else:
                                children.append(sub)
                    if not children:
                        return None
                    children.sort(key=lambda x: (x['type'] != 'folder', natural(x['name'])))
                    return {'id': node['id'], 'name': title(node['name']), 'type': 'folder', 'children': children}
                processed = branch(raw_tree)
                courses = []
                def count(node, kind):
                    return int(node['type'] == kind) + sum(count(c, kind) for c in node.get('children', []))
                for node in processed['children'] if processed else []:
                    if node['type'] != 'folder':
                        continue
                    while len(node['children']) == 1 and node['children'][0]['type'] == 'folder' and node['name'] == node['children'][0]['name']:
                        node = node['children'][0]
                    courses.append({'id': node['id'], 'title': node['name'], 'tree': node,
                                    'videos': count(node, 'video'), 'pdfs': count(node, 'pdf')})
                # Somente mídias presentes na árvore processada podem ser requisitadas.
                reachable = set()
                def visit(node):
                    if node['type'] != 'folder': reachable.add(node['id'])
                    for c in node.get('children', []): visit(c)
                for course in courses: visit(course['tree'])
                self.items = {key: value for key, value in valid.items() if key in reachable}
                self._payload = {'courses': courses, 'videos': sum(c['videos'] for c in courses),
                                 'pdfs': sum(c['pdfs'] for c in courses), 'source': 'Google Drive',
                                 'catalogUpdatedAt': dt.datetime.fromtimestamp(paths[1].stat().st_mtime, dt.timezone.utc).isoformat()}
                self._signature = signature
            except (ValueError, KeyError, TypeError, OSError):
                raise LibraryError(503, 'Catálogo indisponível. Confira a exportação da biblioteca.')

    def catalog(self):
        self.load()
        return self._payload

    def access_token(self):
        path = self.root / 'token.json'
        with self._token_lock:
            try:
                data = json.loads(path.read_text(encoding='utf-8'))
                expiry = dt.datetime.fromisoformat(data.get('expiry', '').replace('Z', '+00:00'))
                if expiry.tzinfo is None:
                    expiry = expiry.replace(tzinfo=dt.timezone.utc)
                if data.get('token') and expiry.timestamp() > time.time() + 90:
                    return data['token']
                if not all(data.get(k) for k in ('refresh_token', 'client_id', 'client_secret')):
                    raise ValueError('OAuth incompleto')
                request = Request('https://oauth2.googleapis.com/token', data=urlencode({
                    'grant_type': 'refresh_token', 'refresh_token': data['refresh_token'],
                    'client_id': data['client_id'], 'client_secret': data['client_secret']
                }).encode(), headers={'Content-Type': 'application/x-www-form-urlencoded'}, method='POST')
                with self.opener(request, timeout=30) as response:
                    renewed = json.load(response)
                if not renewed.get('access_token'):
                    raise ValueError('OAuth inválido')
                data['token'] = renewed['access_token']
                data['expiry'] = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=int(renewed.get('expires_in', 3600)))).isoformat()
                temporary = path.with_name('token.refresh.tmp')
                fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
                with os.fdopen(fd, 'w') as stream: json.dump(data, stream)
                temporary.chmod(0o600)
                temporary.replace(path)
                return data['token']
            except (OSError, ValueError, KeyError, HTTPError, URLError):
                raise LibraryError(503, 'Conexão com o Drive indisponível. É necessário revisar a autorização no servidor.')

    def media(self, file_id, raw_range, head=False):
        self.load()
        item = self.items.get(file_id)
        if not item:
            raise LibraryError(404, 'Material não encontrado nesta biblioteca.')
        size = int(item.get('tamanho') or 0)
        try:
            start, end, status = byte_range(raw_range, size)
        except LibraryError as error:
            if error.status == 416:
                error.content_range = f'bytes */{size}'
            raise
        mime = item.get('mimeType', '') if item['categoria'] == 'video' else 'application/pdf'
        if not mime.startswith('video/') and mime != 'application/pdf':
            raise LibraryError(415, 'Formato de mídia não suportado.')
        headers = {'Content-Type': mime, 'Content-Length': str(end - start + 1),
                   'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store',
                   'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
                   'Content-Disposition': "inline; filename*=UTF-8''" + quote(item['nome'], safe='')}
        if status == 206:
            headers['Content-Range'] = f'bytes {start}-{end}/{size}'
        if head:
            return status, headers, None
        upstream_headers = {'Authorization': 'Bearer ' + self.access_token()}
        if status == 206:
            upstream_headers['Range'] = f'bytes={start}-{end}'
        request = Request('https://www.googleapis.com/drive/v3/files/' + quote(file_id, safe='') + '?alt=media', headers=upstream_headers)
        try:
            response = self.opener(request, timeout=45)
        except (HTTPError, URLError, OSError):
            raise LibraryError(502, 'Não foi possível carregar o material do Drive. Tente novamente.')
        if response.status != status or (status == 206 and response.headers.get('Content-Range') != headers['Content-Range']):
            response.close()
            raise LibraryError(502, 'A mídia mudou no Drive ou o intervalo não pôde ser atendido. Atualize o catálogo.')
        return status, headers, response

    @contextmanager
    def stream_slot(self, user_id):
        with self._users_lock:
            if self._users.get(user_id, 0) >= 2 or not self._slots.acquire(blocking=False):
                raise LibraryError(429, 'Há muitos materiais abertos. Feche outro player e tente novamente.')
            self._users[user_id] = self._users.get(user_id, 0) + 1
        try:
            yield
        finally:
            with self._users_lock:
                self._users[user_id] -= 1
                if not self._users[user_id]: del self._users[user_id]
                self._slots.release()


library = DriveLibrary()
