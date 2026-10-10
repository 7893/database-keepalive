"""Build/deploy from an explicit private vendor directory, preserving live env."""
from pathlib import Path
import subprocess
import sys
import tempfile

if len(sys.argv) != 2:
    raise SystemExit('Usage: npm run deploy -- /private/vendor-directory (see service/README.md)')
root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='keepalive-build-') as directory:
    target = Path(directory) / 'source'
    subprocess.run([sys.executable, str(root / 'service/prepare.py'), sys.argv[1], str(target)], check=True)
    # Subsequent image deployments preserve environment variables and IAM policy.
    subprocess.run(['gcloud', 'run', 'deploy', 'keepalive', '--source=' + str(target),
                    '--project=complete-silo', '--region=us-central1'], check=True)
