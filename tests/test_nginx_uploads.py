"""buffered uploads must survive nginx configuration checks."""

import http.client
import json
import os
import socket
import subprocess
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class UploadBackend(BaseHTTPRequestHandler):
    def do_POST(self):
        content = self.rfile.read(int(self.headers["Content-Length"]))
        body = json.dumps({"received": len(content)}).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class NginxUploadTests(unittest.TestCase):
    def test_uploads_survive_config_checks(self):
        with ThreadingHTTPServer(("127.0.0.1", 8000), UploadBackend) as backend:
            thread = threading.Thread(target=backend.serve_forever, daemon=True)
            thread.start()
            self.addCleanup(backend.shutdown)
            with tempfile.TemporaryFile(mode="w+") as log:
                command = ["nginx", "-g", "daemon off;"]
                if os.geteuid() == 0:
                    command = ["gosu", "tracefinity", *command]
                process = subprocess.Popen(command, stdout=log, stderr=log)
                try:
                    self.wait_for_nginx(process)
                    self.assert_uploads()
                    for _ in range(2):
                        subprocess.run(["nginx", "-t"], check=True, capture_output=True)
                        self.assert_uploads()
                finally:
                    process.terminate()
                    process.wait(timeout=5)
                    log.seek(0)
                    print(log.read(), end="")

    def wait_for_nginx(self, process):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            self.assertIsNone(process.poll(), "nginx exited before accepting uploads")
            try:
                with socket.create_connection(("127.0.0.1", 3000), timeout=0.1):
                    return
            except OSError:
                time.sleep(0.05)
        self.fail("nginx did not start within five seconds")

    def assert_uploads(self):
        for size in (1024, 65536, 1024 * 1024):
            with self.subTest(bytes=size):
                connection = http.client.HTTPConnection("127.0.0.1", 3000, timeout=5)
                try:
                    connection.request(
                        "POST", "/api/upload", body=b"x" * size,
                        headers={"Content-Type": "application/octet-stream"},
                    )
                    response = connection.getresponse()
                    body = response.read()
                    self.assertEqual(response.status, 200, body.decode(errors="replace"))
                    self.assertEqual(json.loads(body), {"received": size})
                finally:
                    connection.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
