"""Read-only post-deployment checks. Never receive production credentials."""
import concurrent.futures
import json
import sys
import urllib.error
import urllib.request

base = sys.argv[1].rstrip('/')

def request(path, method='GET'):
    try:
        response = urllib.request.urlopen(urllib.request.Request(base + path, method=method), timeout=120)
        return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()

def read_service(service):
    code, body = request('/api/data?service=' + service)
    assert code == 200 and json.loads(body).get('ok') is True, 'Database read failed: ' + service
    return service + ': healthy'

code, body = request('/')
assert code == 200 and b'<html' in body.lower(), 'Dashboard unavailable'
for path in ['/trigger', '/admin/clean?action=delete', '/internal/checkin']:
    assert request(path, 'POST')[0] == 401, 'Administrative authorization failed'
assert request('/debug')[0] == 401, 'Diagnostics must require authentication'
with concurrent.futures.ThreadPoolExecutor() as executor:
    for result in executor.map(read_service, ['supabase', 'adb_us', 'adb_jp', 'db2', 'mysql_jp']):
        print(result)
print('Dashboard and authentication: healthy')
