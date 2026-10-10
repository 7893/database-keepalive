"""Stage only application code and verified public dependencies."""
from pathlib import Path
import subprocess
import shutil
import sys
root = Path(__file__).resolve().parents[1]
vendor, target = map(Path, sys.argv[1:])
subprocess.run([sys.executable, str(root / 'job/prepare.py'), str(vendor), str(target)], check=True)
(target / 'service').mkdir()
for source in (root / 'service').glob('*.mjs'):
    if not source.name.endswith('test.mjs'):
        shutil.copy2(source, target / 'service' / source.name)
shutil.copy2(root / 'service/native.py', target / 'service/native.py')
for name in ['mysql_db.py', 'requirements-mysql.txt']:
    shutil.copy2(root / 'bridge' / name, target / 'bridge' / name)
shutil.copy2(root / 'service/Dockerfile', target / 'Dockerfile')
