#!/usr/bin/env bash
# Deploy exclusivo do TJPB. Uso: ./newDeploy.sh [IP] [CHAVE] [USUARIO]
# Inspecionar: ./newDeploy.sh --check
# Reverter código: ./newDeploy.sh --rollback ID [IP] [CHAVE] [USUARIO]
set -Eeuo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
MODE=deploy
RELEASE=''
if [[ ${1:-} == --check ]]; then MODE=check; shift; fi
if [[ ${1:-} == --rollback ]]; then MODE=rollback; RELEASE=${2:?Informe o ID do backup}; shift 2; fi
HOST=${1:-64.236.155.209}
KEY=${2:-/home/jandersongustavo/Músicas/vm-docker_key.pem}
REMOTE_USER=${3:-azureuser}
[[ $HOST =~ ^[a-zA-Z0-9.-]+$ && $REMOTE_USER =~ ^[a-zA-Z0-9_-]+$ ]] || { echo 'Host/usuário inválido'; exit 1; }
[[ -r $KEY ]] || { echo "Chave não encontrada: $KEY"; exit 1; }
[[ $MODE != rollback || $RELEASE =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ ]] || { echo 'ID de backup inválido'; exit 1; }
SSH=(ssh -i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15)
SCP=(scp -i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15)
TARGET="$REMOTE_USER@$HOST"
mkdir -p "$ROOT/deploy/logs"
LOG="$ROOT/deploy/logs/$(date -u +%Y%m%dT%H%M%SZ)-${MODE}.log"
exec > >(tee -a "$LOG") 2>&1
log(){ printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
log "Verificando tjpb-estudo.service em $TARGET"
"${SSH[@]}" "$TARGET" 'test "$(systemctl show tjpb-estudo.service -p WorkingDirectory --value)" = /var/www/tjpb && systemctl is-active tjpb-estudo.service && test -w /var/www/tjpb && sudo -n true && systemctl show tjpb-estudo.service -p User -p MainPID -p ExecStart'
[[ $MODE != check ]] || exit 0
STAGING=$(mktemp -d)
REMOTE_STAGE=''
cleanup(){ rm -rf -- "$STAGING"; if [[ $REMOTE_STAGE =~ ^/tmp/tjpb-deploy\.[a-zA-Z0-9]+$ ]]; then "${SSH[@]}" "$TARGET" "rm -rf -- '$REMOTE_STAGE'" || true; fi; }
trap cleanup EXIT
if [[ $MODE == deploy ]]; then
  log 'Gerando HTML e pacote com lista explícita de arquivos (sem dados de usuários)'
  if [[ ! -d "$ROOT/frontend-courses/node_modules" ]]; then
    npm --prefix "$ROOT/frontend-courses" ci --ignore-scripts --no-audit --no-fund
  fi
  npm --prefix "$ROOT/frontend-courses" run build
  python3 "$ROOT/scripts/build_mobile.py"
  python3 - "$ROOT" "$STAGING" <<'PY'
from pathlib import Path
import sys,hashlib,tarfile,ast
root,stage=map(Path,sys.argv[1:])
files=['servir.py','auth_db.py','library_service.py','ai_service.py','tjpb-mapa-estudo.html','relatorio_visual_fgv_ti_tribunais.html','tjpb_desenvolvimento_sistemas_relatorio.html','manifest.json','service-worker.js','assets/icon-192.png','assets/icon-512.png','dados/drive_catalog.json','dados/drive_tree.json']
for name in ['servir.py','auth_db.py','library_service.py','ai_service.py']: ast.parse((root/name).read_text())
with tarfile.open(stage/'app.tar.gz','w:gz') as archive:
 for name in files:
  p=root/name
  if p.is_symlink() or not p.is_file(): raise SystemExit('Arquivo inválido: '+name)
  archive.add(p,arcname=name)
(stage/'SHA256SUMS').write_text(''.join(hashlib.sha256((root/name).read_bytes()).hexdigest()+'  '+name+'\n' for name in files))
(stage/'files.txt').write_text('\n'.join(files)+'\n')
PY
fi
REMOTE_STAGE=$("${SSH[@]}" "$TARGET" 'mktemp -d /tmp/tjpb-deploy.XXXXXXXX')
[[ $REMOTE_STAGE =~ ^/tmp/tjpb-deploy\.[a-zA-Z0-9]+$ ]] || { echo 'Diretório remoto inválido'; exit 1; }
"${SCP[@]}" "$ROOT/deploy/remote-tjpb.sh" "$TARGET:$REMOTE_STAGE/remote-tjpb.sh"
if [[ $MODE == deploy ]]; then
  "${SCP[@]}" "$STAGING/app.tar.gz" "$STAGING/SHA256SUMS" "$STAGING/files.txt" "$TARGET:$REMOTE_STAGE/"
  # Provisionamento inicial explícito da integração; nunca sobrescreve o token ativo da VPS.
  if ! "${SSH[@]}" "$TARGET" 'test -s /var/www/tjpb/token.json'; then
    [[ -r "$ROOT/token.json" ]] || { echo 'A autorização do Drive precisa ser configurada antes de publicar os cursos.'; exit 1; }
    log 'Provisionando a autorização do Drive em arquivo privado no servidor TJPB'
    "${SCP[@]}" "$ROOT/token.json" "$TARGET:$REMOTE_STAGE/drive-token.json"
  fi
fi
log "Executando $MODE apenas no serviço TJPB"
printf -v REMOTE_COMMAND 'bash %q %q %q %q' "$REMOTE_STAGE/remote-tjpb.sh" "$REMOTE_STAGE" "$MODE" "$RELEASE"
"${SSH[@]}" "$TARGET" "$REMOTE_COMMAND"
log "Concluído. Site: https://tjpb.jangustavo.me/ — log: $LOG"
