#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SLOT=${1:?Uso: ./configurarGroqRR.sh 1|2|3}
[[ $SLOT =~ ^[123]$ ]] || { echo 'Escolha o slot 1, 2 ou 3.'; exit 1; }
python3 -c 'import getpass,json,sys
key=getpass.getpass("Chave Groq do slot "+sys.argv[1]+" (oculta): ").strip()
if not key: sys.exit("Chave vazia.")
json.dump({"slot":int(sys.argv[1]),"key":key},sys.stdout)' "$SLOT" |
ssh -i /home/jandersongustavo/Músicas/vm-docker_key.pem -o BatchMode=yes -o StrictHostKeyChecking=yes azureuser@64.236.155.209 "test \"\$(systemctl show tjpb-estudo.service -p WorkingDirectory --value)\" = /var/www/tjpb && python3 -c $(printf '%q' "$(cat "$ROOT/scripts/groq_admin.py")") set && sudo -n systemctl restart tjpb-estudo.service && systemctl is-active tjpb-estudo.service"
