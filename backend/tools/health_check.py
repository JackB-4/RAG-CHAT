import json, sys
import urllib.request

try:
    with urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3) as r:
        sys.stdout.write(r.read().decode())
except Exception as e:
    sys.stdout.write(json.dumps({"status":"error","message":str(e)}))
