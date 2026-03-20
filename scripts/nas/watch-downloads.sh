#!/bin/bash
# Script pour Synology DSM Task Scheduler
# Scheduled Task > toutes les 5 minutes
# Détecte ajouts / suppressions / déplacements et déclenche une sync ciblée

API_URL="<api_url>/api"
SECRET="<webhook_secret>"
WATCH_DIRS="/volume1/video"
STATE_FILE="/volume1/homes/<user>/.nasflix_last_state"
LOG_FILE="/volume1/homes/<user>/nasflix-sync.log"

TMP_DIR="/tmp/nasflix_$$"
mkdir -p "$TMP_DIR"
trap "rm -rf $TMP_DIR" EXIT

# Liste actuelle des fichiers vidéo (triée)
find $WATCH_DIRS -type f \( -name "*.mkv" -o -name "*.mp4" -o -name "*.avi" -o -name "*.m4v" -o -name "*.ts" \) 2>/dev/null | sort > "$TMP_DIR/current"

# Premier run ou migration depuis l'ancien format (hash) : sauvegarder l'état sans déclencher
if [ ! -f "$STATE_FILE" ] || ! grep -q "/" "$STATE_FILE" 2>/dev/null; then
  cp "$TMP_DIR/current" "$STATE_FILE"
  echo "$(date): Initial state saved ($(wc -l < "$TMP_DIR/current") files)" >> "$LOG_FILE"
  exit 0
fi

# Aucun changement
if diff -q "$STATE_FILE" "$TMP_DIR/current" > /dev/null 2>&1; then
  exit 0
fi

# Calcul du diff
comm -23 "$STATE_FILE" "$TMP_DIR/current" > "$TMP_DIR/removed"
comm -13 "$STATE_FILE" "$TMP_DIR/current" > "$TMP_DIR/added"

cp "$TMP_DIR/added"   "$TMP_DIR/added_remaining"
cp "$TMP_DIR/removed" "$TMP_DIR/removed_remaining"

# --- Détection des déplacements (même nom de fichier, chemin différent) ---
build_json_array() {
  local file="$1"
  local result="["
  local first=true
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    escaped=$(printf '%s' "$line" | sed 's/\\/\\\\/g; s/"/\\"/g')
    [ "$first" = true ] && first=false || result+=","
    result+="\"$escaped\""
  done < "$file"
  result+="]"
  echo "$result"
}

MOVED_JSON="["
FIRST_MOVE=true

while IFS= read -r removed_path; do
  [ -z "$removed_path" ] && continue
  removed_name=$(basename "$removed_path")
  added_path=$(grep "/$removed_name$" "$TMP_DIR/added_remaining" | head -1)

  if [ -n "$added_path" ]; then
    [ "$FIRST_MOVE" = true ] && FIRST_MOVE=false || MOVED_JSON+=","
    from_esc=$(printf '%s' "$removed_path" | sed 's/\\/\\\\/g; s/"/\\"/g')
    to_esc=$(printf '%s'   "$added_path"   | sed 's/\\/\\\\/g; s/"/\\"/g')
    MOVED_JSON+="{\"from\":\"$from_esc\",\"to\":\"$to_esc\"}"

    # Retirer de added/removed restants
    grep -vF "$added_path"   "$TMP_DIR/added_remaining"   > "$TMP_DIR/tmp" && mv "$TMP_DIR/tmp" "$TMP_DIR/added_remaining"
    grep -vF "$removed_path" "$TMP_DIR/removed_remaining" > "$TMP_DIR/tmp" && mv "$TMP_DIR/tmp" "$TMP_DIR/removed_remaining"
  fi
done < "$TMP_DIR/removed"

MOVED_JSON+="]"

ADDED_JSON=$(build_json_array "$TMP_DIR/added_remaining")
REMOVED_JSON=$(build_json_array "$TMP_DIR/removed_remaining")

ADDED_COUNT=$(grep -c . "$TMP_DIR/added_remaining" 2>/dev/null || echo 0)
REMOVED_COUNT=$(grep -c . "$TMP_DIR/removed_remaining" 2>/dev/null || echo 0)
MOVED_COUNT=$(grep -c . "$TMP_DIR/removed" 2>/dev/null || echo 0)
MOVED_COUNT=$((MOVED_COUNT - REMOVED_COUNT))

# --- Appel webhook ---
curl -s -X POST "${API_URL}/sync/webhook" \
  -H "Content-Type: application/json" \
  -H "x-sync-secret: ${SECRET}" \
  -d "{\"trigger\":\"file_change\",\"added\":${ADDED_JSON},\"removed\":${REMOVED_JSON},\"moved\":${MOVED_JSON}}"

echo "$(date): +${ADDED_COUNT} added, -${REMOVED_COUNT} removed, ~${MOVED_COUNT} moved — sync triggered" >> "$LOG_FILE"

# Sauvegarder le nouvel état
cp "$TMP_DIR/current" "$STATE_FILE"
