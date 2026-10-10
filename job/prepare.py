"""Stage an allowlisted build context. Credentials never enter the build."""
import hashlib
from pathlib import Path
import shutil
import sys

root = Path(__file__).resolve().parents[1]
vendor, target = map(Path, sys.argv[1:])
if target.exists():
    raise SystemExit('Build directory must not already exist')
digests = {
    'db2jcc4.jar': 'b19afdd4eb354c933f39bfbe239b21f1a132aa9113d885db73dc573495523dba',
    'db2-ca.pem': '39fdcf28aeffe08d03251fccaf645e3c5de19fa4ebbafc89b4ede2a422148bab',
}
for name, expected in digests.items():
    if hashlib.sha256((vendor / name).read_bytes()).hexdigest() != expected:
        raise SystemExit('Unverified dependency: ' + name)
target.mkdir(parents=True)
shutil.copytree(root / 'src', target / 'src')
for directory in ['job/vendor', 'bridge']:
    (target / directory).mkdir(parents=True)
for name in ['run.mjs', 'db2_checkin.py']:
    shutil.copy2(root / 'job' / name, target / 'job' / name)
for name in ['db.py', 'requirements.txt']:
    shutil.copy2(root / 'bridge' / name, target / 'bridge' / name)
for name in digests:
    shutil.copy2(vendor / name, target / 'job/vendor' / name)
shutil.copy2(root / 'job/Dockerfile', target / 'Dockerfile')
shutil.copy2(root / 'package.json', target / 'package.json')
print('Prepared credential-free build context:', target)
