"""Local recovery deployment; normal releases use the GitHub workflow."""
from pathlib import Path
import subprocess
root = Path(__file__).resolve().parents[1]
subprocess.run(['gcloud', 'run', 'deploy', 'keepalive', '--source=' + str(root),
                '--project=complete-silo', '--region=us-central1'], check=True)
