"""Serve Photo Album Curator's browser build on this computer."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from socketserver import TCPServer
import webbrowser


class LocalServer(ThreadingHTTPServer):
    def server_bind(self):
        TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address


class AppFiles(SimpleHTTPRequestHandler):
    def send_head(self):
        if self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}":
            self.send_error(403)
            return None
        root = Path(self.directory)
        path = Path(self.translate_path(self.path))
        if path.is_dir():
            path /= "index.html"
        if not path.resolve().is_relative_to(root) or not path.is_file():
            self.send_error(404)
            return None
        return super().send_head()

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    site = Path(__file__).resolve().parent / "dist"
    if not (site / "index.html").is_file():
        parser.exit(1, "App files are missing. Extract the desktop release ZIP, or run python3 web/build.py from a source checkout.\n")

    try:
        with LocalServer(("127.0.0.1", args.port), partial(AppFiles, directory=site)) as server:
            url = f"http://127.0.0.1:{server.server_port}/"
            print(f"Photo Album Curator is ready at {url}", flush=True)
            if not args.no_browser:
                print("Open the address in Chrome or Microsoft Edge.", flush=True)
                webbrowser.open(url)
            server.serve_forever()
    except KeyboardInterrupt:
        pass
    except OSError as error:
        parser.exit(1, f"Could not start Photo Album Curator. {error}\n")


if __name__ == "__main__":
    main()
