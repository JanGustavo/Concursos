#!/usr/bin/env bash
# Execute depois de mudar o status do OAuth no Google Cloud para Em produção.
set -Eeuo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PY="$ROOT/.venv/bin/python"
KEY=${TJPB_SSH_KEY:-/home/jandersongustavo/Músicas/vm-docker_key.pem}
TARGET=${TJPB_SSH_TARGET:-azureuser@64.236.155.209}
[[ -x "$PY" && -r "$ROOT/credentials.json" && -r "$KEY" ]] || { echo 'Faltam o ambiente Python, credentials.json ou a chave SSH.'; exit 1; }

PYTHONUNBUFFERED=1 "$PY" - "$ROOT" <<'PY'
import os, sys
from pathlib import Path
from google_auth_oauthlib.flow import InstalledAppFlow

root = Path(sys.argv[1])
flow = InstalledAppFlow.from_client_secrets_file(str(root / 'credentials.json'), ['https://www.googleapis.com/auth/drive.readonly'])
print('Abra o endereço abaixo no navegador deste computador e autorize o acesso à sua pasta do Drive.')
creds = flow.run_local_server(host='localhost', port=0, open_browser=False, access_type='offline', prompt='consent', timeout_seconds=300)
if not creds.refresh_token:
    raise SystemExit('O Google não forneceu um token de renovação. A autorização anterior foi preservada.')
path = root / 'token.json'
temporary = root / 'token.renew.tmp'
fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w') as stream:
    stream.write(creds.to_json())
if path.exists():
    backup = root / 'token.backup.json'
    backup.write_bytes(path.read_bytes())
    backup.chmod(0o600)
temporary.replace(path)
path.chmod(0o600)
print('Nova autorização salva localmente.')
PY

REMOTE_TMP=$(ssh -i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=yes "$TARGET" 'mktemp /tmp/tjpb-drive-token.XXXXXXXX')
[[ "$REMOTE_TMP" =~ ^/tmp/tjpb-drive-token\.[A-Za-z0-9]+$ ]] || { echo 'Caminho temporário remoto inválido.'; exit 1; }
trap 'ssh -i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=yes "$TARGET" "rm -f -- $REMOTE_TMP" >/dev/null 2>&1 || true' EXIT
scp -i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=yes "$ROOT/token.json" "$TARGET:$REMOTE_TMP" >/dev/null
ssh -i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=yes "$TARGET" "cd /var/www/tjpb && python3 - '$REMOTE_TMP'" <<'PY'
import json, os, shutil, sys
from pathlib import Path
from library_service import library, LibraryError
source = Path(sys.argv[1]); target = Path('token.json')
data = json.loads(source.read_text())
if not all(data.get(k) for k in ('refresh_token','client_id','client_secret')):
    raise SystemExit('Nova autorização incompleta; token antigo preservado.')
backup = Path('token.before-renew.json')
if target.exists():
    shutil.copy2(target, backup)
    backup.chmod(0o600)
os.replace(source, target)
target.chmod(0o600)
try:
    library.access_token()
except LibraryError:
    if backup.exists(): os.replace(backup, target)
    raise SystemExit('A nova autorização não funcionou. Token anterior restaurado.')
print('Drive autorizado na VPS. O acesso às aulas foi renovado.')
PY
