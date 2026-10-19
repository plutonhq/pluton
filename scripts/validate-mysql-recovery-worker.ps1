param([string]$WorkerImage = 'pluton-mysql-worker:local', [string]$RuntimeImage = 'pluton-mysql-server:local')
# Disposable, internal network; no host ports/socket/data, real secrets or repositories.
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$fixtureId = [Guid]::NewGuid().ToString('N')
$prefix = 'pluton-mysql-fixture-' + $fixtureId
$network = $prefix + '-net'
$db = $prefix + '-db'
$worker = $prefix + '-worker'
$volumes = @("${prefix}-config", "${prefix}-control", "${prefix}-ipc", "${prefix}-state")
$configVolume, $controlVolume, $ipcVolume, $stateVolume = $volumes
$targetImage = 'mysql:8.4.11@sha256:24989179f58856db763f418010c1169fecc944e3ec1ea7e921572d83eb070f70'
$fixtureSource = (Resolve-Path (Join-Path $repoRoot 'backend/__tests__/integration')).Path
function Require-Success([string]$message) { if ($LASTEXITCODE -ne 0) { throw $message } }
function Start-Worker {
    & docker run -d --name $worker --init --network $network --read-only --user '10001:10001' --cap-drop ALL --security-opt no-new-privileges --pids-limit 64 --memory 512m --tmpfs '/tmp:rw,noexec,nosuid,nodev,size=32m' --mount "type=volume,source=$configVolume,target=/run/pluton-mysql-config,readonly" --mount "type=volume,source=$ipcVolume,target=/run/pluton-mysql-worker" --mount "type=bind,source=$fixtureSource,target=/fixture-code,readonly" $WorkerImage | Out-Null
    Require-Success 'Could not start disposable worker.'
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        & docker exec $worker node -e "process.exit(require('fs').existsSync('/run/pluton-mysql-worker/worker.sock')?0:1)" 2>$null
        if ($LASTEXITCODE -eq 0) { return }
        Start-Sleep -Milliseconds 250
    }
    throw 'Disposable worker refused startup (no provider output exposed).'
}
function Fixture-Sql([string]$sql) {
    $sql | & docker exec -i $db mysql --no-defaults --protocol=socket --socket=/var/run/mysqld/mysqld.sock --batch --skip-column-names 2>$null | Out-Null
    Require-Success 'Synthetic fixture provisioning/assertion failed.'
}
try {
    & docker network create --internal $network | Out-Null
    Require-Success 'Could not create isolated fixture network.'
    foreach ($volume in $volumes) { & docker volume create $volume | Out-Null; Require-Success 'Could not create disposable fixture volume.' }
    & docker run --rm --network none --user '0:0' --entrypoint node --mount "type=volume,source=$configVolume,target=/config" --mount "type=volume,source=$controlVolume,target=/control" --mount "type=volume,source=$stateVolume,target=/state" --mount "type=bind,source=$fixtureSource,target=/fixture-code,readonly" $WorkerImage /fixture-code/mysqlRecoveryWorker.prepare.mjs
    Require-Success 'Could not prepare synthetic fixture.'
    & docker run --rm --network none --user '0:0' --entrypoint node --mount "type=volume,source=$stateVolume,target=/state" $WorkerImage -e "require('fs').chownSync('/state',10001,10001);require('fs').chmodSync('/state',448)"
    Require-Success 'Could not prepare private test signaling.'
    # Only the separate disposable TARGET contains a server. No default entrypoint or password env.
    & docker run -d --name $db --network $network --network-alias mysql-recovery.example.internal --read-only --memory 1g --tmpfs '/var/lib/mysql:rw,nosuid,nodev,uid=999,gid=999,mode=700,size=512m' --tmpfs '/var/run/mysqld:rw,nosuid,nodev,uid=999,gid=999,mode=700,size=8m' --tmpfs '/tmp:rw,nosuid,nodev,size=32m' --mount "type=volume,source=$controlVolume,target=/fixture,readonly" --entrypoint /bin/bash $targetImage -ec 'mysqld --initialize-insecure --user=mysql --datadir=/var/lib/mysql >/dev/null 2>&1 && exec mysqld --user=mysql --datadir=/var/lib/mysql --socket=/var/run/mysqld/mysqld.sock --init-file=/fixture/provision.sql --ssl-ca=/fixture/ca.pem --ssl-cert=/fixture/server.pem --ssl-key=/fixture/server.key --require-secure-transport=ON --mysqlx=0 --log-error=/tmp/mysql.err' | Out-Null
    Require-Success 'Could not start disposable Oracle MySQL target.'
    for ($attempt = 0; $attempt -lt 180; $attempt++) {
        & docker exec $db mysql --no-defaults --protocol=socket --socket=/var/run/mysqld/mysqld.sock --batch -e 'SELECT purpose FROM pluton_recovery_guard.pluton_recovery_guard' 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { break }
        if ($attempt -eq 179) { throw 'Disposable MySQL target not ready (provider output withheld).' }
        Start-Sleep -Milliseconds 500
    }
    Start-Worker
    foreach ($mode in @('success','wrong-password','invalid-marker','existing-database','sql-failure','client-command','bad-digest','target-mismatch','cancel','restart','bad-tls','unavailable')) {
        if ($mode -eq 'invalid-marker') { Fixture-Sql "UPDATE pluton_recovery_guard.pluton_recovery_guard SET purpose='not-recovery';" }
        if ($mode -eq 'existing-database') { Fixture-Sql 'CREATE DATABASE example_db; CREATE TABLE example_db.protected_fixture(id INT); INSERT INTO example_db.protected_fixture VALUES(1);' }
        if ($mode -eq 'bad-tls') {
            & docker rm -f $worker | Out-Null
            & docker run --rm --network none --user '0:0' --entrypoint node --mount "type=volume,source=$configVolume,target=/config" --mount "type=volume,source=$controlVolume,target=/control,readonly" $WorkerImage -e "require('fs').copyFileSync('/control/wrong-ca.pem','/config/ca.pem')"
            Require-Success 'Could not prepare failed-TLS fixture.'
            Start-Worker
        }
        if ($mode -eq 'unavailable') { & docker stop $worker | Out-Null }
        & docker run --rm --network none --user '0:0' --entrypoint node --mount "type=volume,source=$stateVolume,target=/state" $WorkerImage -e "require('fs').rmSync('/state/ready',{force:true})"
        $app = $prefix + '-app'
        & docker run -d --name $app --init --network none --read-only --user '10001:10001' --cap-drop ALL --security-opt no-new-privileges --tmpfs '/tmp:rw,noexec,nosuid,nodev,uid=10001,gid=10001,mode=700,size=32m' --tmpfs '/data:rw,noexec,nosuid,nodev,uid=10001,gid=10001,mode=700,size=8m' -e PLUTON_MYSQL_WORKER=enabled --mount "type=volume,source=$ipcVolume,target=/run/pluton-mysql-worker,readonly" --mount "type=volume,source=$controlVolume,target=/fixture-control,readonly" --mount "type=volume,source=$stateVolume,target=/fixture-state" --mount "type=bind,source=$fixtureSource,target=/fixture-code,readonly" --entrypoint node $RuntimeImage --loader /app/backend/loader.mjs /fixture-code/mysqlRecoveryWorker.smoke.mjs $mode | Out-Null
        Require-Success 'Could not start UID 10001 application fixture.'
        if ($mode -in @('cancel','restart')) {
            for ($attempt = 0; $attempt -lt 100; $attempt++) {
                & docker exec $app node -e "process.exit(require('fs').existsSync('/fixture-state/ready')?0:1)" 2>$null
                if ($LASTEXITCODE -eq 0) { break }
                Start-Sleep -Milliseconds 100
            }
            if ($attempt -eq 100) { throw 'Native import stage not reached.' }
            & docker exec $worker node /fixture-code/mysqlRecoveryWorker.observe.mjs
            Require-Success 'Worker private file/process validation failed.'
            if ($mode -eq 'restart') { & docker restart -t 0 $worker | Out-Null; Require-Success 'Worker restart fixture failed.' }
        }
        $exitCode = & docker wait $app
        & docker logs $app
        if ($exitCode -ne '0') { throw "Oracle MySQL integration failed: $mode" }
        & docker rm $app | Out-Null
        if ($mode -eq 'invalid-marker') { Fixture-Sql "UPDATE pluton_recovery_guard.pluton_recovery_guard SET purpose='pluton-phase6-recovery-only';" }
        if ($mode -eq 'existing-database') {
            Fixture-Sql "SET @n=(SELECT COUNT(*) FROM example_db.protected_fixture); CREATE TEMPORARY TABLE pluton_recovery_guard.assertion(passed INT CHECK(passed=1)); INSERT INTO pluton_recovery_guard.assertion VALUES(IF(@n=1,1,0)); DROP DATABASE example_db;"
        }
        if ($mode -ne 'unavailable') {
            & docker exec $worker node -e "if(require('fs').readdirSync('/tmp').some(n=>n.startsWith('pluton-mysql-'))||require('fs').existsSync('/tmp/mysql-worker-command-escape'))process.exit(1)"
            Require-Success 'Worker left private staging/credentials after completion.'
        }
    }
    Write-Output 'PASS all 12 disposable Oracle MySQL worker scenarios; no host ports or production data.'
} finally {
    # Delete only the exact randomized fixture names created by this invocation.
    if ($prefix -notmatch '^pluton-mysql-fixture-[a-f0-9]{32}$') { throw 'Unsafe fixture cleanup target.' }
    foreach ($name in @("${prefix}-app", $worker, $db)) { & docker rm -f $name 2>$null | Out-Null }
    foreach ($volume in $volumes) { & docker volume rm $volume 2>$null | Out-Null }
    & docker network rm $network 2>$null | Out-Null
}
