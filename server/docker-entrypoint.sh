#!/bin/sh
set -eu

: "${DB_PATH:=/app/server/db/data.db}"
: "${UPLOAD_DIR:=/data/uploads}"

mkdir -p "$(dirname "$DB_PATH")" "$UPLOAD_DIR"
node db/create_db.js

exec "$@"
