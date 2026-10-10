"""Private stdio RPC for native drivers; no listening port or remote bridge."""
import json
import sys

from native.db2 import Db2
from native.mysql import MySQL

drivers = {}
for line in sys.stdin:
    request = {}
    try:
        request = json.loads(line)
        service = request['service']
        if service not in drivers:
            drivers[service] = {'db2': Db2, 'mysql_jp': MySQL}[service]()
        driver = drivers[service]
        if request['operation'] == 'query':
            result = driver.query(request['page'], request['limit'])
        elif request['operation'] == 'ping':
            result = driver.checkin(request['request_id'], request['geo'])
        else:
            raise ValueError('unsupported_operation')
    except Exception:
        result = {'ok': False, 'error': 'database_error'}
    print(json.dumps({'id': request.get('id'), 'result': result}), flush=True)
