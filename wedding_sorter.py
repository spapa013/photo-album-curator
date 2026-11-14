"""Local wedding photo sorter. Run with Python 3.10 or newer."""

import argparse
from contextlib import contextmanager
from datetime import datetime
from hashlib import sha256
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
from socketserver import TCPServer
import sqlite3
from tempfile import TemporaryDirectory
import unicodedata
from urllib.parse import parse_qs, urlsplit
import webbrowser
from zipfile import BadZipFile, ZipFile

from photo_dates import capture_time


HERE = Path(__file__).resolve().parent
FORMATS = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".jfif": "image/jpeg",
    ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
    ".bmp": "image/bmp", ".avif": "image/avif",
}
SHARED = ""
DATABASE_NAME = "Wedding Sorter.sqlite3"
MAX_PRINTED = 2**53 - 1
STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
    "/final": ("final.html", "text/html; charset=utf-8"),
    "/final.js": ("final.js", "text/javascript; charset=utf-8"),
}


class RequestError(ValueError):
    pass


class StaleReview(RequestError):
    pass


def supported(path):
    return path.suffix.lower() in FORMATS


def plain_path(path):
    if path.is_symlink() or path.resolve() != path:
        raise RequestError(f"Move this link out of the sorter's folders: {path}")
    return path


def folder_safe(name):
    reserved = re.fullmatch(r"(?i:CON|PRN|AUX|NUL|(?:COM|LPT)[1-9¹²³])",
                            name.split(".")[0].rstrip())
    return bool(name and not name.endswith((".", " ")) and not reserved
                and not any(char in '<>:"/\\|?*' or ord(char) < 32 for char in name))


def guest_name(value):
    if not isinstance(value, str):
        raise RequestError("Enter a guest name.")
    name = unicodedata.normalize("NFC", value.strip())
    if len(name) > 80 or not folder_safe(name):
        raise RequestError("Enter a folder-safe guest name of up to 80 characters.")
    return name


class Store:
    def __init__(self, workspace, zip_keys):
        self.path = plain_path(workspace / DATABASE_NAME)
        with self.database(write=True) as db:
            version, = db.execute("PRAGMA user_version").fetchone()
            if version == 0:
                self.initialize(db)
                self.import_legacy(db, workspace / "Sorted", zip_keys)
            if version in (0, 1):
                db.execute("""CREATE TABLE final_choices (
                    destination INTEGER NOT NULL REFERENCES destinations(id),
                    album TEXT NOT NULL,
                    photo TEXT NOT NULL,
                    included INTEGER CHECK (included IN (0, 1)),
                    position INTEGER CHECK (position > 0),
                    PRIMARY KEY (destination, album, photo),
                    FOREIGN KEY (album, photo) REFERENCES reviews(album, photo)
                )""")
                db.execute("PRAGMA user_version = 2")
            elif version != 2:
                raise RequestError("This database requires a newer Wedding Photo Sorter.")

    @contextmanager
    def database(self, write=False):
        db = sqlite3.connect(plain_path(self.path), timeout=15)
        try:
            db.execute("PRAGMA foreign_keys = ON")
            with db:
                db.execute("BEGIN IMMEDIATE" if write else "BEGIN")
                yield db
        finally:
            db.close()

    @staticmethod
    def initialize(db):
        db.execute("""CREATE TABLE source_albums (
            key TEXT PRIMARY KEY NOT NULL,
            resume TEXT,
            revision INTEGER NOT NULL DEFAULT 0
        )""")
        db.execute("""CREATE TABLE destinations (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            folded TEXT NOT NULL UNIQUE
        )""")
        db.execute("""CREATE TABLE reviews (
            album TEXT NOT NULL REFERENCES source_albums(key),
            photo TEXT NOT NULL,
            PRIMARY KEY (album, photo)
        )""")
        db.execute("""CREATE TABLE assignments (
            album TEXT NOT NULL,
            photo TEXT NOT NULL,
            destination INTEGER NOT NULL REFERENCES destinations(id),
            PRIMARY KEY (album, photo, destination),
            FOREIGN KEY (album, photo) REFERENCES reviews(album, photo)
        )""")
        db.execute("CREATE INDEX assignments_by_destination ON assignments(destination, album, photo)")
        db.execute("""CREATE TABLE print_counts (
            album TEXT NOT NULL REFERENCES source_albums(key),
            photo TEXT NOT NULL,
            printed INTEGER NOT NULL CHECK (printed >= 0),
            PRIMARY KEY (album, photo)
        )""")
        db.execute("INSERT INTO destinations VALUES (0, ?, ?)", (SHARED, SHARED))

    @staticmethod
    def import_legacy(db, sorted_root, zip_keys):
        if not sorted_root.is_dir():
            return
        for path in sorted(plain_path(sorted_root).glob("*/.sorter.sqlite3")):
            folder = path.parent.name
            if folder == "Loose photos":
                key = ""
            elif folder.startswith("Album - "):
                key = folder.removeprefix("Album - ")
            elif folder.startswith("ZIP - "):
                stem = folder.removeprefix("ZIP - ")
                key = zip_keys.get(stem, f"{stem}.zip")
            else:
                raise RequestError(f"Cannot identify the source album for {path}.")

            legacy = sqlite3.connect(plain_path(path).as_uri() + "?mode=ro", uri=True, timeout=15)
            try:
                legacy.execute("BEGIN")
                resume, revision = legacy.execute("SELECT resume, revision FROM progress").fetchone()
                db.execute("INSERT INTO source_albums VALUES (?, ?, ?)", (key, resume, revision))
                for name, in legacy.execute("SELECT name FROM guests"):
                    db.execute("""INSERT INTO destinations(name, folded) VALUES (?, ?)
                                  ON CONFLICT(folded) DO NOTHING""", (name, name.casefold()))
                destination_ids = dict(db.execute("SELECT folded, id FROM destinations"))
                for photo, wanted in legacy.execute("SELECT photo, wanted FROM reviews"):
                    db.execute("INSERT INTO reviews VALUES (?, ?)", (key, photo))
                    db.executemany("INSERT INTO assignments VALUES (?, ?, ?)",
                                   ((key, photo, destination_ids[name.casefold()])
                                    for name in json.loads(wanted)))
                if legacy.execute("""SELECT 1 FROM sqlite_master
                                     WHERE type = 'table' AND name = 'print_counts'""").fetchone():
                    db.executemany("INSERT INTO print_counts VALUES (?, ?, ?)",
                                   ((key, photo, printed) for photo, printed in
                                    legacy.execute("SELECT photo, printed FROM print_counts")))
            finally:
                legacy.close()


class Album:
    def __init__(self, source, key, store):
        self.source = source
        self.key = key
        self.store = store
        self.photos = {}
        self.is_zip = source.is_file()
        self.archive_names = {}

    def scan(self, recursive):
        photos = {}
        if self.is_zip:
            with ZipFile(self.source) as archive:
                members = [member for member in archive.infolist()
                           if not member.is_dir() and supported(PurePosixPath(member.filename))]
                roots = {member.filename.split("/", 1)[0] for member in members}
                wrapper = next(iter(roots)) + "/" if len(roots) == 1 else ""
                if any(not member.filename.startswith(wrapper) for member in members):
                    wrapper = ""
                seen = set()
                for member in members:
                    if not all(folder_safe(part) for part in member.filename.split("/")):
                        raise RequestError(f"The ZIP contains an unsafe photo path: {member.filename}")
                    name = member.filename.removeprefix(wrapper)
                    folded = unicodedata.normalize("NFC", name).casefold()
                    if folded in seen:
                        raise RequestError(f"The ZIP contains duplicate photo paths: {name}")
                    seen.add(folded)
                    self.archive_names[name] = member.filename
                    with archive.open(member) as file:
                        photos[name] = capture_time(file)
        else:
            photos = self.scan_directory(recursive)
        self.photos = dict(sorted(photos.items(), key=lambda item: (
            item[1] is None, item[1] or datetime.max,
            PurePosixPath(item[0]).name.casefold(), item[0].casefold(), item[0],
        )))

    def scan_directory(self, recursive):
        photos = {}
        for directory, subdirs, files in os.walk(self.source):
            if recursive:
                subdirs[:] = [name for name in subdirs
                              if (Path(directory) / name).resolve() == Path(directory) / name]
            else:
                subdirs.clear()
            for name in files:
                path = Path(directory) / name
                if supported(path) and path.resolve() == path and path.is_file():
                    with path.open("rb") as file:
                        photos[path.relative_to(self.source).as_posix()] = capture_time(file)
        return photos

    def check_photo(self, photo):
        if not isinstance(photo, str) or photo not in self.photos:
            raise RequestError("This photo is no longer in the open album. Reload the album.")

    @contextmanager
    def open_photo(self, photo):
        self.check_photo(photo)
        if self.is_zip:
            with ZipFile(plain_path(self.source)) as archive:
                try:
                    member = archive.getinfo(self.archive_names[photo])
                except KeyError:
                    raise FileNotFoundError(photo) from None
                with archive.open(member) as file:
                    yield file, member.file_size
        else:
            with plain_path(self.source / photo).open("rb") as file:
                yield file, os.fstat(file.fileno()).st_size

    def add_guest(self, value):
        name = guest_name(value)
        with self.store.database(write=True) as db:
            if db.execute("SELECT 1 FROM destinations WHERE folded = ?", (name.casefold(),)).fetchone():
                raise RequestError("A guest with that name already exists.")
            db.execute("INSERT INTO destinations(name, folded) VALUES (?, ?)", (name, name.casefold()))
        return name

    def check_revision(self, db, revision):
        current_revision, = db.execute("SELECT revision FROM source_albums WHERE key = ?",
                                       (self.key,)).fetchone()
        if type(revision) is not int or revision != current_revision:
            raise StaleReview("This album changed in another tab. Reload it to continue.")

    def write_print_count(self, db, photo, printed):
        if type(printed) is not int or not 0 <= printed <= MAX_PRINTED:
            raise RequestError("Enter a nonnegative whole number for copies already printed.")
        if printed == 0:
            db.execute("DELETE FROM print_counts WHERE album = ? AND photo = ?", (self.key, photo))
        else:
            db.execute("""
                INSERT INTO print_counts VALUES (?, ?, ?)
                ON CONFLICT(album, photo) DO UPDATE SET printed = excluded.printed
            """, (self.key, photo, printed))

    def save_print_count(self, photo, printed, revision):
        self.check_photo(photo)
        with self.store.database(write=True) as db:
            self.check_revision(db, revision)
            self.write_print_count(db, photo, printed)
            db.execute("UPDATE source_albums SET revision = revision + 1 WHERE key = ?", (self.key,))
        return revision + 1

    def save(self, photo, wanted, advance, revision, printed=None):
        self.check_photo(photo)
        with self.store.database(write=True) as db:
            self.check_revision(db, revision)
            if printed is not None:
                self.write_print_count(db, photo, printed)
            choices = dict(db.execute("SELECT name, id FROM destinations"))
            if (not isinstance(wanted, list)
                    or any(not isinstance(name, str) or name not in choices
                           for name in wanted)):
                raise RequestError("Choose destinations from the guest albums or Shared album.")
            db.execute("INSERT OR IGNORE INTO reviews VALUES (?, ?)", (self.key, photo))
            db.execute("DELETE FROM assignments WHERE album = ? AND photo = ?", (self.key, photo))
            db.executemany("INSERT INTO assignments VALUES (?, ?, ?)",
                           ((self.key, photo, choices[name]) for name in set(wanted)))
            photos = list(self.photos)
            index = photos.index(photo)
            resume = photos[index + 1] if advance and index + 1 < len(photos) else photo
            db.execute("UPDATE source_albums SET resume = ?, revision = revision + 1 WHERE key = ?",
                       (resume, self.key))
        return resume

    def state(self, include_photos=False):
        with self.store.database() as db:
            resume, revision = db.execute("SELECT resume, revision FROM source_albums WHERE key = ?",
                                          (self.key,)).fetchone()
            guests = [name for name, in db.execute(
                "SELECT name FROM destinations WHERE id != 0 ORDER BY folded")]
            reviews = {photo: [] for photo, in db.execute(
                "SELECT photo FROM reviews WHERE album = ?", (self.key,)) if photo in self.photos}
            for photo, name in db.execute("""
                SELECT photo, name FROM assignments
                JOIN destinations ON destinations.id = assignments.destination
                WHERE album = ? ORDER BY name
            """, (self.key,)):
                if photo in reviews:
                    reviews[photo].append(name)
            printed = {photo: count for photo, count in db.execute(
                "SELECT photo, printed FROM print_counts WHERE album = ?", (self.key,))
                if photo in self.photos}
        state = dict(resume=resume, revision=revision, guests=guests, reviews=reviews,
                     printed=printed, storage="central")
        if include_photos:
            state["photos"] = [{"path": path, "date": date.isoformat(timespec="seconds") if date else None}
                               for path, date in self.photos.items()]
        return state


class Sorter:
    def __init__(self, workspace):
        self.albums = plain_path(workspace / "Albums")
        self.albums.mkdir(exist_ok=True)
        zip_keys = {path.stem: path.name for path in self.albums.iterdir()
                    if path.is_file() and path.suffix.lower() == ".zip"}
        self.store = Store(workspace, zip_keys)
        self.opened = {}
        self.final = FinalAlbums(self, workspace / "Final Albums")

    def choices(self):
        entries = sorted(self.albums.iterdir(), key=lambda path: path.name.casefold())
        choices = [{"id": path.name, "label": path.name} for path in entries
                   if path.resolve() == path and
                   (path.is_dir() or (path.is_file() and path.suffix.lower() == ".zip"))]
        if not choices or any(path.is_file() and supported(path) for path in entries):
            choices.insert(0, {"id": "", "label": "Photos directly in Albums"})
        return choices

    def scan_album(self, key):
        if not any(key == choice["id"] for choice in self.choices()):
            raise RequestError("Choose a folder from Albums.")
        source = plain_path(self.albums / key)
        album = Album(source, key, self.store)
        album.scan(recursive=bool(key))
        self.opened[key] = album
        return album

    def open(self, key):
        album = self.scan_album(key)
        with self.store.database(write=True) as db:
            db.execute("INSERT OR IGNORE INTO source_albums(key) VALUES (?)", (key,))
        return dict(album.state(include_photos=True), final_albums=True)

    def album(self, key):
        if not isinstance(key, str) or key not in self.opened:
            raise RequestError("Open the album first.")
        return self.opened[key]


class FinalAlbums:
    def __init__(self, sorter, output):
        self.sorter = sorter
        self.store = sorter.store
        self.output = output

    def guests(self):
        with self.store.database() as db:
            return [dict(id=guest, name=name) for guest, name in db.execute(
                "SELECT id, name FROM destinations WHERE id != 0 ORDER BY folded")]

    @staticmethod
    def snapshot(db, guest):
        if type(guest) is not int or not 0 < guest <= 2**53 - 1:
            raise RequestError("Choose a guest album.")
        result = db.execute("SELECT name FROM destinations WHERE id = ?", (guest,)).fetchone()
        if result is None:
            raise RequestError("Choose a guest album.")
        rows = db.execute("""
            WITH eligible AS (
                SELECT album, photo, MAX(destination = ?) AS assigned, MAX(destination = 0) AS shared
                FROM assignments WHERE destination IN (0, ?) GROUP BY album, photo
            )
            SELECT e.album, e.photo, e.assigned, e.shared, COALESCE(c.included, e.assigned), c.position
            FROM eligible e LEFT JOIN final_choices c
              ON c.destination = ? AND c.album = e.album AND c.photo = e.photo
            ORDER BY e.album, e.photo
        """, (guest, guest, guest)).fetchall()
        token = sha256(json.dumps([guest, rows]).encode()).hexdigest()
        return result[0], rows, token

    @staticmethod
    def require_current(token, current):
        if token != current:
            raise StaleReview("Assignments or album choices changed. Reload this final album and try again.")

    def plan(self, guest, refresh=False):
        with self.store.database() as db:
            name, rows, token = self.snapshot(db, guest)
        sources = {}
        for key in {row[0] for row in rows}:
            try:
                sources[key] = (None if refresh else self.sorter.opened.get(key)) or self.sorter.scan_album(key)
            except (OSError, RequestError, BadZipFile, RuntimeError):
                sources[key] = None
        photos = []
        for album, photo, assigned, shared, included, position in rows:
            source = sources[album]
            available = source is not None and photo in source.photos
            date = source.photos[photo] if available else None
            photos.append(dict(album=album, path=photo, assigned=bool(assigned), shared=bool(shared),
                               included=bool(included), rank=position if included else None,
                               available=available, date=date.isoformat(timespec="seconds") if date else None))
        photos.sort(key=lambda photo: (
            not photo["included"], photo["rank"] is None, photo["rank"] or 0,
            photo["date"] is None, photo["date"] or "",
            PurePosixPath(photo["path"]).name.casefold(), photo["album"].casefold(), photo["path"],
            photo["album"],
        ))
        rank = 0
        for photo in photos:
            if photo["rank"] is not None:
                rank += 1
                photo["rank"] = rank
        return dict(guest=guest, name=name, token=token, photos=photos), sources

    def edit(self, guest, data):
        key = (data.get("album"), data.get("photo"))
        action = data.get("action")
        with self.store.database(write=True) as db:
            _, rows, token = self.snapshot(db, guest)
            self.require_current(data.get("token"), token)
            row = next((row for row in rows if row[:2] == key), None)
            if row is None:
                raise RequestError("This photo is no longer available for this guest.")
            if action == "include" and type(data.get("included")) is bool:
                db.execute("""
                    INSERT INTO final_choices(destination, album, photo, included) VALUES (?, ?, ?, ?)
                    ON CONFLICT(destination, album, photo) DO UPDATE SET included = excluded.included
                """, (guest, *key, data["included"]))
            elif action == "unrank":
                db.execute("UPDATE final_choices SET position = NULL WHERE destination = ? AND album = ? AND photo = ?",
                           (guest, *key))
            elif action == "rank" and row[4]:
                self.rank(db, guest, rows, key, data.get("position"))
            else:
                raise RequestError("Choose a valid album action.")
            db.execute("DELETE FROM final_choices WHERE destination = ? AND included IS NULL AND position IS NULL",
                       (guest,))
        return self.plan(guest)[0]

    @staticmethod
    def rank(db, guest, rows, key, position):
        ordered = db.execute("""SELECT album, photo FROM final_choices
                                WHERE destination = ? AND position IS NOT NULL
                                ORDER BY position""", (guest,)).fetchall()
        eligible = {row[:2] for row in rows if row[4]}
        if key in ordered:
            ordered.remove(key)
        active = [photo for photo in ordered if photo in eligible]
        if type(position) is not int or not 1 <= position <= len(active) + 1:
            raise RequestError(f"Enter a position from 1 to {len(active) + 1}.")
        offset = ordered.index(active[position - 1]) if position <= len(active) else len(ordered)
        ordered.insert(offset, key)
        db.executemany("""
            INSERT INTO final_choices(destination, album, photo, position) VALUES (?, ?, ?, ?)
            ON CONFLICT(destination, album, photo) DO UPDATE SET position = excluded.position
        """, ((guest, *photo, i) for i, photo in enumerate(ordered, 1)))

    def render(self, guest, token):
        plan, sources = self.plan(guest, refresh=True)
        self.require_current(token, plan["token"])
        photos = [photo for photo in plan["photos"] if photo["included"]]
        if not photos:
            raise RequestError("Include at least one photo before rendering.")
        for photo in photos:
            if not photo["available"]:
                raise RequestError(f"Source photo unavailable: {photo['album'] or 'Albums'} / {photo['path']}")
        parent = plain_path(self.output / guest_name(plan["name"]))
        parent.mkdir(parents=True, exist_ok=True)
        width = max(4, len(str(len(photos))))
        with TemporaryDirectory(prefix=".render-", dir=parent) as temp:
            staged = Path(temp) / "photos"
            staged.mkdir()
            for index, photo in enumerate(photos, 1):
                name = PurePosixPath(photo["path"])
                stem = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name.stem)[:80]
                stem = stem.encode("utf-8")[:200].decode("utf-8", "ignore").strip(" .") or "photo"
                target = staged / f"{index:0{width}d} - {stem}{name.suffix.lower()}"
                with sources[photo["album"]].open_photo(photo["path"]) as (source, size), target.open("xb") as file:
                    shutil.copyfileobj(source, file, length=1024 * 1024)
                    if file.tell() != size:
                        raise RequestError(f"Source photo changed during rendering: {photo['path']}")
            with self.store.database(write=True) as db:
                self.require_current(token, self.snapshot(db, guest)[2])
                number = 1
                while (target := parent / f"Render {number:03d}").exists() or target.is_symlink():
                    number += 1
                staged.rename(target)
        return dict(path=str(target), count=len(photos))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        if len(args) >= 2 and str(args[1]).startswith("5"):
            super().log_message(format, *args)

    def send_json(self, data, status=HTTPStatus.OK):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, file, size, content_type):
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(size))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy",
                         "default-src 'self'; frame-ancestors 'none'; object-src 'none'")
        self.end_headers()
        try:
            shutil.copyfileobj(file, self.wfile)
        except (OSError, BadZipFile):
            self.close_connection = True

    def dispatch(self, action):
        try:
            if self.headers.get("Host") != self.server.host_header:
                self.send_json({"error": "Use the local address printed by the sorter."},
                               HTTPStatus.FORBIDDEN)
                return
            action()
        except (BrokenPipeError, ConnectionResetError):
            pass
        except StaleReview as error:
            self.send_json({"error": str(error)}, HTTPStatus.CONFLICT)
        except (RequestError, json.JSONDecodeError, UnicodeDecodeError) as error:
            self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)
        except FileNotFoundError:
            self.send_json({"error": "The requested file or folder could not be found."},
                           HTTPStatus.NOT_FOUND)
        except (OSError, sqlite3.Error, BadZipFile, RuntimeError) as error:
            self.send_json({"error": str(error)}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def do_GET(self):
        self.dispatch(self.get)

    def get(self):
        url = urlsplit(self.path)
        sorter = self.server.sorter
        if url.path == "/api/albums":
            self.send_json(sorter.choices())
        elif url.path == "/api/final/guests":
            self.send_json(sorter.final.guests())
        elif url.path == "/photo":
            params = parse_qs(url.query, keep_blank_values=True)
            album = sorter.album(params.get("album", [None])[0])
            photo = params.get("path", [None])[0]
            with album.open_photo(photo) as (file, size):
                self.send_file(file, size, FORMATS[PurePosixPath(photo).suffix.lower()])
        elif url.path in STATIC:
            name, content_type = STATIC[url.path]
            with (HERE / "ui" / name).open("rb") as file:
                self.send_file(file, os.fstat(file.fileno()).st_size, content_type)
        else:
            self.send_json({"error": "Page not found."}, HTTPStatus.NOT_FOUND)

    def do_POST(self):
        self.dispatch(self.post)

    def post(self):
        if (self.headers.get("Origin") != self.server.url
                or self.headers.get_content_type() != "application/json"):
            self.send_json({"error": "Open the sorter at its local address."}, HTTPStatus.FORBIDDEN)
            return
        length = self.headers.get("Content-Length", "")
        if not length.isdecimal() or len(length) > 6 or int(length) > 128 * 1024:
            raise RequestError("Invalid request size.")
        data = json.loads(self.rfile.read(int(length)))
        if not isinstance(data, dict):
            raise RequestError("Invalid request.")
        sorter = self.server.sorter
        key = data.get("album")
        if self.path == "/api/open":
            self.send_json(sorter.open(key))
            return
        if self.path == "/api/final/open":
            self.send_json(sorter.final.plan(data.get("guest"), refresh=True)[0])
            return
        if self.path == "/api/final/edit":
            self.send_json(sorter.final.edit(data.get("guest"), data))
            return
        if self.path == "/api/final/render":
            self.send_json(sorter.final.render(data.get("guest"), data.get("token")))
            return
        album = sorter.album(key)
        if self.path == "/api/review":
            resume = album.save(data.get("photo"), data.get("destinations"),
                                data.get("advance") is True, data.get("revision"), data.get("printed"))
            state = album.state()
            self.send_json(dict(state, saved_next=resume))
        elif self.path == "/api/print-count":
            revision = album.save_print_count(data.get("photo"), data.get("printed"),
                                              data.get("revision"))
            self.send_json({"revision": revision})
        elif self.path == "/api/guest":
            name = album.add_guest(data.get("name"))
            self.send_json({"added": name})
        else:
            self.send_json({"error": "Page not found."}, HTTPStatus.NOT_FOUND)


class LocalServer(ThreadingHTTPServer):
    def server_bind(self):
        # The loopback URL is fixed, so startup does not need a hostname lookup.
        TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, default=HERE)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    try:
        with LocalServer(("127.0.0.1", args.port), Handler) as server:
            server.sorter = Sorter(args.workspace.resolve())
            server.host_header = f"127.0.0.1:{server.server_port}"
            server.url = f"http://{server.host_header}"
            print(f"Wedding Photo Sorter is ready at {server.url}", flush=True)
            if not args.no_browser:
                webbrowser.open(server.url)
            server.serve_forever()
    except KeyboardInterrupt:
        pass
    except (OSError, RequestError, sqlite3.Error) as error:
        parser.exit(1, f"Could not start the sorter. {error}\n")


if __name__ == "__main__":
    main()
