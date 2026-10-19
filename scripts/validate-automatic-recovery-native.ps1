param([string]$RuntimeImage='pluton-persistent-ci:local',[string]$HelperImage='pluton-mysql-persistent-worker:local',[switch]$WorkingTreeCode)
# Bounded container tmpfs ONLY. Native/SQL compatibility, NOT production ext4 acceptance.
# No privileged mode, added capabilities, Docker socket, host mount/loop operations or production access.
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$applicationCode=@()
if($WorkingTreeCode){$applicationCode=@('--mount',"type=bind,source=$(Join-Path $repo 'backend/dist'),target=/app/backend/dist,readonly",
  '--mount',"type=bind,source=$(Join-Path $repo 'backend/drizzle'),target=/app/drizzle,readonly")}
$context=& docker context inspect --format '{{.Endpoints.docker.Host}}'
if($LASTEXITCODE -ne 0 -or $context -notmatch '^(npipe|unix)://'){throw 'Local Docker fixture only.'}
$images=@{mariadb='mariadb:11.8.8@sha256:24e76fcec8c003a0362d0dd53f4806e7e79458d7fdeaf47437760e19496f5a9c';postgresql='postgres:18.6-bookworm@sha256:afc7e2d441324c0388fa80c3d24f733b4194a4eb7f47dd8ee2b08eb1a24a647c'}
function Check([string]$message){if($LASTEXITCODE -ne 0){throw $message}}
foreach($engine in @('mariadb','postgresql')){foreach($mode in @('disposable','persistent')){
  $scope='pluton-auto-native-'+[Guid]::NewGuid().ToString('N');$db="$scope-db";$app="$scope-app";$created=@();$network=$false;$dbCreated=$false
  $names=@{};foreach($name in @('config','public','boot','state','lock')){$names[$name]="$scope-$name"}
  try{
    & docker network create --internal $scope | Out-Null;Check 'Private fixture network failed.';$network=$true
    foreach($name in $names.Values){& docker volume create --label "org.pluton.fixture=$scope" $name | Out-Null;Check 'Private volume failed.';$created+=$name}
    $prepare=@('run','--rm','--network','none','--read-only','--user','0:0','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=32m',
      '--mount',"type=bind,source=$(Join-Path $repo 'deploy/persistent-restore/operator.cjs'),target=/fixture-deploy/persistent-restore/operator.cjs,readonly",
      '--mount',"type=bind,source=$(Join-Path $repo 'deploy/persistent-restore/storage.cjs'),target=/fixture-deploy/persistent-restore/storage.cjs,readonly",
      '--mount',"type=bind,source=$(Join-Path $repo 'deploy/persistent-restore/bootstrap.sh'),target=/fixture-deploy/persistent-restore/bootstrap.sh,readonly",
      '--mount',"type=bind,source=$(Join-Path $repo 'deploy/automatic-recovery/operator.cjs'),target=/fixture-deploy/automatic-recovery/operator.cjs,readonly",
      '--mount',"type=bind,source=$(Join-Path $repo 'deploy/automatic-recovery/systemdStorage.cjs'),target=/fixture-deploy/automatic-recovery/systemdStorage.cjs,readonly",
      '--mount',"type=bind,source=$(Join-Path $repo 'backend/__tests__/integration/automaticRecoveryNative.prepare.mjs'),target=/fixture-code/automaticRecoveryNative.prepare.mjs,readonly")
    foreach($name in $names.Keys){$prepare+=@('--mount',"type=volume,source=$($names[$name]),target=/$name")}
    & docker @prepare --entrypoint node $HelperImage /fixture-code/automaticRecoveryNative.prepare.mjs $engine $mode
    Check 'Native lifecycle preparation failed.'
    $base=if($engine -eq 'mariadb'){'/var/lib/mysql'}else{'/var/lib/postgresql'}
    & docker create --pull never --init --name $db --network $scope --network-alias auto-native-db --user '999:999' --read-only --cap-drop ALL --security-opt no-new-privileges:true --memory 2g --memory-swap 2g --cpus 1 --pids-limit 128 --label "org.pluton.fixture=$scope" --tmpfs ($base+':rw,noexec,nosuid,nodev,uid=999,gid=999,mode=700,size=2g') --tmpfs '/tmp:rw,noexec,nosuid,nodev,uid=999,gid=999,mode=700,size=128m' --mount "type=volume,source=$($names['config']),target=/run/pluton-persistent-bootstrap,readonly" --mount "type=volume,source=$($names['boot']),target=/opt/pluton-native,readonly" --mount "type=volume,source=$($names['lock']),target=/run/pluton-internal-lock" --entrypoint /bin/bash $images[$engine] /opt/pluton-native/start.sh $engine | Out-Null
    Check 'Native target creation failed.';$dbCreated=$true
    & docker start $db | Out-Null;Check 'Native target start failed.'
    $ready=$false
    for($attempt=0;$attempt -lt 160;$attempt++){
      $messages=@(& docker logs $db 2>$null | Where-Object {$_ -eq 'persistent-target-started'})
      if($messages.Count -gt 0){$ready=$true;break}
      $running=& docker inspect --format '{{.State.Running}}' $db
      if($running -ne 'true'){throw 'Native bootstrap stopped; no raw provider output printed.'}
      Start-Sleep -Milliseconds 500
    }
    if(-not $ready){throw 'Native target readiness deadline exceeded.'}
    $info=(& docker inspect $db | ConvertFrom-Json)[0]
    if($info.HostConfig.Privileged -or $info.Config.User -ne '999:999' -or @($info.HostConfig.PortBindings.PSObject.Properties).Count){throw 'Target isolation refused.'}
    & docker run --rm --init --name $app --network $scope --read-only --user '10001:10001' --cap-drop ALL --security-opt no-new-privileges:true --memory 1536m --memory-swap 1536m --tmpfs '/tmp:rw,noexec,nosuid,nodev,uid=10001,gid=10001,mode=700,size=32m' --tmpfs '/data:rw,noexec,nosuid,nodev,uid=10001,gid=10001,mode=700,size=16m' --mount "type=volume,source=$($names['public']),target=/fixture/public,readonly" --mount "type=volume,source=$($names['state']),target=/fixture/state" @applicationCode --mount "type=bind,source=$(Join-Path $repo 'backend/__tests__/integration/automaticRecoveryNative.smoke.mjs'),target=/fixture-code/automaticRecoveryNative.smoke.mjs,readonly" --entrypoint node $RuntimeImage --loader ./backend/loader.mjs /fixture-code/automaticRecoveryNative.smoke.mjs
    Check 'Native SQL lifecycle assertions failed.'
  }finally{
    if($dbCreated){
      $info=(& docker inspect $db | ConvertFrom-Json)[0]
      if($info.Config.Labels.'org.pluton.fixture' -ne $scope){throw 'Fixture ownership changed; cleanup refused.'}
      & docker stop --time 20 $info.Id | Out-Null;Check 'Owned fixture stop failed.'
      & docker rm $info.Id | Out-Null;Check 'Owned fixture removal failed.'
    }
    if($network){& docker network rm $scope | Out-Null;Check 'Private fixture network cleanup failed.'}
    foreach($name in $created){
      $info=(& docker volume inspect $name | ConvertFrom-Json)[0]
      if($info.Labels.'org.pluton.fixture' -ne $scope){throw 'Fixture volume ownership changed.'}
      & docker volume rm $name | Out-Null;Check 'Private fixture volume cleanup failed.'
    }
  }
}}
Write-Output 'PASS 4 unprivileged native lifecycle cases; host quota/mount acceptance NOT claimed.'
