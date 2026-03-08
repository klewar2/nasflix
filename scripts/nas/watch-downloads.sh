#!/bin/bash
# Script pour Synology DSM Task Scheduler
# Scheduled Task > toutes les 5 minutes
# Détecte les nouveaux fichiers et déclenche une sync

API_URL="https://your-api.railway.app/api"
SECRET="your-webhook-secret"
WATCH_DIRS="/volume1/video"
STATE_FILE="/volume1/scripts/.nasflix_last_state"

# Hash de la liste actuelle des fichiers vidéo
CURRENT_HASH=$(find $WATCH_DIRS -type f \( -name "*.mkv" -o -name "*.mp4" -o -name "*.avi" -o -name "*.m4v" \) 2>/dev/null | sort | md5sum | cut -d' ' -f1)

if [ -f "$STATE_FILE" ]; then
  LAST_HASH=$(cat "$STATE_FILE")
  if [ "$CURRENT_HASH" != "$LAST_HASH" ]; then
    curl -s -X POST "${API_URL}/sync/webhook" \
      -H "Content-Type: application/json" \
      -H "x-sync-secret: ${SECRET}" \
      -d '{"trigger":"file_change"}'
    echo "$(date): File change detected, sync triggered" >> /var/log/nasflix-sync.log
  fi
fi

echo "$CURRENT_HASH" > "$STATE_FILE"
