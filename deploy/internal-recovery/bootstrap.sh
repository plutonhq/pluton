#!/bin/bash
# Fixed reviewed bootstrap, invoked only in a disposable digest-pinned DB target as UID 999.
set -Eeuo pipefail
umask 077
trap 'echo internal-target-bootstrap-failed' ERR
[[ "$(id -u)" == 999 && "$(id -g)" == 999 ]] || exit 70
case "${1:-}" in mariadb|postgresql) ;; *) exit 70 ;; esac
config=/run/pluton-internal-bootstrap
# Both engines share this exclusive advisory lock. Parent holds it even when postgres closes FDs.
exec 9>/run/pluton-internal-lock/engine.lock
flock -n 9 || { echo 'internal-target-engine-busy'; exit 71; }
child=''
stop() { if [[ -n "$child" ]]; then kill -TERM "$child" 2>/dev/null || true; wait "$child" 2>/dev/null || true; fi; }
trap stop TERM INT EXIT
if [[ "$1" == mariadb ]]; then
  data=/var/lib/mysql/data
  [[ ! -e "$data" ]] || { echo 'internal-target-data-not-empty'; exit 72; }
  mkdir -m 700 "$data"
  mariadb-install-db --no-defaults --datadir="$data" --auth-root-authentication-method=normal --skip-test-db >/dev/null 2>&1
  mariadbd --no-defaults --datadir="$data" --socket=/tmp/bootstrap.sock --pid-file=/tmp/database.pid \
    --skip-networking --skip-log-bin --innodb-buffer-pool-size=256M --log-error=/dev/null >/dev/null 2>&1 &
  child=$!
  ready=false
  for attempt in {1..60}; do
    if mariadb --no-defaults --socket=/tmp/bootstrap.sock -uroot -e 'SELECT 1' >/dev/null 2>&1; then ready=true; break; fi
    kill -0 "$child" 2>/dev/null || break
    sleep 0.5
  done
  [[ "$ready" == true ]] || { echo 'internal-target-bootstrap-failed'; exit 73; }
  mariadb --no-defaults --socket=/tmp/bootstrap.sock -uroot <"$config/bootstrap.sql" >/dev/null 2>&1
  stop; child=''
  mariadbd --no-defaults --datadir="$data" --socket=/tmp/database.sock --pid-file=/tmp/database.pid \
    --bind-address=0.0.0.0 --port=3306 --skip-log-bin --local-infile=0 --require-secure-transport=ON \
    --ssl-ca="$config/ca.pem" --ssl-cert="$config/server.pem" --ssl-key="$config/server.key" \
    --tls-version=TLSv1.2,TLSv1.3 --event-scheduler=OFF --innodb-buffer-pool-size=256M --max-connections=8 \
    --general-log=OFF --slow-query-log=OFF --log-error=/dev/null >/dev/null 2>&1 &
  child=$!
else
  data=/var/lib/postgresql/data
  [[ ! -e "$data" ]] || { echo 'internal-target-data-not-empty'; exit 72; }
  initdb --pgdata="$data" --no-instructions --encoding=UTF8 --locale=C --auth-local=trust --auth-host=scram-sha-256 >/dev/null 2>&1
  pg_ctl -D "$data" -l /dev/null -o '-c listen_addresses= -c unix_socket_directories=/tmp -c log_min_error_statement=panic' -w start >/dev/null 2>&1
  psql --no-psqlrc --set=ON_ERROR_STOP=1 --set=VERBOSITY=terse --set=SHOW_CONTEXT=never --host=/tmp --dbname=postgres <"$config/bootstrap.sql" >/dev/null 2>&1
  pg_ctl -D "$data" -m fast -w stop >/dev/null 2>&1
  # Local trust is confined to the target's private 0700 /tmp; the app never receives this socket/mount.
  printf '%s\n' 'local all all trust' 'hostssl all all all scram-sha-256' 'hostnossl all all all reject' >"$data/pg_hba.conf"
  postgres -D "$data" -c listen_addresses='*' -c unix_socket_directories=/tmp -c ssl=on \
    -c ssl_ca_file="$config/ca.pem" -c ssl_cert_file="$config/server.pem" -c ssl_key_file="$config/server.key" \
    -c ssl_min_protocol_version=TLSv1.2 -c password_encryption=scram-sha-256 -c max_connections=8 \
    -c shared_buffers=128MB -c work_mem=8MB -c maintenance_work_mem=64MB \
    -c log_min_error_statement=panic -c log_error_verbosity=terse >/dev/null 2>&1 &
  child=$!
fi
echo 'internal-target-started'
wait "$child"
