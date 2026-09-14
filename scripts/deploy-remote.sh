#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Run on the application VM after the release and its separate incoming env files
# have been uploaded. This script never creates DB users or reverses migrations.
if [[ $# -ne 1 || ! "$1" =~ ^[a-f0-9]{40}$ ]]; then
  printf 'Usage: bash scripts/deploy-remote.sh <40-character lowercase commit SHA>\n' >&2
  exit 64
fi

release_sha=$1
deploy_root="${HOME}/geunyang-math"
releases_root="${deploy_root}/releases"
release_dir="${releases_root}/${release_sha}"
shared_dir="${deploy_root}/shared"
current_link="${deploy_root}/current"
incoming_app_env="${deploy_root}/incoming/${release_sha}.env"
incoming_migration_env="${deploy_root}/incoming/${release_sha}.migrate.env"
active_app_env="${shared_dir}/app.env"
active_migration_env="${shared_dir}/migrate.env"
project_name=geunyang-math-prod
private_origin=http://10.0.0.130:3007
public_origin=https://geunyang-math.team-campfire.dev

log() { printf '[geunyang-math deploy] %s\n' "$*"; }
fail() { log "$*" >&2; exit 1; }

for required_command in docker flock curl python3 install mktemp mv readlink stat date mkdir ln rm; do
  command -v "$required_command" >/dev/null 2>&1 || fail "Required command unavailable: ${required_command}"
done
[[ -d "$release_dir" && ! -L "$release_dir" ]] || fail 'The requested release directory is missing or is a symlink.'
[[ -f "${release_dir}/docker-compose.prod.yml" && -f "${release_dir}/Dockerfile" ]] || fail 'The release is missing its deployment files.'

install -d -m 700 "$shared_dir" "${shared_dir}/deploy-backups"
exec 9>"${deploy_root}/deploy.lock"
flock -n 9 || fail 'Another deployment holds this project lock.'

run_id="${release_sha}.$(date -u +%Y%m%dT%H%M%SZ).$$"
backup_dir="${shared_dir}/deploy-backups/${run_id}"
symlink_temp="${deploy_root}/.current.${run_id}"
previous_release=''
previous_sha=''
previous_image_id=''
app_env_existed=0
migration_env_existed=0
environment_touched=0
pointer_commit_started=0
deployment_committed=0
phase=preflight

export IMAGE_REPOSITORY=geunyang-math
export APP_BIND_IP=10.0.0.130
export APP_PORT=3007
export DEPLOY_CA_FILE="${shared_dir}/mysql-ca.pem"

# Do not source env files or echo commands: their values are data, not shell code.
# Raw tool output is intentionally suppressed because database errors and Compose
# parsing errors can include credentials. Logs contain phase names and exit codes.
run_step() {
  phase=$1
  shift
  log "$phase"
  if "$@" >/dev/null 2>&1; then
    return 0
  else
    local status=$?
    log "${phase} failed (exit ${status}); raw command output was suppressed." >&2
    return "$status"
  fi
}

use_release() {
  export IMAGE_TAG=$1 BUILD_COMMIT=$1
  export DEPLOY_ENV_FILE=$2 DEPLOY_MIGRATION_ENV_FILE=$3
  compose_release="${releases_root}/$1"
}

compose() {
  docker compose --project-name "$project_name" --project-directory "$compose_release" \
    --file "${compose_release}/docker-compose.prod.yml" "$@"
}

check_env_file() {
  local env_path=$1
  [[ -f "$env_path" && ! -L "$env_path" && -r "$env_path" ]] || return 1
  [[ $(stat -c '%a' "$env_path") == 600 ]]
}

atomic_install_env() {
  local source=$1 target=$2 staged
  staged=$(mktemp "${target}.tmp.XXXXXX") || return 1
  if ! install -m 600 -- "$source" "$staged"; then
    rm -f -- "$staged"
    return 1
  fi
  if ! mv -fT -- "$staged" "$target"; then
    rm -f -- "$staged"
    return 1
  fi
}

restore_environment() {
  local restore_status=0
  if [[ $app_env_existed == 1 ]]; then
    atomic_install_env "${backup_dir}/app.env" "$active_app_env" || restore_status=1
  else
    rm -f -- "$active_app_env" || restore_status=1
  fi
  if [[ $migration_env_existed == 1 ]]; then
    atomic_install_env "${backup_dir}/migrate.env" "$active_migration_env" || restore_status=1
  else
    rm -f -- "$active_migration_env" || restore_status=1
  fi
  return "$restore_status"
}

verify_endpoint() {
  local origin=$1 endpoint=$2 expected_sha=$3
  curl --fail --silent --show-error --connect-timeout 5 --max-time 15 \
    --retry 2 --retry-connrefused --retry-delay 2 --retry-max-time 45 \
    --header 'Cache-Control: no-cache' "${origin}/api/${endpoint}?deployment=${expected_sha}" \
    | python3 -c '
import json, sys
document = json.load(sys.stdin)
expected = "ready" if sys.argv[1] == "health" else sys.argv[2]
key = "status" if sys.argv[1] == "health" else "commit"
if not isinstance(document, dict) or document.get(key) != expected:
    raise SystemExit(1)
' "$endpoint" "$expected_sha"
}

verify_release() {
  local expected_sha=$1
  verify_endpoint "$private_origin" health "$expected_sha" || return 1
  verify_endpoint "$private_origin" version "$expected_sha" || return 1
  verify_endpoint "$public_origin" health "$expected_sha" || return 1
  verify_endpoint "$public_origin" version "$expected_sha"
}

stop_project_app() {
  # Incoming files remain present, including on the first deployment where the
  # active files may already have been removed during rollback.
  use_release "$release_sha" "$incoming_app_env" "$incoming_migration_env"
  compose stop --timeout 30 app >/dev/null 2>&1
}

restore_current_pointer() {
  local observed_release
  [[ -L "$current_link" ]] || return 0
  observed_release=$(readlink -f -- "$current_link") || return 1
  # A signal can arrive after mv succeeds but before deployment_committed=1.
  # Inspect the actual pointer, and never remove a pointer to another release.
  [[ "$observed_release" == "$release_dir" ]] || return 0
  if [[ -n "$previous_release" ]]; then
    ln -s -- "$previous_release" "$symlink_temp" || return 1
    if ! mv -fT -- "$symlink_temp" "$current_link"; then
      rm -f -- "$symlink_temp"
      return 1
    fi
  else
    rm -f -- "$current_link"
  fi
}

on_exit() {
  local status=$?
  local image_restored=1
  trap - EXIT INT TERM
  set +e
  rm -f -- "$symlink_temp"
  if [[ $status -ne 0 && $deployment_committed == 0 ]]; then
    log "Deployment failed during ${phase}. Restoring the previous release state." >&2
    if [[ $pointer_commit_started == 1 ]]; then
      if ! restore_current_pointer; then
        log 'Could not restore the current release pointer; manual recovery is required.' >&2
      fi
    fi
    # A same-SHA rebuild may replace its tag, so restore the exact old image ID.
    if [[ -n "$previous_image_id" ]]; then
      if ! docker image tag "$previous_image_id" "${IMAGE_REPOSITORY}:${previous_sha}" >/dev/null 2>&1; then
        image_restored=0
        log 'Could not restore the previous image tag; manual recovery is required.' >&2
      fi
    fi
    if [[ $environment_touched == 1 ]]; then
      if [[ -n "$previous_release" ]]; then
        if restore_environment && [[ $image_restored == 1 ]]; then
          use_release "$previous_sha" "$active_app_env" "$active_migration_env"
          log "Restoring the previous application release ${previous_sha}."
          if compose up --detach --no-build --no-deps --wait --wait-timeout 120 app >/dev/null 2>&1; then
            if verify_release "$previous_sha" >/dev/null 2>&1; then
              log 'Previous application and environment restored and verified.'
            else
              log 'Previous application was restored, but endpoint verification failed; manual attention is required.' >&2
            fi
          else
            stop_project_app || log 'Could not stop this project app after rollback failure.' >&2
            log 'Previous application could not be started; this project app was stopped where possible.' >&2
          fi
        else
          stop_project_app || log 'Could not stop this project app after environment recovery failed.' >&2
          log 'Environment or image recovery failed; preserved backups need manual recovery.' >&2
        fi
      else
        stop_project_app || log 'Could not stop this project app after the first deployment failed.' >&2
        restore_environment || log 'Could not restore the pre-deployment environment files.' >&2
        log 'First deployment failed; no unverified project app is intentionally left running.' >&2
      fi
      log 'Database migrations were not reversed. Environment backups and incoming files were preserved.' >&2
    fi
  fi
  exit "$status"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

check_env_file "$incoming_app_env" || fail 'Incoming application environment must be a readable regular file with mode 600.'
check_env_file "$incoming_migration_env" || fail 'Incoming migration environment must be a readable regular file with mode 600.'
[[ -f "$DEPLOY_CA_FILE" && -r "$DEPLOY_CA_FILE" ]] || fail 'The shared MySQL CA certificate is missing or unreadable.'

if [[ -e "$current_link" || -L "$current_link" ]]; then
  [[ -L "$current_link" ]] || fail 'The current release pointer must be a symlink.'
  previous_release=$(readlink -f -- "$current_link")
  previous_sha=${previous_release##*/}
  [[ "$previous_sha" =~ ^[a-f0-9]{40}$ && "$previous_release" == "${releases_root}/${previous_sha}" ]] \
    || fail 'The previous release pointer is outside the expected releases directory.'
  [[ -f "${previous_release}/docker-compose.prod.yml" ]] || fail 'The previous release is missing its Compose file.'
  check_env_file "$active_app_env" && check_env_file "$active_migration_env" \
    || fail 'The previous release environment is missing or cannot be safely preserved.'
  previous_image_id=$(docker image inspect "${IMAGE_REPOSITORY}:${previous_sha}" --format '{{.Id}}' 2>/dev/null) \
    || fail 'The previous application image is unavailable for rollback.'
  [[ "$previous_image_id" =~ ^sha256:[a-f0-9]{64}$ ]] || fail 'The previous image identifier is invalid.'
  run_step 'Preserve the exact previous image for rollback' \
    docker image tag "$previous_image_id" "${IMAGE_REPOSITORY}:rollback-${run_id}"
fi

use_release "$release_sha" "$incoming_app_env" "$incoming_migration_env"
run_step 'Validate deployment configuration' compose --profile tools config --quiet
run_step 'Build application and migration images' compose --profile tools build app migrate

phase='Back up the active environment'
install -d -m 700 "$backup_dir"
if [[ -e "$active_app_env" || -L "$active_app_env" ]]; then
  check_env_file "$active_app_env" || fail 'The active application environment cannot be safely preserved.'
  install -m 600 -- "$active_app_env" "${backup_dir}/app.env"
  app_env_existed=1
fi
if [[ -e "$active_migration_env" || -L "$active_migration_env" ]]; then
  check_env_file "$active_migration_env" || fail 'The active migration environment cannot be safely preserved.'
  install -m 600 -- "$active_migration_env" "${backup_dir}/migrate.env"
  migration_env_existed=1
fi
printf '%s\n' "$previous_release" >"${backup_dir}/previous-release"
printf '%s\n' "$previous_image_id" >"${backup_dir}/previous-image"

environment_touched=1
run_step 'Install application environment atomically' atomic_install_env "$incoming_app_env" "$active_app_env"
run_step 'Install migration environment atomically' atomic_install_env "$incoming_migration_env" "$active_migration_env"
use_release "$release_sha" "$active_app_env" "$active_migration_env"
run_step 'Apply migrations and verify database content' compose run --rm --no-deps migrate
run_step 'Start application and wait for readiness' compose up --detach --no-build --no-deps --wait --wait-timeout 120 app
run_step 'Verify private application health' verify_endpoint "$private_origin" health "$release_sha"
run_step 'Verify private application commit' verify_endpoint "$private_origin" version "$release_sha"
run_step 'Verify public HTTPS application health' verify_endpoint "$public_origin" health "$release_sha"
run_step 'Verify public HTTPS application commit' verify_endpoint "$public_origin" version "$release_sha"

phase='Commit the current release pointer'
pointer_commit_started=1
ln -s -- "$release_dir" "$symlink_temp"
mv -fT -- "$symlink_temp" "$current_link"
deployment_committed=1
log "Deployment verified and committed: ${release_sha}." || true
