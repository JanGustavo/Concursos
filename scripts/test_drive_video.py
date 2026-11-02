
import sys
from pathlib import Path

import requests
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials

ROOT = Path(__file__).resolve().parent.parent

SCOPES = [
    "https://www.googleapis.com/auth/drive.readonly"
]


def main():
    if len(sys.argv) != 2:
        print("Uso: python scripts/test_drive_video.py FILE_ID")
        sys.exit(1)

    credentials = Credentials.from_authorized_user_file(
        ROOT / "token.json",
        scopes=SCOPES
    )

    if credentials.expired:
        credentials.refresh(Request())

    file_id = sys.argv[1]

    response = requests.get(
        f"https://www.googleapis.com/drive/v3/files/{file_id}",
        params={"alt": "media"},
        headers={
            "Authorization": f"Bearer {credentials.token}",
            "Range": "bytes=0-1023"
        },
        stream=True,
        timeout=30
    )

    print("HTTP:", response.status_code)
    print("Content-Type:", response.headers.get("Content-Type"))
    print("Content-Range:", response.headers.get("Content-Range"))

    if response.status_code == 206:
        print("✅ Download parcial de bytes funcionando!")
    elif response.status_code == 200:
        print("O servidor respondeu com 200; verificar suporte a Range.")
    else:
        print("Erro:", response.text[:500])

    response.close()


if __name__ == "__main__":
    main()
