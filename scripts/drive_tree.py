
import json
import sys
from pathlib import Path
from urllib.parse import urlparse, parse_qs

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

ROOT = Path(__file__).resolve().parent.parent
SCOPES = [
    "https://www.googleapis.com/auth/drive.readonly"
]
FOLDER_MIME = "application/vnd.google-apps.folder"


def authenticate():
    token_path = ROOT / "token.json"
    credentials_path = ROOT / "credentials.json"
    creds = None

    if token_path.exists():
        creds = Credentials.from_authorized_user_file(
            str(token_path), SCOPES
        )

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(
                str(credentials_path), SCOPES
            )
            creds = flow.run_local_server(port=0)

        token_path.write_text(creds.to_json())
        token_path.chmod(0o600)

    return build("drive", "v3", credentials=creds)


def get_folder_id(value):
    parsed = urlparse(value)

    if "/folders/" in parsed.path:
        return parsed.path.split("/folders/")[1].split("/")[0]

    query_id = parse_qs(parsed.query).get("id")
    if query_id:
        return query_id[0]

    return value


def get_children(service, folder_id):
    files = []
    page_token = None

    while True:
        response = service.files().list(
            q=f"'{folder_id}' in parents and trashed = false",
            pageSize=1000,
            pageToken=page_token,
            fields=(
                "nextPageToken,"
                "files(id,name,mimeType,size,webViewLink)"
            ),
            orderBy="folder,name_natural",
            supportsAllDrives=True,
            includeItemsFromAllDrives=True
        ).execute()

        files.extend(response.get("files", []))
        page_token = response.get("nextPageToken")

        if not page_token:
            break

    return files


def scan_folder(service, folder_id, name):
    node = {
        "id": folder_id,
        "name": name,
        "type": "folder",
        "children": []
    }

    children = get_children(service, folder_id)

    for item in children:
        if item["mimeType"] == FOLDER_MIME:
            child = scan_folder(
                service, item["id"], item["name"]
            )
        else:
            child = {
                "id": item["id"],
                "name": item["name"],
                "type": "file",
                "mimeType": item["mimeType"],
                "size": int(item.get("size", 0)),
                "url": item.get("webViewLink")
            }

        node["children"].append(child)

    return node


def render_tree(node, prefix=""):
    lines = []
    children = node["children"]

    for index, child in enumerate(children):
        last = index == len(children) - 1
        branch = "└── " if last else "├── "
        suffix = "/" if child["type"] == "folder" else ""

        lines.append(prefix + branch + child["name"] + suffix)

        if child["type"] == "folder":
            extension = "    " if last else "│   "
            lines.extend(
                render_tree(child, prefix + extension)
            )

    return lines


def count_items(node):
    folders = 0
    files = 0

    for child in node["children"]:
        if child["type"] == "folder":
            folders += 1
            subfolders, subfiles = count_items(child)
            folders += subfolders
            files += subfiles
        else:
            files += 1

    return folders, files


def main():
    if len(sys.argv) < 2:
        print("Uso: python scripts/drive_tree.py URL_DA_PASTA")
        sys.exit(1)

    folder_id = get_folder_id(sys.argv[1])

    print("Autenticando no Google Drive...")
    service = authenticate()

    root = service.files().get(
        fileId=folder_id,
        fields="id,name,mimeType",
        supportsAllDrives=True
    ).execute()

    if root["mimeType"] != FOLDER_MIME:
        raise ValueError("O ID informado não corresponde a uma pasta")

    print(f"Mapeando: {root['name']}")
    tree_data = scan_folder(service, root["id"], root["name"])

    folders, files = count_items(tree_data)

    visual = tree_data["name"] + "/\n"
    visual += "\n".join(render_tree(tree_data))
    visual += f"\n\n{folders} diretórios, {files} arquivos\n"

    output_dir = ROOT / "dados"
    output_dir.mkdir(exist_ok=True)

    (output_dir / "drive_tree.txt").write_text(
        visual, encoding="utf-8"
    )
    (output_dir / "drive_tree.json").write_text(
        json.dumps(tree_data, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    print(visual)
    print("Arquivos salvos em dados/")


if __name__ == "__main__":
    main()
