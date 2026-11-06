#!/usr/bin/env bash
# Chamado por newDeploy.sh; não altera proxy, unidades systemd ou outros serviços.
set -Eeuo pipefail
STAGE=${1:?}; MODE=${2:?}; REQUESTED=${3:-}
APP=/var/www/tjpb
SERVICE=tjpb-estudo.service
DOMAIN=tjpb.jangustavo.me
STATE="$APP/.deploy"
[[ $STAGE =~ ^/tmp/tjpb-deploy\.[a-zA-Z0-9]+$ && $(realpath "$APP") == "$APP" ]] || exit 1
[[ $(systemctl show "$SERVICE" -p WorkingDirectory --value) == "$APP" ]] || exit 1
[[ ! -L "$APP/assets" && ! -L "$APP/dados" ]] || exit 1
mkdir -p "$STATE/backups"
chmod 700 "$STATE" "$STATE/backups"
exec 9>"$STATE/lock"
flock -n 9 || { echo 'Outro deploy TJPB em andamento'; exit 1; }
snapshot_other(){
 systemctl show nginx cronflow-api@blue cronflow-scheduler cronflow-worker docker -p Id -p ActiveState -p MainPID
 sudo -n docker ps -q | xargs -r sudo -n docker inspect --format '{{.Name}} {{.Id}} {{.State.StartedAt}}' | sort
}
snapshot_other > "$STAGE/others-before.txt"
if [[ $MODE == deploy ]]; then
 mkdir "$STAGE/app"
 python3 - "$STAGE" <<'PY'
from pathlib import Path
import tarfile,sys,shutil
s=Path(sys.argv[1]);names=(s/'files.txt').read_text().splitlines()
allowed={'servir.py','auth_db.py','library_service.py','ai_service.py','tjpb-mapa-estudo.html','relatorio_visual_fgv_ti_tribunais.html','tjpb_desenvolvimento_sistemas_relatorio.html','manifest.json','service-worker.js','assets/icon-192.png','assets/icon-512.png','assets/pdf-reader.js','assets/pdf-worker.mjs','dados/drive_catalog.json','dados/drive_tree.json','dados/anki_catalog.json'}
if len(names)!=len(allowed) or set(names)!=allowed: raise SystemExit('Lista de arquivos inesperada')
with tarfile.open(s/'app.tar.gz') as t:
 if len(t.getmembers())!=len(allowed) or any(not m.isfile() or m.name not in allowed for m in t.getmembers()): raise SystemExit('Pacote inválido')
 for m in t.getmembers():
  destination=s/'app'/m.name
  destination.parent.mkdir(parents=True,exist_ok=True)
  with t.extractfile(m) as source, destination.open('wb') as output: shutil.copyfileobj(source,output)
PY
 (cd "$STAGE/app" && sha256sum -c ../SHA256SUMS)
 SOURCE="$STAGE/app"
 FILES="$STAGE/files.txt"
else
 [[ $MODE == rollback && $REQUESTED =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ ]] || exit 1
 SOURCE="$STATE/backups/$REQUESTED/code"
 FILES="$STATE/backups/$REQUESTED/files.txt"
 [[ -d $SOURCE && -f $FILES ]] || { echo 'Backup de código não encontrado'; exit 1; }
fi
ID="$(date -u +%Y%m%dT%H%M%SZ)-$(sha256sum "$SOURCE/tjpb-mapa-estudo.html" | cut -c1-8)"
BACKUP="$STATE/backups/$ID"
mkdir "$BACKUP"
mkdir "$BACKUP/code"
cp "$FILES" "$BACKUP/files.txt"
while IFS= read -r name; do
 [[ $name =~ ^(servir.py|auth_db.py|library_service.py|ai_service.py|tjpb-mapa-estudo.html|relatorio_visual_fgv_ti_tribunais.html|tjpb_desenvolvimento_sistemas_relatorio.html|manifest.json|service-worker.js|assets/icon-192.png|assets/icon-512.png|assets/pdf-reader.js|assets/pdf-worker.mjs|dados/drive_catalog.json|dados/drive_tree.json|dados/anki_catalog.json)$ ]] || exit 1
 [[ ! -L "$APP/$name" ]] || exit 1
 if [[ -f $APP/$name ]]; then mkdir -p "$BACKUP/code/$(dirname "$name")"; cp -p "$APP/$name" "$BACKUP/code/$name"; fi
 if [[ -f $SOURCE/$name ]]; then python3 - "$SOURCE/$name" <<'PY'
import sys,ast
from pathlib import Path
p=Path(sys.argv[1])
if p.suffix=='.py': ast.parse(p.read_text())
PY
 fi
done < "$FILES"
MUTATING=0
restore(){
 sudo -n systemctl stop "$SERVICE"
 while IFS= read -r name; do
  if [[ -f $BACKUP/code/$name ]]; then cp -p "$BACKUP/code/$name" "$APP/$name"; else rm -f -- "$APP/$name"; fi
 done < "$BACKUP/files.txt"
 sudo -n systemctl restart "$SERVICE"
}
on_error(){
 code=$?; trap - ERR INT TERM
 if [[ $MUTATING == 1 ]]; then echo "Falha: revertendo somente arquivos TJPB para $ID"; restore || true; fi
 echo "Deploy interrompido. Backup preservado: $BACKUP"; exit "$code"
}
trap on_error ERR INT TERM
MUTATING=1
sudo -n systemctl stop "$SERVICE"
# Snapshot consistente de dados, com serviço parado; não será restaurado automaticamente.
if [[ -d $APP/dados ]]; then cp -a "$APP/dados" "$BACKUP/dados"; fi
find "$APP/dados" -maxdepth 1 -type f ! -name drive_catalog.json ! -name drive_tree.json ! -name anki_catalog.json -exec sha256sum {} + | sort > "$STAGE/data-before.txt"
if [[ -f $STAGE/drive-token.json && ! -s $APP/token.json ]]; then
 python3 - "$STAGE/drive-token.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
assert all(d.get(k) for k in ('refresh_token','client_id','client_secret')), 'Autorização do Drive incompleta'
PY
 install -m 0600 "$STAGE/drive-token.json" "$APP/token.json"
fi
while IFS= read -r name; do
 mkdir -p "$APP/$(dirname "$name")"
 if [[ -f $SOURCE/$name ]]; then
  install -m 0644 "$SOURCE/$name" "$APP/$name.deploy-tmp"
  mv -f "$APP/$name.deploy-tmp" "$APP/$name"
 else rm -f -- "$APP/$name"; fi
done < "$FILES"
find "$APP/dados" -maxdepth 1 -type f ! -name drive_catalog.json ! -name drive_tree.json ! -name anki_catalog.json -exec sha256sum {} + | sort > "$STAGE/data-after.txt"
cmp "$STAGE/data-before.txt" "$STAGE/data-after.txt"
echo 'Dados de produção preservados: checksums idênticos antes/depois da instalação.'
sudo -n systemctl start "$SERVICE"
healthy=0
for i in {1..20}; do
 if curl -fsS --max-time 5 http://127.0.0.1:8766/ -o "$STAGE/live.html" && cmp -s "$APP/tjpb-mapa-estudo.html" "$STAGE/live.html"; then healthy=1; break; fi
 sleep 1
done
[[ $healthy == 1 ]]
systemctl is-active --quiet "$SERVICE"
curl -fsS --max-time 15 "https://$DOMAIN/" -o "$STAGE/public.html"
cmp "$APP/tjpb-mapa-estudo.html" "$STAGE/public.html"
for file in assets/pdf-reader.js assets/pdf-worker.mjs tjpb_desenvolvimento_sistemas_relatorio.html; do
 curl -fsS --max-time 15 "https://$DOMAIN/$file" -o "$STAGE/$(basename "$file")"
 cmp "$APP/$file" "$STAGE/$(basename "$file")"
done
if [[ -f $APP/relatorio_visual_fgv_ti_tribunais.html ]]; then
 curl -fsS --max-time 15 "https://$DOMAIN/relatorio_visual_fgv_ti_tribunais.html" -o "$STAGE/report.html"
 cmp "$APP/relatorio_visual_fgv_ti_tribunais.html" "$STAGE/report.html"
fi
curl -fsS --max-time 5 http://127.0.0.1:8766/api/me | python3 -c 'import sys,json; d=json.load(sys.stdin); assert d.get("ok") is False and d.get("user") is None; print("API anônima OK")'
if grep -q '^from library_service import' "$APP/servir.py"; then
 for path in /biblioteca/api/tree /biblioteca/api/media/invalid; do
  [[ $(curl -sS --max-time 10 -o "$STAGE/library-denied.json" -w '%{http_code}' "https://$DOMAIN$path") == 401 ]]
 done
 for path in /token.json /credentials.json /dados/drive_catalog.json /dados/anki_catalog.json /groq-config.json; do
  [[ $(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "https://$DOMAIN$path") == 404 ]]
 done
 echo 'Biblioteca protegida: catálogo e mídias exigem login; credenciais não são públicas.'
fi
snapshot_other > "$STAGE/others-after.txt"
if cmp -s "$STAGE/others-before.txt" "$STAGE/others-after.txt"; then
 echo 'Outros serviços e contêineres: mesmos PIDs, IDs e datas de inicialização.'
else
 echo 'AVISO: estado externo mudou durante o deploy; nenhuma ação foi executada nesses serviços.'
 diff -u "$STAGE/others-before.txt" "$STAGE/others-after.txt" || true
fi
MUTATING=0
trap - ERR INT TERM
printf '%s\n' "$ID" > "$STATE/last-successful-backup"
printf 'SUCESSO: https://%s/\nBACKUP_ID=%s\nBACKUP=%s\n' "$DOMAIN" "$ID" "$BACKUP"
