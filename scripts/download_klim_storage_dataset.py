from __future__ import annotations

import argparse
import csv
import json
import shutil
import sys
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional


ROOT_DIR = Path(__file__).resolve().parents[1]
HTML_PATH = ROOT_DIR / "public" / "index.html"
EXPORTS_DIR = ROOT_DIR / "exports"
PREFIX = "Klim/"
BOGOTA_TZ = timezone(timedelta(hours=-5))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Descarga el dataset del bucket Klim y genera manifests en CSV/JSON."
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Descargar solo los primeros N archivos (util para pruebas).",
    )
    parser.add_argument(
        "--skip-download",
        action="store_true",
        help="Solo genera manifests, sin bajar las imagenes.",
    )
    parser.add_argument(
        "--output-dir",
        default=None,
        help="Directorio destino. Si no se indica, se crea uno dentro de exports/.",
    )
    return parser.parse_args()


def read_firebase_config() -> Dict[str, str]:
  html = HTML_PATH.read_text(encoding="utf-8")

  def extract(key: str) -> str:
      marker = f'{key}: "'
      start = html.find(marker)
      if start == -1:
          raise RuntimeError(f"No pude encontrar {key} en {HTML_PATH}")
      start += len(marker)
      end = html.find('"', start)
      return html[start:end]

  return {
      "project_id": extract("projectId"),
      "storage_bucket": extract("storageBucket"),
  }


def get_json(url: str) -> dict:
    with urllib.request.urlopen(url) as response:
        return json.loads(response.read().decode("utf-8"))


def list_storage_objects(storage_bucket: str) -> List[dict]:
    items: List[dict] = []
    page_token = ""

    while True:
        params = {"prefix": PREFIX}
        if page_token:
            params["pageToken"] = page_token

        url = (
            f"https://storage.googleapis.com/storage/v1/b/{storage_bucket}/o?"
            + urllib.parse.urlencode(params)
        )
        payload = get_json(url)

        for item in payload.get("items", []):
            if item.get("name") == PREFIX:
                continue
            items.append(item)

        page_token = payload.get("nextPageToken", "")
        if not page_token:
            break

    return items


def local_date_from_utc(iso_value: str) -> str:
    dt = datetime.fromisoformat(iso_value.replace("Z", "+00:00"))
    return dt.astimezone(BOGOTA_TZ).strftime("%Y-%m-%d")


def build_download_url(storage_bucket: str, object_name: str, token: str) -> str:
    quoted_name = urllib.parse.quote(object_name, safe="")
    quoted_token = urllib.parse.quote(token, safe="")
    return (
        f"https://firebasestorage.googleapis.com/v0/b/{storage_bucket}/o/"
        f"{quoted_name}?alt=media&token={quoted_token}"
    )


def normalize_objects(storage_bucket: str, objects: Iterable[dict]) -> List[dict]:
    rows: List[dict] = []
    for item in objects:
        token = item.get("metadata", {}).get("firebaseStorageDownloadTokens", "")
        row = {
            "name": item.get("name", ""),
            "filename": Path(item.get("name", "")).name,
            "size_bytes": int(item.get("size", 0)),
            "size_kb": round(int(item.get("size", 0)) / 1024, 2),
            "content_type": item.get("contentType", ""),
            "created_utc": item.get("timeCreated", ""),
            "created_local_date": local_date_from_utc(item.get("timeCreated", "")),
            "updated_utc": item.get("updated", ""),
            "generation": item.get("generation", ""),
            "download_token": token,
            "download_url": build_download_url(storage_bucket, item.get("name", ""), token)
            if token
            else "",
        }
        rows.append(row)

    rows.sort(key=lambda row: (row["created_utc"], row["filename"]))
    return rows


def create_output_dir(custom_dir: Optional[str]) -> Path:
    if custom_dir:
        output_dir = Path(custom_dir).expanduser().resolve()
    else:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_dir = EXPORTS_DIR / f"klim_storage_dataset_{stamp}"

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "images").mkdir(parents=True, exist_ok=True)
    return output_dir


def write_csv(path: Path, rows: List[dict], fieldnames: List[str]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def download_file(url: str, destination: Path) -> None:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0",
        },
    )
    with urllib.request.urlopen(request) as response, destination.open("wb") as handle:
        shutil.copyfileobj(response, handle)


def download_images(rows: List[dict], output_dir: Path, limit: Optional[int]) -> List[dict]:
    downloaded_rows: List[dict] = []
    target_rows = rows[:limit] if limit else rows
    total = len(target_rows)

    for index, row in enumerate(target_rows, start=1):
        local_path = output_dir / "images" / row["filename"]
        new_row = dict(row)
        new_row["local_path"] = str(local_path)
        new_row["download_status"] = "skipped"

        if not row["download_url"]:
            new_row["download_status"] = "missing_token"
            downloaded_rows.append(new_row)
            continue

        try:
            if not local_path.exists():
                download_file(row["download_url"], local_path)
            new_row["download_status"] = "downloaded"
        except Exception as exc:  # noqa: BLE001
            new_row["download_status"] = f"error: {exc}"

        downloaded_rows.append(new_row)

        if index == 1 or index % 50 == 0 or index == total:
            print(f"[download] {index}/{total} -> {new_row['filename']} ({new_row['download_status']})")

    return downloaded_rows


def build_daily_summary(rows: List[dict]) -> List[dict]:
    counts = Counter(row["created_local_date"] for row in rows)
    sizes = Counter()
    for row in rows:
        sizes[row["created_local_date"]] += row["size_kb"]

    summary_rows = []
    for date in sorted(counts):
        summary_rows.append(
            {
                "date": date,
                "image_count": counts[date],
                "total_size_kb": round(sizes[date], 2),
            }
        )
    return summary_rows


def write_summary_json(
    path: Path,
    config: Dict[str, str],
    all_rows: List[dict],
    downloaded_rows: List[dict],
    daily_summary: List[dict],
) -> None:
    payload = {
        "project_id": config["project_id"],
        "storage_bucket": config["storage_bucket"],
        "prefix": PREFIX,
        "total_listed_files": len(all_rows),
        "downloaded_manifest_rows": len(downloaded_rows),
        "total_size_kb": round(sum(row["size_kb"] for row in all_rows), 2),
        "first_day": daily_summary[0]["date"] if daily_summary else "",
        "last_day": daily_summary[-1]["date"] if daily_summary else "",
        "top_days": sorted(daily_summary, key=lambda row: row["image_count"], reverse=True)[:10],
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def main() -> int:
    args = parse_args()
    config = read_firebase_config()
    output_dir = create_output_dir(args.output_dir)

    print("[info] Listando objetos del bucket...")
    objects = list_storage_objects(config["storage_bucket"])
    rows = normalize_objects(config["storage_bucket"], objects)
    print(f"[info] Objetos encontrados: {len(rows)}")

    daily_summary = build_daily_summary(rows)

    listed_manifest_path = output_dir / "manifest_all.csv"
    daily_summary_path = output_dir / "daily_summary.csv"
    summary_json_path = output_dir / "summary.json"

    listed_fields = [
        "name",
        "filename",
        "size_bytes",
        "size_kb",
        "content_type",
        "created_utc",
        "created_local_date",
        "updated_utc",
        "generation",
        "download_token",
        "download_url",
    ]
    write_csv(listed_manifest_path, rows, listed_fields)
    write_csv(daily_summary_path, daily_summary, ["date", "image_count", "total_size_kb"])

    if args.skip_download:
        downloaded_rows = [
            {**row, "local_path": "", "download_status": "not_requested"}
            for row in (rows[: args.limit] if args.limit else rows)
        ]
    else:
        print("[info] Descargando imagenes...")
        downloaded_rows = download_images(rows, output_dir, args.limit)

    downloaded_manifest_path = output_dir / "manifest_downloaded.csv"
    downloaded_fields = listed_fields + ["local_path", "download_status"]
    write_csv(downloaded_manifest_path, downloaded_rows, downloaded_fields)
    write_summary_json(summary_json_path, config, rows, downloaded_rows, daily_summary)

    print("")
    print("[done] Dataset preparado")
    print(f"[done] Carpeta: {output_dir}")
    print(f"[done] Manifest total: {listed_manifest_path}")
    print(f"[done] Manifest descarga: {downloaded_manifest_path}")
    print(f"[done] Resumen diario: {daily_summary_path}")
    print(f"[done] Resumen JSON: {summary_json_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
