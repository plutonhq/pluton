param([string]$WorkerImage='pluton-mysql-persistent-worker:local',[string]$RuntimeImage='pluton-persistent-ci:local',[switch]$UseLocalBuild,[switch]$CancellationOnly,[switch]$CoreLifecycleOnly)
# Isolated Custom targets only. No mount/loop fixture, socket mount, host ports or production.
$ErrorActionPreference='Stop'
if($CancellationOnly -and $CoreLifecycleOnly){throw 'Select only one focused fixture mode.'}
$context=& docker context inspect --format '{{.Endpoints.docker.Host}}'
if($LASTEXITCODE -ne 0 -or $context -notmatch '^(npipe|unix)://'){throw 'Only a local disposable Docker fixture is allowed.'}
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$code=(Resolve-Path (Join-Path $repo 'backend/__tests__/integration')).Path
$applicationCode=@()
if($UseLocalBuild){
  $dist=(Resolve-Path (Join-Path $repo 'backend/dist')).Path
  $migrations=(Resolve-Path (Join-Path $repo 'backend/drizzle')).Path
  $applicationCode=@('--mount',"type=bind,source=$dist,target=/app/backend/dist,readonly",'--mount',"type=bind,source=$migrations,target=/app/drizzle,readonly")
}
$scope='pluton-mysql-persistent-'+[Guid]::NewGuid().ToString('N')
$network="$scope-net";$db="$scope-db";$worker="$scope-worker";$app="$scope-app"
$volumes=@("$scope-config","$scope-control","$scope-ipc","$scope-state","$scope-approval")
$config,$control,$ipc,$state,$approval=$volumes
$targetImage='mysql:8.4.11@sha256:24989179f58856db763f418010c1169fecc944e3ec1ea7e921572d83eb070f70'
function Check([string]$message){if($LASTEXITCODE -ne 0){throw $message}}
function Prepare([string]$mode){
  & docker run --rm --network none --user '0:0' --entrypoint node --mount "type=volume,source=$config,target=/config" --mount "type=volume,source=$control,target=/control" --mount "type=volume,source=$approval,target=/approval" --mount "type=volume,source=$state,target=/state" --mount "type=bind,source=$code,target=/fixture-code,readonly" $WorkerImage /fixture-code/mysqlPersistentRestore.prepare.mjs $mode
  Check 'Private persistent fixture preparation failed.'
}
function Start-Worker([switch]$ExpectRefusal) {
  & docker run -d --name $worker --init --network $network --read-only --user '10001:10001' --cap-drop ALL --security-opt no-new-privileges --pids-limit 64 --memory 512m --tmpfs '/tmp:rw,noexec,nosuid,nodev,size=32m' --mount "type=volume,source=$config,target=/run/pluton-mysql-config,readonly" --mount "type=volume,source=$ipc,target=/run/pluton-mysql-worker" --mount "type=bind,source=$code,target=/fixture-code,readonly" $WorkerImage | Out-Null
  Check 'Could not start disposable retained worker.'
  if($ExpectRefusal){$exit=& docker wait $worker;if($exit -ne '1'){throw 'Unsafe worker startup was not refused.'};return}
  for($attempt=0;$attempt -lt 80;$attempt++){
    & docker exec $worker node -e "process.exit(require('fs').existsSync('/run/pluton-mysql-worker/worker.sock')?0:1)" 2>$null
    if($LASTEXITCODE -eq 0){return};Start-Sleep -Milliseconds 100
  };throw 'Retained worker startup refused.'
}
function Fixture-Sql([string]$sql){
  $sql | & docker exec -i $db mysql --no-defaults --protocol=socket --socket=/var/run/mysqld/mysqld.sock --batch --skip-column-names 2>$null | Out-Null
  Check 'Isolated persistent target fixture assertion failed.'
}
try{
  & docker network create --internal $network | Out-Null;Check 'Fixture network failed.'
  foreach($volume in $volumes){& docker volume create $volume | Out-Null;Check 'Fixture volume failed.'}
  Prepare 'prepare'
  & docker run -d --name $db --network $network --network-alias mysql-recovery.example.internal --network-alias mysql-wrong-identity.example.internal --read-only --memory 1g --tmpfs '/var/lib/mysql:rw,nosuid,nodev,uid=999,gid=999,mode=700,size=512m' --tmpfs '/var/run/mysqld:rw,nosuid,nodev,uid=999,gid=999,mode=700,size=8m' --tmpfs '/tmp:rw,nosuid,nodev,size=32m' --mount "type=volume,source=$control,target=/fixture,readonly" --entrypoint /bin/bash $targetImage -ec 'mysqld --initialize-insecure --user=mysql --datadir=/var/lib/mysql >/dev/null 2>&1 && exec mysqld --user=mysql --datadir=/var/lib/mysql --socket=/var/run/mysqld/mysqld.sock --init-file=/fixture/provision.sql --ssl-ca=/fixture/ca.pem --ssl-cert=/fixture/server.pem --ssl-key=/fixture/server.key --require-secure-transport=ON --mysqlx=0 --log-error=/tmp/mysql.err' | Out-Null
  Check 'Could not start isolated Oracle target.'
  for($attempt=0;$attempt -lt 180;$attempt++){
    & docker exec $db mysql --no-defaults --protocol=socket --socket=/var/run/mysqld/mysqld.sock --batch -e 'SELECT purpose FROM pluton_restore_guard.contract' 2>$null | Out-Null
    if($LASTEXITCODE -eq 0){break};if($attempt -eq 179){throw 'Isolated target readiness failed.'};Start-Sleep -Milliseconds 250
  }
  Start-Worker
  $scenarios=if($CancellationOnly){@('cancel-repeat')}elseif($CoreLifecycleOnly){@('success','resume','coexist','ttl')}else{@('success','resume','coexist','ttl','invalid-metadata','wrong-engine','oversize','bad-digest','sql-failure','invalid-marker','existing-database','wrong-password','bad-tls','worker-approval-missing','cancel-repeat','restart','app-interrupted','app-reconcile','unavailable','startup-failure')}
  foreach($mode in $scenarios){
    if($mode -in @('wrong-password','bad-tls','worker-approval-missing','cancel-repeat')){
      & docker rm -f $worker | Out-Null;Prepare $mode;Start-Worker
    }
    if($mode -eq 'invalid-marker'){Fixture-Sql "UPDATE pluton_restore_guard.contract SET purpose='not-persistent';"}
    if($mode -eq 'existing-database'){Fixture-Sql 'CREATE DATABASE example_db; CREATE TABLE example_db.protected_fixture(id INT); INSERT INTO example_db.protected_fixture VALUES(1);'}
    if($mode -eq 'unavailable'){& docker stop $worker | Out-Null;Check 'Worker unavailable fixture failed.'}
    if($mode -eq 'startup-failure'){& docker rm -f $worker | Out-Null;Prepare 'startup-failure';Start-Worker -ExpectRefusal}
    & docker run --rm --network none --user '10001:10001' --entrypoint node --mount "type=volume,source=$state,target=/state" $WorkerImage -e "require('fs').rmSync('/state/ready',{force:true})"
    Check 'Fixture signal reset failed.'
    & docker run -d --name $app --init --network none --read-only --user '10001:10001' --cap-drop ALL --security-opt no-new-privileges --memory 1536m --memory-swap 1536m --cpus 1 --pids-limit 96 --tmpfs '/tmp:rw,noexec,nosuid,nodev,uid=10001,gid=10001,mode=700,size=32m' --tmpfs '/data:rw,noexec,nosuid,nodev,uid=10001,gid=10001,mode=700,size=16m' -e PLUTON_MYSQL_WORKER=enabled --mount "type=volume,source=$ipc,target=/run/pluton-mysql-worker,readonly" --mount "type=volume,source=$approval,target=/run/pluton-persistent-restores,readonly" --mount "type=volume,source=$state,target=/fixture-state" --mount "type=bind,source=$code,target=/fixture-code,readonly" @applicationCode --entrypoint node $RuntimeImage --loader /app/backend/loader.mjs /fixture-code/mysqlPersistentRestore.smoke.mjs $mode | Out-Null
    Check 'Could not start non-root application fixture.'
    if($mode -in @('restart','app-interrupted')){
      for($attempt=0;$attempt -lt 150;$attempt++){
        & docker exec $app node -e "process.exit(require('fs').existsSync('/fixture-state/ready')?0:1)" 2>$null
        if($LASTEXITCODE -eq 0){break};Start-Sleep -Milliseconds 100
      };if($attempt -eq 150){throw 'Restart import stage not reached.'}
      & docker exec $worker node /fixture-code/mysqlRecoveryWorker.observe.mjs;Check 'Private credential/process inspection failed.'
      if($mode -eq 'restart'){& docker restart -t 0 $worker | Out-Null;Check 'Disposable worker restart failed.'}
      else{& docker kill $app | Out-Null;Check 'Disposable interrupted application fixture failed.'}
    }
    $exit=& docker wait $app;& docker logs $app
    if($exit -ne $(if($mode -eq 'app-interrupted'){'137'}else{'0'})){
      & docker logs $worker 2>&1 | Select-String -Pattern 'mysql_recovery_worker_failed'
      throw "MySQL persistent integration failed: $mode"
    }
    & docker rm $app | Out-Null
    if($mode -eq 'invalid-marker'){Fixture-Sql "UPDATE pluton_restore_guard.contract SET purpose='pluton-persistent-database-restore-v1';"}
    if($mode -eq 'existing-database'){Fixture-Sql 'SET @n=(SELECT COUNT(*) FROM example_db.protected_fixture); CREATE TEMPORARY TABLE pluton_restore_guard.fixture_assertion(passed INT CHECK(passed=1)); INSERT INTO pluton_restore_guard.fixture_assertion VALUES(IF(@n=1,1,0)); DROP DATABASE example_db;'}
    if($mode -notin @('unavailable','startup-failure','app-interrupted')){
      & docker exec $worker node -e "if(require('fs').readdirSync('/tmp').some(n=>n.startsWith('pluton-mysql-')))process.exit(1)";Check 'Worker private staging not cleaned.'
    }
  }
  $cancelSummary=if($scenarios -contains 'cancel-repeat'){', including 20 preflight + 20 import cancellations'}else{''}
  Write-Output "PASS $($scenarios.Count) real Oracle MySQL persistent cases$cancelSummary; no privileged mount fixture."
}finally{
  if($scope -notmatch '^pluton-mysql-persistent-[a-f0-9]{32}$'){throw 'Unsafe fixture cleanup target.'}
  foreach($name in @($app,$worker,$db)){& docker rm -f $name 2>$null | Out-Null}
  foreach($volume in $volumes){& docker volume rm $volume 2>$null | Out-Null}
  & docker network rm $network 2>$null | Out-Null
}
