"""Exercise the packaged transport without opening database connections."""
import json
import subprocess
import sys
import unittest
from pathlib import Path


class TransportTests(unittest.TestCase):
    def test_module_starts_and_returns_sanitized_errors_without_driver_dependencies(self):
        payload = 'invalid-json\n' + json.dumps({
            'id': 17, 'service': 'unknown', 'operation': 'query',
        }) + '\n'
        result = subprocess.run(
            [sys.executable, '-B', '-m', 'native.rpc'], input=payload,
            capture_output=True, text=True, timeout=10,
            cwd=Path(__file__).resolve().parents[2], check=True,
        )
        replies = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual([r['id'] for r in replies], [None, 17])
        self.assertTrue(all(r['result'] == {'ok': False, 'error': 'database_error'}
                            for r in replies))
        self.assertEqual(result.stderr, '')
