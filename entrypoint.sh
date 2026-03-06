#!/bin/sh
# Fix ownership of mounted database volume before dropping to non-root user
chown -R posapp:posapp /app/database
exec gosu posapp "$@"
