#!/usr/bin/env bash
# Configura exclusivamente a Groq no TJPB; nunca imprime a chave nem a passa em argumentos.
set -euo pipefail
HOST=${1:-64.236.155.209}
KEY=${2:-/home/jandersongustavo/Músicas/vm-docker_key.pem}
REMOTE_USER=${3:-azureuser}
[[ $HOST =~ ^[a-zA-Z0-9.-]+$ && $REMOTE_USER =~ ^[a-zA-Z0-9_-]+$ ]] || exit 1
python3 -c 'import getpass,json,sys
key=getpass.getpass("Chave da Groq (oculta): ").strip()
if not key or any(c.isspace() for c in key): sys.exit("Chave vazia ou inválida.")
json.dump({"api_key":key,"model":"openai/gpt-oss-20b"},sys.stdout)' | ssh -i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=yes "$REMOTE_USER@$HOST" 'test "$(systemctl show tjpb-estudo.service -p WorkingDirectory --value)" = /var/www/tjpb && python3 -c '\''import json,sys,os,tempfile
from urllib.request import Request,urlopen
from urllib.error import HTTPError,URLError
from pathlib import Path
root=Path("/var/www/tjpb")
data=json.load(sys.stdin)
assert isinstance(data.get("api_key"),str) and data["api_key"].strip()
try:
 with urlopen(Request("https://api.groq.com/openai/v1/models",headers={"Authorization":"Bearer "+data["api_key"],"User-Agent":"TJPB-Study/1.0","Accept":"application/json"}),timeout=15) as r: models=json.load(r)
 if data["model"] not in {m.get("id") for m in models.get("data",[])}: sys.exit("Chave aceita, mas o modelo padrão não está disponível nesta conta. Configuração anterior preservada.")
except HTTPError as e:
 sys.exit("A Groq recusou a chave (HTTP "+str(e.code)+"). Configuração anterior preservada. Use uma chave do console.groq.com, sem aspas nem prefixo Bearer.")
except (OSError,ValueError):
 sys.exit("Não foi possível validar a chave na Groq. Configuração anterior preservada.")
print("Chave aceita pela Groq; salvando configuração.",file=sys.stderr)
fd,name=tempfile.mkstemp(prefix=".groq-config-",dir=root)
try:
 os.fchmod(fd,0o600)
 with os.fdopen(fd,"w") as f: json.dump(data,f)
 os.replace(name,root/"groq-config.json")
finally:
 if os.path.exists(name): os.unlink(name)
'\'' && sudo -n systemctl restart tjpb-estudo.service && systemctl is-active tjpb-estudo.service'
printf 'Configuração salva no servidor. Abra a IA e clique em Verificar novamente.\n'
