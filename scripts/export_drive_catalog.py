import json
import csv
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
source = ROOT / "dados/drive_tree.json"

tree = json.loads(source.read_text(encoding="utf-8"))
catalog = []

def traverse(node, path=""):
    current_path = f"{path}/{node['name']}" if path else node["name"]

    if node["type"] == "folder":
        for child in node.get("children", []):
            traverse(child, current_path)
        return

    file_id = node["id"]
    mime_type = node.get("mimeType", "")
    name = node["name"]

    if name.lower().endswith(".part"):
        category = "incompleto"
    elif mime_type.startswith("video/"):
        category = "video"
    elif mime_type == "application/pdf":
        category = "pdf"
    elif mime_type.startswith("image/"):
        category = "imagem"
    else:
        category = "outro"

    catalog.append({
        "id": file_id,
        "nome": name,
        "caminho": current_path,
        "categoria": category,
        "mimeType": mime_type,
        "tamanho": node.get("size", 0),
        "drive_url": node.get("url") or (
            f"https://drive.google.com/file/d/{file_id}/view"
        )
    })

traverse(tree)

output = ROOT / "dados"

(output / "drive_catalog.json").write_text(
    json.dumps(catalog, indent=2, ensure_ascii=False),
    encoding="utf-8"
)

with (output / "drive_catalog.csv").open(
    "w", encoding="utf-8", newline=""
) as file:
    writer = csv.DictWriter(file, fieldnames=[
        "id", "nome", "caminho", "categoria",
        "mimeType", "tamanho", "drive_url"
    ])
    writer.writeheader()
    writer.writerows(catalog)

from collections import Counter
counts = Counter(item["categoria"] for item in catalog)

print(f"Total exportado: {len(catalog)} arquivos")
for category, count in sorted(counts.items()):
    print(f"  {category}: {count}")

print("Gerados: dados/drive_catalog.json e drive_catalog.csv")
