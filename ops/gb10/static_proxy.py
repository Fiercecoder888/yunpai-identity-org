"""Small stdlib-only frontend server for GB10.

It serves the built Vite application and proxies /api requests to the local
Yunpai API.  Keeping this dependency-free is intentional: GB10 has Python
but no Node runtime.
"""
from __future__ import annotations

import argparse
import http.client
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit


class Handler(SimpleHTTPRequestHandler):
    backend_host = "127.0.0.1"
    backend_port = 9000

    def _proxy(self) -> None:
        target = self.path[4:] or "/"
        if not target.startswith("/"):
            target = "/" + target
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length else None
        connection = http.client.HTTPConnection(self.backend_host, self.backend_port, timeout=120)
        headers = {
            key: value
            for key, value in self.headers.items()
            if key.lower() not in {"host", "content-length", "connection"}
        }
        if body is not None:
            headers["Content-Length"] = str(len(body))
        try:
            connection.request(self.command, target, body=body, headers=headers)
            response = connection.getresponse()
            self.send_response(response.status, response.reason)
            for key, value in response.getheaders():
                if key.lower() not in {"connection", "transfer-encoding", "content-length"}:
                    self.send_header(key, value)
            payload_length = response.getheader("Content-Length")
            if payload_length:
                self.send_header("Content-Length", payload_length)
            self.end_headers()
            while True:
                chunk = response.read(64 * 1024)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        except OSError as exc:
            self.send_error(502, f"backend unavailable: {exc}")
        finally:
            connection.close()

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/api" or self.path.startswith("/api/"):
            self._proxy()
            return
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        if self.path == "/api" or self.path.startswith("/api/"):
            self._proxy()
            return
        self.send_error(404)

    def log_message(self, format: str, *args: object) -> None:
        print("frontend", format % args, flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", default=os.environ.get("YUNPAI_FRONTEND_DIST", "frontend/dist"))
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=39092)
    parser.add_argument("--backend-port", type=int, default=9000)
    args = parser.parse_args()
    Handler.backend_port = args.backend_port
    os.chdir(args.directory)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"serving {os.getcwd()} on http://{args.host}:{args.port}, backend 127.0.0.1:{args.backend_port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
