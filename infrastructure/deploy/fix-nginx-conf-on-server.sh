#!/usr/bin/env bash
# Run this ON THE SERVER (e.g. in /opt/yannis-eose) to fix nginx.conf when it still
# references the missing options-ssl-nginx.conf. Removes those lines and adds inlined SSL.
set -e
CONF="${1:-/opt/yannis-eose/nginx.conf}"
if [ ! -f "$CONF" ]; then
  echo "Usage: $0 [path-to-nginx.conf]"
  echo "File not found: $CONF"
  exit 1
fi
# Remove the two lines that require files not present in the container
sed -i '/include \/etc\/letsencrypt\/options-ssl-nginx.conf;/d' "$CONF"
sed -i '/ssl_dhparam \/etc\/letsencrypt\/ssl-dhparams.pem;/d' "$CONF"
# If there is no ssl_protocols line yet, add the block after each ssl_certificate_key
if ! grep -q 'ssl_protocols TLSv1.2' "$CONF"; then
  # Add 3 lines after every "ssl_certificate_key ... privkey.pem;" (frontend and API blocks)
  sed -i '/ssl_certificate_key.*privkey.pem;/a\
        ssl_protocols TLSv1.2 TLSv1.3;\
        ssl_prefer_server_ciphers off;\
        ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;' "$CONF"
fi
echo "Patched $CONF. Restart nginx: docker compose -f docker-compose.prod.yml up -d --force-recreate nginx"
