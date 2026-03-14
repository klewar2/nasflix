#!/bin/bash
# Script pour Synology DSM Task Scheduler
# Triggered Task > Boot-up > Run as root
# Appelle le backend pour déclencher une synchronisation au démarrage du NAS

API_URL="https://nasflixapi-production.up.railway.app/api"
SECRET="100aaa229a9910fa2f43f535af9332fa"

# Attendre que le réseau soit prêt
sleep 60

# Wake le backend
curl -s "${API_URL}/health" > /dev/null 2>&1
sleep 5

# Déclencher la synchronisation
curl -s -X POST "${API_URL}/sync/webhook" \
  -H "Content-Type: application/json" \
  -H "x-sync-secret: ${SECRET}" \
  -d '{"trigger":"nas_boot"}'

echo "$(date): Boot sync triggered" >> /var/log/nasflix-sync.log
