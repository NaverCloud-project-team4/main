"""Build the code + requirements ZIP; never includes .env or credentials."""

from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
output = ROOT / "artifacts" / "verification-function.zip"
output.parent.mkdir(exist_ok=True)
modules = ("__init__.py", "config.py", "db.py", "models.py", "services.py", "foliage.py", "aggregate.py", "geography.py", "storage.py", "verifier.py", "jobs.py")
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    archive.write(ROOT / "cloud_function" / "__main__.py", "__main__.py")
    archive.write(ROOT / "cloud_function" / "requirements.txt", "requirements.txt")
    for name in modules:
        archive.write(ROOT / "backend" / "app" / name, f"app/{name}")
    for name in ("seoul_districts_20261001.geojson", "zones_seoul25.geojson", "README.md", "source.json", "LICENSE-DATA"):
        archive.write(ROOT / "backend/app/data" / name, f"app/data/{name}")
print(output)
