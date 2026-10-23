"""Build the code + requirements ZIP; never includes .env or credentials."""

from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
output = ROOT / "artifacts" / "verification-function.zip"
output.parent.mkdir(exist_ok=True)
modules = ("__init__.py", "config.py", "db.py", "models.py", "services.py", "storage.py", "verifier.py", "jobs.py")
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    archive.write(ROOT / "cloud_function" / "__main__.py", "__main__.py")
    archive.write(ROOT / "cloud_function" / "requirements.txt", "requirements.txt")
    for name in modules:
        archive.write(ROOT / "backend" / "app" / name, f"app/{name}")
print(output)
