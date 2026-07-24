#!/bin/sh
set -e

if [ -n "$DATABASE_URL" ]; then
  echo "StrideVote: applying database migrations…"
  ./node_modules/.bin/prisma migrate deploy || echo "StrideVote: migrate deploy failed, continuing"
fi

exec node server.js
