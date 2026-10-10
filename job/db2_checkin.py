"""One-shot Db2 client; reuses the bridge's transaction and read-back logic."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'bridge'))
from db import Db2

try:
    request = json.load(sys.stdin)
    result = Db2().checkin(request['request_id'], request['geo'])
    print(json.dumps({'committed': result['committed']}))
except Exception:
    print(json.dumps({'committed': False}))
    sys.exit(1)
