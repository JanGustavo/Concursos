"""TJPB local library prototype. Run from project root with: python scripts/tjpb_library.py"""
import json
import os
import re
import threading
from pathlib import Path

import requests
from flask import Blueprint, Response, abort, jsonify, request, stream_with_context, current_app
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2.credentials import Credentials

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'dados'
SCOPES = ['https://www.googleapis.com/auth/drive.readonly']
TOKEN_PATH = ROOT / 'token.json'
CHUNK_BYTES = 4 * 1024 * 1024
LOCK = threading.Lock()
# Não exponha este Blueprint sem configurar TJPB_LIBRARY_AUTHORIZE.
# A função deve retornar True somente para um usuário com sessão autorizada.
from functools import wraps

def require_login(fn):
    @wraps(fn)
    def protected(*args, **kwargs):
        authorize = current_app.config.get('TJPB_LIBRARY_AUTHORIZE')
        if not callable(authorize) or authorize() is not True:
            abort(403, description='Acesso à biblioteca não autorizado')
        return fn(*args, **kwargs)
    return protected

library_bp = Blueprint('tjpb_library', __name__, url_prefix='/biblioteca')

catalog = json.loads((DATA / 'drive_catalog.json').read_text(encoding='utf-8'))
valid = {x['id']: x for x in catalog if x.get('categoria') in ('video', 'pdf')}
tree = json.loads((DATA / 'drive_tree.json').read_text(encoding='utf-8'))


def token():
    with LOCK:
        creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), scopes=SCOPES)
        if not creds.valid:
            if creds.expired and creds.refresh_token:
                creds.refresh(GoogleAuthRequest())
                TOKEN_PATH.write_text(creds.to_json(), encoding='utf-8')
                os.chmod(TOKEN_PATH, 0o600)
            else:
                raise RuntimeError('Token OAuth inválido. Autorize novamente o aplicativo.')
        return creds.token


def branch(node):
    """Keep meaningful teaching folders; flatten only technical asset containers."""
    if node.get('type') == 'file':
        file_info = valid.get(node['id'])
        if not file_info:
            return None
        return {'id': node['id'], 'name': node['name'],
                'type': file_info['categoria']}
    children = []
    for child in node.get('children', []):
        sub = branch(child)
        if not sub:
            continue
        if (sub['type'] == 'folder' and
                sub['name'].casefold() in ('videos', 'pdfs', 'images') and
                node.get('name', '').casefold() not in ('videos', 'pdfs', 'images')):
            children.extend(sub['children'])
        else:
            children.append(sub)
    if not children:
        return None
    # Keep meaningful hierarchy and sort assets separately from modules.
    children.sort(key=lambda x: (x['type'] != 'folder', x['name'].casefold()))
    return {'id': node['id'], 'name': node['name'], 'type': 'folder',
            'children': children}


catalog_tree = branch(tree)


@library_bp.get('/api/tree')
@require_login
def get_tree():
    return jsonify(catalog_tree)


@library_bp.route('/api/media/<file_id>', methods=['GET', 'HEAD'])
@require_login
def media(file_id):
    item = valid.get(file_id)
    if not item:
        abort(404)
    size = int(item.get('tamanho') or 0)
    if size <= 0:
        abort(409, 'Tamanho não disponível no catálogo; sincronize os metadados.')
    mime = 'video/mp4' if item['categoria'] == 'video' else 'application/pdf'
    headers = {'Accept-Ranges': 'bytes', 'Content-Type': mime,
               'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'}
    raw_range = request.headers.get('Range')
    start, end = 0, min(size - 1, CHUNK_BYTES - 1)
    if raw_range:
        m = re.fullmatch(r'bytes=(\d*)-(\d*)', raw_range.strip())
        if not m or (not m.group(1) and not m.group(2)):
            return Response(status=416, headers={**headers, 'Content-Range': f'bytes */{size}'})
        if m.group(1):
            start = int(m.group(1))
            end = min(int(m.group(2)), size - 1) if m.group(2) else size - 1
        else:
            suffix = int(m.group(2))
            start = max(0, size - suffix)
            end = size - 1
        if start >= size or start > end:
            return Response(status=416, headers={**headers, 'Content-Range': f'bytes */{size}'})
        end = min(end, start + CHUNK_BYTES - 1)
    headers['Content-Range'] = f'bytes {start}-{end}/{size}'
    headers['Content-Length'] = str(end - start + 1)
    if request.method == 'HEAD':
        return Response(status=206, headers=headers)
    try:
        upstream = requests.get(
            f'https://www.googleapis.com/drive/v3/files/{file_id}',
            params={'alt': 'media'},
            headers={'Authorization': f'Bearer {token()}', 'Range': f'bytes={start}-{end}'},
            stream=True, timeout=(10, 45), allow_redirects=False)
    except (requests.RequestException, RuntimeError, ValueError) as exc:
        current_app.logger.warning('Falha ao acessar Drive: %s', exc)
        abort(502, 'Não foi possível acessar o Google Drive')
    if upstream.status_code != 206:
        current_app.logger.warning('Drive HTTP %s: %s', upstream.status_code, upstream.text[:200])
        upstream.close()
        abort(502, 'Drive não retornou conteúdo parcial')
    expected = f'bytes {start}-{end}/{size}'
    if upstream.headers.get('Content-Range') != expected:
        current_app.logger.warning('Content-Range inesperado: %s', upstream.headers.get('Content-Range'))
        upstream.close()
        abort(502, 'Intervalo do Drive não coincide com o catálogo')

    def chunks():
        try:
            yield from upstream.iter_content(chunk_size=64 * 1024)
        finally:
            upstream.close()
    return Response(stream_with_context(chunks()), status=206, headers=headers)


PAGE = r'''<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TJPB · Biblioteca</title>
<style>
:root{font-family:Inter,system-ui,-apple-system,sans-serif;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:#0d111b;color:#eff2fa}button,input,select{font:inherit}
header{height:64px;padding:0 24px;display:flex;align-items:center;justify-content:space-between;background:#141927;border-bottom:1px solid #30394b}
.brand{font-weight:750;font-size:17px}.tag{font-size:12px;color:#aab5cb;background:#252d40;border-radius:14px;padding:5px 10px}
main{display:grid;grid-template-columns:360px minmax(0,1fr);min-height:calc(100vh - 64px)}
aside{min-width:0;padding:18px;border-right:1px solid #30394b;max-height:calc(100vh - 64px);overflow:auto}
.search{width:100%;padding:12px 14px;border:1px solid #424d64;border-radius:10px;background:#20283b;color:white;margin:0 0 16px}
.hint{color:#a9b7cc;font-size:13px;margin:0 0 16px}.tree{list-style:none;padding:0;margin:0}.tree ul{padding-left:17px;list-style:none}
li{margin:3px 0}.folder-btn,.file-btn{border:0;border-radius:8px;background:transparent;color:inherit;padding:8px;text-align:left;cursor:pointer;width:100%;line-height:1.35;overflow-wrap:anywhere}
.folder-btn:hover,.file-btn:hover,.file-btn.active{background:#29344f}.folder-btn{font-weight:650}.file-btn{font-size:13px;color:#d5e1f7}
.lesson{padding:26px 34px 50px;min-width:0;max-width:1500px;width:100%;margin:0 auto}.crumb{font-size:13px;color:#abb9d0;overflow-wrap:anywhere;margin-bottom:12px}
h1{font-size:clamp(20px,2vw,29px);margin:0 0 8px;overflow-wrap:anywhere}.sub{margin:0 0 20px;color:#a9b7cc}
video{display:block;width:100%;max-height:67vh;background:#000;border-radius:12px}#player{min-height:40px}
.controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:16px 0}.action{border:1px solid #3d4a63;background:#222c41;border-radius:9px;color:#f4f6fd;padding:10px 13px;cursor:pointer}
.action:hover{background:#30405f}.action:disabled{opacity:.4;cursor:not-allowed}.action.primary{background:#485aff;border-color:#6271ff}
select{border:1px solid #3d4a63;background:#222c41;color:white;border-radius:8px;padding:9px}
.note{color:#9eacc4;font-size:13px;margin-top:12px}.resources{margin-top:26px;border:1px solid #30394b;border-radius:12px;padding:18px;background:#141927}
.resources h2{font-size:17px;margin:0 0 12px}.resource{display:flex;gap:12px;align-items:center;color:#dfe8fc;padding:9px 0;text-decoration:none;border-bottom:1px solid #273044;overflow-wrap:anywhere}
.resource:last-child{border-bottom:0}.resource:hover{color:#b3c1ff}.empty{color:#a8b6cf;font-size:14px}
a{color:#a2b7ff}#error{color:#ffb4b4;white-space:pre-wrap}
@media(max-width:850px){main{display:block}aside{max-height:36vh;border-right:0;border-bottom:1px solid #30394b}.lesson{padding:20px 16px}header{padding:0 16px}}
</style></head><body>
<header><div class="brand">📚 TJPB · Biblioteca</div><span class="tag">Protótipo local</span></header>
<main><aside><input class="search" id="search" placeholder="Pesquisar aulas e materiais..." aria-label="Pesquisar aulas e materiais"><p class="hint" id="count">Carregando catálogo...</p><div id="items"></div></aside>
<section class="lesson"><div class="crumb" id="crumb">Biblioteca / Escolha uma aula</div><h1 id="title">Selecione uma aula</h1><p class="sub" id="status">Abra um módulo e escolha uma videoaula ou material.</p><div id="player"></div>
<div class="controls"><button class="action" id="prev" disabled>← Aula anterior</button><button class="action" id="next" disabled>Próxima aula →</button><button class="action primary" id="done" disabled>Marcar como concluída</button><label for="speed">Velocidade</label><select id="speed" aria-label="Velocidade do vídeo"><option value="0.75">0,75×</option><option value="1" selected>1×</option><option value="1.25">1,25×</option><option value="1.5">1,5×</option><option value="1.75">1,75×</option><option value="2">2×</option></select></div>
<div class="note" id="progressText"></div><div class="resources" id="resources" hidden><h2>Materiais da aula</h2><div id="resourceList"></div></div>
<p class="note">Progresso salvo neste navegador. Atalhos: espaço para pausar, ←/→ para retroceder/avançar 10 segundos (quando o foco não estiver em um campo).</p><p id="error" role="alert"></p>
</section></main>
<script>
'use strict';
const $=s=>document.querySelector(s);
let tree, entries=[], current=null, currentVideo=null, currentVideoIndex=-1, lastSaved=0;
const progressKey='tjpb-library-progress-v2';
let progress={};try{progress=JSON.parse(localStorage.getItem(progressKey)||'{}')}catch{progress={}}
const persist=()=>{try{localStorage.setItem(progressKey,JSON.stringify(progress))}catch{}}
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n};
const isVideo=n=>n.type==='video';
function walk(node,segments=[]){const path=[...segments,node.name];if(node.type==='folder'){node.children.forEach(n=>walk(n,path));return}
 entries.push({...node,path:path.slice(1),folderPath:path.slice(1,-1)});
}
function related(node){return entries.filter(e=>e.folderPath.join('/')===node.folderPath.join('/'))}
function progressLabel(){const rec=progress[current?.id];if(!current||!isVideo(current)){ $('#progressText').textContent='';return }
 $('#progressText').textContent=rec?.done?'✓ Aula concluída':rec?.time?'Retomada disponível em '+Math.floor(rec.time/60)+'min '+Math.floor(rec.time%60)+'s':'Aula ainda não iniciada';
 $('#done').textContent=rec?.done?'✓ Concluída (desmarcar)':'Marcar como concluída';}
function saveCurrent(force=false){if(!currentVideo||!current)return;const now=Date.now();if(!force && now-lastSaved<5000)return;lastSaved=now;
 const old=progress[current.id]||{};progress[current.id]={...old,time:currentVideo.currentTime||0};persist()}
function updateButtons(){const videos=entries.filter(isVideo);currentVideoIndex=current?videos.findIndex(e=>e.id===current.id):-1;
 $('#prev').disabled=currentVideoIndex<=0;$('#next').disabled=currentVideoIndex<0||currentVideoIndex>=videos.length-1;$('#done').disabled=!current||!isVideo(current);
 progressLabel();}
function openEntry(node){saveCurrent(true);current=node;currentVideo=null;
 $('#title').textContent=node.name;$('#crumb').textContent='Biblioteca / '+node.path.slice(0,-1).join(' / ');
 $('#status').textContent=node.type==='video'?'Videoaula transmitida pelo Google Drive':'Material em PDF';$('#error').textContent='';
 const container=$('#player');container.replaceChildren();
 if(isVideo(node)){
  const v=el('video');v.controls=true;v.preload='metadata';v.playsInline=true;v.src='/biblioteca/api/media/'+encodeURIComponent(node.id);v.playbackRate=Number($('#speed').value);currentVideo=v;
  v.addEventListener('loadedmetadata',()=>{const saved=progress[node.id]?.time||0;if(saved>0&&saved<v.duration-5){try{v.currentTime=saved}catch{}}});
  v.addEventListener('timeupdate',()=>saveCurrent());v.addEventListener('pause',()=>saveCurrent(true));v.addEventListener('seeking',()=>saveCurrent(true));
  v.addEventListener('ended',()=>{progress[node.id]={time:0,done:true};persist();updateButtons()});
  v.addEventListener('error',()=>{$('#error').textContent='Erro de reprodução. Confira a saída do servidor e as permissões do Drive.'});container.append(v);
 }else{const a=el('a','📄 Abrir PDF em nova aba');a.href='/biblioteca/api/media/'+encodeURIComponent(node.id);a.target='_blank';a.rel='noopener';container.append(a)}
 const siblings=related(node).filter(e=>e.type==='pdf'&&e.id!==node.id);
 $('#resources').hidden=siblings.length===0;const list=$('#resourceList');list.replaceChildren();for(const pdf of siblings){const a=el('a','📄 '+pdf.name,'resource');a.href='/biblioteca/api/media/'+encodeURIComponent(pdf.id);a.target='_blank';a.rel='noopener';list.append(a)}
 updateButtons();render();}
function nodeUI(node,query='',depth=0){const li=el('li');if(node.type==='folder'){
 const children=node.children.map(n=>nodeUI(n,query,depth+1)).filter(Boolean);
 if(query && !children.length && !node.name.toLocaleLowerCase('pt-BR').includes(query))return null;
 const details=el('details'),summary=el('summary');summary.className='folder-btn';summary.textContent='📁 '+node.name;
 details.append(summary);const ul=el('ul');children.forEach(n=>ul.append(n));details.append(ul);
 if(query||depth===0)details.open=true;li.append(details);
 }else{
 if(query&&!node.name.toLocaleLowerCase('pt-BR').includes(query))return null;
 const btn=el('button',(node.type==='video'?'▶ ':'📄 ')+node.name,'file-btn');if(current?.id===node.id)btn.classList.add('active');btn.onclick=()=>openEntry(entries.find(e=>e.id===node.id));li.append(btn);
 }return li}
function render(){const query=$('#search').value.trim().toLocaleLowerCase('pt-BR');$('#items').replaceChildren();if(!tree)return;
 const list=el('ul',undefined,'tree'),node=nodeUI(tree,query);if(node)list.append(node);else list.append(el('li','Nenhum resultado encontrado','empty'));$('#items').append(list)}
$('#search').addEventListener('input',render);
$('#speed').addEventListener('change',()=>{if(currentVideo)currentVideo.playbackRate=Number($('#speed').value)});
$('#prev').onclick=()=>{const v=entries.filter(isVideo);if(currentVideoIndex>0)openEntry(v[currentVideoIndex-1])};
$('#next').onclick=()=>{const v=entries.filter(isVideo);if(currentVideoIndex>=0&&currentVideoIndex+1<v.length)openEntry(v[currentVideoIndex+1])};
$('#done').onclick=()=>{if(!current||!isVideo(current))return;const old=progress[current.id]||{};progress[current.id]={...old,done:!old.done};persist();updateButtons()};
document.addEventListener('keydown',e=>{const t=e.target;if(t.closest('input,textarea,select,button,a,[contenteditable]')||!currentVideo)return;
 if(e.code==='Space'){e.preventDefault();currentVideo.paused?currentVideo.play():currentVideo.pause()}
 if(e.key==='ArrowLeft'){e.preventDefault();currentVideo.currentTime=Math.max(0,currentVideo.currentTime-10)}
 if(e.key==='ArrowRight'){e.preventDefault();currentVideo.currentTime=Math.min(currentVideo.duration||Infinity,currentVideo.currentTime+10)}});
fetch('/biblioteca/api/tree').then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.json()}).then(t=>{tree=t;walk(t);$('#count').textContent=entries.filter(isVideo).length+' vídeos · '+entries.filter(n=>n.type==='pdf').length+' PDFs';render();
 const remembered=localStorage.getItem('tjpb-last-id');if(remembered){const found=entries.find(n=>n.id===remembered);if(found)openEntry(found)}
}).catch(e=>{$('#items').textContent='Falha ao carregar catálogo: '+e.message});
const originalOpen=openEntry;openEntry=function(n){originalOpen(n);try{localStorage.setItem('tjpb-last-id',n.id)}catch{}};
window.addEventListener('pagehide',()=>saveCurrent(true));
</script></body></html>'''

@library_bp.get('/')
@require_login
def index():
    return Response(PAGE, content_type='text/html; charset=utf-8', headers={'Cache-Control': 'no-store'})


# Exemplo de registro no Flask existente:
# from scripts.tjpb_library_blueprint import library_bp
# app.config['TJPB_LIBRARY_AUTHORIZE'] = sua_funcao_de_autorizacao
# app.register_blueprint(library_bp)
