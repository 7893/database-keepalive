"""Download public JDBC/CA dependencies; reject unexpected content."""
import hashlib
from pathlib import Path
import sys
import urllib.request

DEPENDENCIES = {
    'db2jcc4.jar': (
        'https://repo.maven.apache.org/maven2/com/ibm/db2/jcc/12.1.2.0/jcc-12.1.2.0.jar',
        'b19afdd4eb354c933f39bfbe239b21f1a132aa9113d885db73dc573495523dba'),
    'db2-ca.pem': (
        'https://cacerts.digicert.com/DigiCertGlobalRootCA.crt.pem',
        '39fdcf28aeffe08d03251fccaf645e3c5de19fa4ebbafc89b4ede2a422148bab'),
}

def download(target):
    target.mkdir(parents=True, exist_ok=True)
    for name, (url, expected) in DEPENDENCIES.items():
        data = urllib.request.urlopen(url, timeout=60).read()
        if hashlib.sha256(data).hexdigest() != expected:
            raise ValueError('Unverified public dependency: ' + name)
        (target / name).write_bytes(data)

if __name__ == '__main__':
    download(Path(sys.argv[1]))
