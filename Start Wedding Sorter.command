#!/bin/bash
cd -- "$(dirname -- "$0")" || exit 1

for python in python3 /opt/homebrew/bin/python3 /usr/local/bin/python3; do
    if "$python" -c 'import sys; sys.exit(sys.version_info < (3, 10))' 2>/dev/null; then
        exec "$python" launch.py "$@"
    fi
done

printf '%s\n' 'Photo Album Curator needs Python 3.10 or newer.' \
    'Install it from https://www.python.org/downloads/macos/ and try again.'
exit 1
