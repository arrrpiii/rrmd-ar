#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
python3 -m venv .venv-local
.venv-local/bin/python -m pip install -r local-runtime/requirements.txt
.venv-local/bin/python local-runtime/download.py
