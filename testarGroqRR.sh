#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ssh -i /home/jandersongustavo/Músicas/vm-docker_key.pem -o BatchMode=yes -o StrictHostKeyChecking=yes azureuser@64.236.155.209 "test \"\$(systemctl show tjpb-estudo.service -p WorkingDirectory --value)\" = /var/www/tjpb && python3 -c $(printf '%q' "$(cat "$ROOT/scripts/groq_admin.py")") test"
