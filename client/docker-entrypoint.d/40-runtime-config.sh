#!/bin/sh
set -eu

cat > /usr/share/nginx/html/config.js <<EOF
window.__SERVER_URL__ = "${SERVER_URL:-}";
EOF
