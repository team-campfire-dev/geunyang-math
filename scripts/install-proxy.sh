#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# One-time infrastructure operation on the app VM, separate from app deployment.
# The source file is reviewed in deploy/nginx/geunyang-math.conf.
[[ $# == 1 && -f "$1" ]] || { printf 'Usage: bash install-proxy.sh <reviewed nginx config>\n' >&2; exit 64; }
source_config=$1
data_root=/home/ubuntu/nginx/data/nginx
target_config="$data_root/geunyang-math/server.conf"
include_file="$data_root/custom/http.conf"
backup_dir="${HOME}/geunyang-math/shared/proxy-backups/$(date -u +%Y%m%dT%H%M%SZ).$$"
include_line='include /data/nginx/geunyang-math/server.conf;'
mkdir -p "$backup_dir"

if docker exec nginx-app-1 sh -c 'grep -l "server_name.*geunyang-math.team-campfire.dev" /data/nginx/proxy_host/*.conf' >/dev/null 2>&1; then
  printf 'The domain already exists in an NPM-managed host; resolve the duplicate first.\n' >&2
  exit 1
fi

had_config=0
had_include=0
if sudo test -e "$target_config"; then sudo cp -p "$target_config" "$backup_dir/server.conf"; had_config=1; fi
if sudo test -e "$include_file"; then sudo cp -p "$include_file" "$backup_dir/http.conf"; had_include=1; fi
finished=0
restore() {
  status=$?
  trap - EXIT
  if [[ $finished == 0 ]]; then
    if [[ $had_config == 1 ]]; then sudo cp -p "$backup_dir/server.conf" "$target_config"; else sudo rm -f "$target_config"; fi
    if [[ $had_include == 1 ]]; then sudo cp -p "$backup_dir/http.conf" "$include_file"; else sudo rm -f "$include_file"; fi
    printf 'Project proxy changes restored; existing NPM hosts preserved.\n' >&2
  fi
  exit "$status"
}
trap restore EXIT
sudo mkdir -p "$data_root/geunyang-math" "$data_root/custom"
sudo install -m 644 "$source_config" "$target_config"
if ! sudo test -e "$include_file"; then sudo install -m 644 /dev/null "$include_file"; fi
if ! sudo grep -Fxq "$include_line" "$include_file"; then printf '\n%s\n' "$include_line" | sudo tee -a "$include_file" >/dev/null; fi
docker exec nginx-app-1 nginx -t
docker exec nginx-app-1 nginx -s reload
finished=1
printf 'Project HTTPS proxy installed. Existing NPM hosts were not changed.\n'
