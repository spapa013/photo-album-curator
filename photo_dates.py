"""Read DateTimeOriginal from EXIF in JPEG, PNG, and WebP photos."""

from datetime import datetime
import struct


def exif_blocks(file):
    signature = file.read(12)
    if signature.startswith(b"\xff\xd8"):
        file.seek(2)
        while file.read(1) == b"\xff":
            marker = file.read(1)
            while marker == b"\xff":
                marker = file.read(1)
            if marker in (b"", b"\xda", b"\xd9"):
                return
            size = int.from_bytes(file.read(2), "big") - 2
            if size < 0:
                return
            if marker == b"\xe1":
                block = file.read(size)
                if block.startswith(b"Exif\0\0"):
                    yield block[6:]
            else:
                file.seek(size, 1)
    elif signature.startswith(b"\x89PNG\r\n\x1a\n") or (
        signature[:4] == b"RIFF" and signature[8:] == b"WEBP"
    ):
        png = signature.startswith(b"\x89PNG")
        file.seek(8 if png else 12)
        while len(header := file.read(8)) == 8:
            size, kind = struct.unpack(">I4s", header) if png else (
                int.from_bytes(header[4:], "little"), header[:4]
            )
            if kind in (b"eXIf", b"EXIF") and size <= 1024 * 1024:
                block = file.read(size)
                yield block[6:] if block.startswith(b"Exif\0\0") else block
                file.seek(4 if png else size % 2, 1)
            else:
                file.seek(size + (4 if png else size % 2), 1)
            if kind == b"IEND":
                return


def date_from_exif(data):
    order = {b"II": "<", b"MM": ">"}.get(data[:2])
    if order is None:
        return None
    magic, first_ifd = struct.unpack_from(order + "HI", data, 2)
    if magic != 42:
        return None

    def entries(offset):
        count, = struct.unpack_from(order + "H", data, offset)
        for index in range(count):
            yield struct.unpack_from(order + "HHII", data, offset + 2 + 12 * index)

    for tag, field_type, count, offset in entries(first_ifd):
        if (tag, field_type, count) != (0x8769, 4, 1):
            continue
        for tag, field_type, count, offset in entries(offset):
            if tag == 0x9003 and field_type == 2 and count >= 19:
                value = data[offset:offset + 19].decode("ascii")
                return datetime.strptime(value, "%Y:%m:%d %H:%M:%S")


def capture_time(file):
    for block in exif_blocks(file):
        try:
            date = date_from_exif(block)
        except (ValueError, struct.error):
            continue
        if date is not None:
            return date
