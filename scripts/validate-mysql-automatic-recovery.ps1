param([string]$RuntimeImage='pluton-persistent-ci:local',[string]$WorkerImage='pluton-mysql-internal-worker:review',
  [ValidateSet('disposable','persistent')][string]$Mode='disposable',
  [switch]$WorkingTreeCode,
  [ValidateSet('success','wrong-password','bad-tls','invalid-marker','existing-database','cancel')][string[]]$Scenarios=@('success','wrong-password','bad-tls','invalid-marker','existing-database','cancel'))
# Nonprivileged containers only: no Docker socket, host mount/loop/systemd operations or host ports.
# Bounded tmpfs proves native compatibility, NOT production ext4/ENOSPC/cold-boot acceptance.
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$context=& docker context inspect --format '{{.Endpoints.docker.Host}}'
if($LASTEXITCODE -ne 0 -or $context -notmatch '^(npipe|unix)://'){throw 'Local disposable Docker fixture only.'}
$image='mysql:8.4.11@sha256:24989179f58856db763f418010c1169fecc944e3ec1ea7e921572d83eb070f70'
$applicationCode=@()
if($WorkingTreeCode){$applicationCode=@('--mount',"type=bind,source=$(Join-Path $repo 'backend/dist'),target=/app/backend/dist,readonly",
  '--mount',"type=bind,source=$(Join-Path $repo 'backend/drizzle'),target=/app/drizzle,readonly")}
function Check([string]$message){if($LASTEXITCODE -ne 0){throw $message}}
foreach($scenario in $Scenarios){
  $scope='pluton-mysql-auto-'+[Guid]::NewGuid().ToString('N');$db="$scope-db";$worker="$scope-worker";$app="$scope-app"
  $created=@();$network=$false;$containers=@();$names=@{}
  foreach($name in @('config','boot','public','state','lock','ipc','db-data')){$names[$name]="$scope-$name"}
  try{
    & docker network create --internal --label "org.pluton.fixture=$scope" $scope | Out-Null;Check 'Private network failed.';$network=$true
    foreach($key in $names.Keys){
      $volumeArgs=@('volume','create','--label',"org.pluton.fixture=$scope")
      if($key -eq 'db-data'){$volumeArgs+=@('--driver','local','--opt','type=tmpfs','--opt','device=tmpfs','--opt','o=size=2g,uid=999,gid=999,mode=700,noexec,nosuid,nodev')}
      & docker @volumeArgs $names[$key] | Out-Null;Check 'Fixture volume failed.';$created+=$names[$key]
    }
    $prepare=@('run','--rm','--network','none','--read-only','--user','0:0','--cap-drop','ALL','--cap-add','CHOWN','--cap-add','FOWNER',
      '--security-opt','no-new-privileges:true','--memory','256m','--pids-limit','32','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=16m',
      '--mount',"type=bind,source=$(Join-Path $repo 'deploy'),target=/fixture-deploy,readonly",
      '--mount',"type=bind,source=$(Join-Path $repo 'backend/__tests__/integration/mysqlAutomaticRecovery.prepare.mjs'),target=/fixture-code/prepare.mjs,readonly")
    foreach($name in @('config','boot','public','state','lock')){$prepare+=@('--mount',"type=volume,source=$($names[$name]),target=/$name")}
    & docker @prepare --entrypoint node $WorkerImage /fixture-code/prepare.mjs $Mode $scenario;Check 'Private fixture preparation failed.'
    $hostName=& docker run --rm --network none --read-only --user '10001:10001' --cap-drop ALL --mount "type=volume,source=$($names.public),target=/fixture/public,readonly" --entrypoint node $WorkerImage -e "console.log(JSON.parse(require('fs').readFileSync('/fixture/public/context.json')).approval.target.host)"
    Check 'Synthetic endpoint read failed.'
    if($hostName -notmatch '^persistent-db-[a-f0-9]{24}$'){throw 'Unexpected fixture endpoint.'}
    # Separate TEST authority publishes real, fresh measurements of its own
    # bounded cgroup. It has no Docker socket, host paths, keys or mount privilege.
    $observer="$scope-observer"
    & docker run -d --pull never --name $observer --network none --read-only --user '0:0' --cap-drop ALL --cap-add CHOWN --security-opt no-new-privileges:true --memory 4g --memory-swap 4g --cpus 2 --pids-limit 32 --label "org.pluton.fixture=$scope" --mount "type=volume,source=$($names.public),target=/fixture/images" --mount "type=bind,source=$(Join-Path $repo 'deploy'),target=/fixture-deploy,readonly" --mount "type=bind,source=$(Join-Path $repo 'backend/__tests__/integration/mysqlAutomaticRecovery.observe.mjs'),target=/fixture-code/observe.mjs,readonly" --entrypoint node $WorkerImage /fixture-code/observe.mjs | Out-Null
    Check 'Bounded fixture observation failed.';$containers+=$observer
    for($attempt=0;$attempt -lt 50;$attempt++){
      & docker exec $observer node -e "process.exit(require('fs').existsSync('/fixture/images/capacity.json')?0:1)" 2>$null
      if($LASTEXITCODE -eq 0){break};Start-Sleep -Milliseconds 100
    };if($attempt -eq 50){throw 'Fixture observation unavailable.'}
    # Keep a hard-bounded TEST tmpfs mounted across DB Stop/Resume. This is not
    # the production ext4 driver, nor a fallback for the real host operator.
    $holder="$scope-storage"
    & docker run -d --pull never --name $holder --network none --read-only --user '999:999' --cap-drop ALL --security-opt no-new-privileges:true --memory 32m --pids-limit 16 --label "org.pluton.fixture=$scope" --mount "type=volume,source=$($names['db-data']),target=/fixture-db-data" --entrypoint node $WorkerImage -e 'setInterval(()=>{},1000)' | Out-Null
    Check 'Bounded storage holder failed.';$containers+=$holder
    & docker create --pull never --init --name $db --network $scope --network-alias $hostName --user '999:999' --read-only --cap-drop ALL --security-opt no-new-privileges:true --memory 2g --memory-swap 2g --cpus 1 --pids-limit 128 --label "org.pluton.fixture=$scope" --mount "type=volume,source=$($names['db-data']),target=/var/lib/mysql" --tmpfs '/tmp:rw,noexec,nosuid,nodev,uid=999,gid=999,mode=700,size=128m' --mount "type=volume,source=$($names.config),target=/run/pluton-persistent-bootstrap,readonly" --mount "type=volume,source=$($names.boot),target=/opt/pluton-persistent,readonly" --mount "type=volume,source=$($names.lock),target=/run/pluton-internal-lock" --entrypoint /bin/bash $image /opt/pluton-persistent/start.sh | Out-Null
    Check 'Native target creation failed.';$containers+=$db
    & docker start $db | Out-Null;Check 'Native target start failed.'
    $ready=$false
    for($attempt=0;$attempt -lt 120;$attempt++){
      & docker exec --user '999:999' $db mysql --defaults-file=/run/pluton-persistent-bootstrap/ready.cnf --connect-timeout=1 --execute 'SELECT 1' 2>$null | Out-Null
      if($LASTEXITCODE -eq 0){$ready=$true;break}
      if((& docker inspect --format '{{.State.Running}}' $db) -ne 'true'){
        & docker logs $db 2>&1 | Select-String '^persistent-target-(failed|engine-busy|started)'
        $exitCode=& docker inspect --format '{{.State.ExitCode}}' $db
        throw "Oracle bootstrap stopped (exit=$exitCode); raw provider output withheld."
      }
      Start-Sleep -Milliseconds 500
    }
    if(-not $ready){throw 'Oracle readiness timed out.'}
    $memoryPolicy=& docker exec --user '999:999' $db mysql --defaults-file=/run/pluton-persistent-bootstrap/ready.cnf --batch --skip-column-names --execute 'SELECT @@performance_schema,@@innodb_log_buffer_size;'
    Check 'Bounded Oracle memory policy could not be verified.'
    if($memoryPolicy.Trim() -ne "0`t8388608"){throw 'Unexpected Oracle instrumentation/log-buffer memory policy.'}
    # Prove the Oracle Python adapter retains the SAME kernel lock in Bash.
    & docker exec --user '999:999' $db /bin/bash /opt/pluton-persistent/bootstrap.sh mysql 2>$null | Out-Null
    if($LASTEXITCODE -ne 71){throw 'Concurrent Oracle bootstrap was not refused by the shared kernel lock.'}
    & docker exec --user '999:999' $db mysql --no-defaults --socket=/tmp/database.sock -uroot --execute 'SELECT 1' 2>$null | Out-Null
    if($LASTEXITCODE -eq 0){throw 'Bootstrap root account must be locked before network startup.'}
    & docker run -d --pull never --init --name $worker --network $scope --read-only --user '10001:10001' --cap-drop ALL --security-opt no-new-privileges:true --memory 384m --memory-swap 384m --cpus 0.5 --pids-limit 64 --label "org.pluton.fixture=$scope" --tmpfs '/tmp:rw,noexec,nosuid,nodev,uid=10001,gid=10001,mode=700,size=160m' --mount "type=volume,source=$($names.ipc),target=/run/pluton-mysql-worker" --mount "type=volume,source=$($names.public),target=/run/pluton-mysql-config,readonly" --mount "type=volume,source=$($names.public),target=/run/pluton-mysql-internal,readonly" $WorkerImage | Out-Null
    Check 'Private worker start failed.';$containers+=$worker
    for($attempt=0;$attempt -lt 60;$attempt++){
      & docker exec $worker node -e "process.exit(require('fs').existsSync('/run/pluton-mysql-worker/worker.sock')?0:1)" 2>$null
      if($LASTEXITCODE -eq 0){break};Start-Sleep -Milliseconds 100
    };if($attempt -eq 60){throw 'Worker startup failed.'}
    & docker create --init --name $app --network none --read-only --user '10001:10001' --cap-drop ALL --security-opt no-new-privileges:true --memory 768m --memory-swap 768m --pids-limit 64 --label "org.pluton.fixture=$scope" --tmpfs '/tmp:rw,noexec,nosuid,nodev,uid=10001,gid=10001,mode=700,size=16m' --tmpfs '/data:rw,noexec,nosuid,nodev,uid=10001,gid=10001,mode=700,size=16m' -e PLUTON_MYSQL_WORKER=enabled --mount "type=volume,source=$($names.ipc),target=/run/pluton-mysql-worker,readonly" --mount "type=volume,source=$($names.public),target=/fixture/public,readonly" --mount "type=volume,source=$($names.public),target=/run/pluton-automatic-recovery,readonly" --mount "type=volume,source=$($names.state),target=/fixture/state" @applicationCode --mount "type=bind,source=$(Join-Path $repo 'backend/__tests__/integration/mysqlAutomaticRecovery.smoke.mjs'),target=/fixture-code/smoke.mjs,readonly" --entrypoint node $RuntimeImage --loader /app/backend/loader.mjs /fixture-code/smoke.mjs | Out-Null
    Check 'Application fixture creation failed.';$containers+=$app
    if($Mode -eq 'persistent' -and $scenario -eq 'success'){
      & docker start $app | Out-Null;Check 'Retained fixture start failed.'
      for($attempt=0;$attempt -lt 200;$attempt++){
        & docker exec $app node -e "process.exit(require('fs').existsSync('/fixture/state/restart-requested')?0:1)" 2>$null
        if($LASTEXITCODE -eq 0){break}
        if((& docker inspect --format '{{.State.Running}}' $app) -ne 'true'){break}
        Start-Sleep -Milliseconds 100
      }
      if($attempt -eq 200){throw 'Retained import stage not reached.'}
      $identity=& docker inspect --format '{{.Id}}' $db
      & docker stop --time 20 $db | Out-Null;Check 'Retained Stop failed.'
      & docker start $identity | Out-Null;Check 'Retained Resume failed.'
      if((& docker inspect --format '{{.Id}}' $db) -ne $identity){throw 'Retained identity changed.'}
      for($attempt=0;$attempt -lt 80;$attempt++){
        & docker exec --user '999:999' $db mysql --defaults-file=/run/pluton-persistent-bootstrap/ready.cnf --connect-timeout=1 --execute 'SELECT 1' 2>$null | Out-Null
        if($LASTEXITCODE -eq 0){break};Start-Sleep -Milliseconds 250
      };if($attempt -eq 80){throw 'Retained Resume readiness failed.'}
      & docker run --rm --network none --read-only --user '0:0' --cap-drop ALL --mount "type=volume,source=$($names.public),target=/proof" --entrypoint node $WorkerImage -e "const fs=require('fs');const id=JSON.parse(fs.readFileSync('/proof/context.json')).id;const file='/proof/'+id+'.receipt.json';const r=JSON.parse(fs.readFileSync(file));r.observedAt=Date.now();r.sequence++;fs.writeFileSync(file,JSON.stringify(r));"
      Check 'Fixture root receipt refresh failed.'
      & docker exec $app node -e "require('fs').writeFileSync('/fixture/state/restart-complete','ready',{mode:0o600})";Check 'Fixture Resume signal failed.'
      $exitCode=& docker wait $app
      & docker logs $app
    }else{
      & docker start -a $app
      $exitCode=$LASTEXITCODE
    }
    if($exitCode -ne 0){
      & docker logs $worker 2>&1 | Select-String '^\{"event":"mysql_recovery_worker_failed","stage":"[a-z-]+","code":"[a-z-]+"(?:,"category":"[a-z-]+")?\}$'
      throw 'Oracle Internal integration failed.'
    }
    & docker exec $worker node -e "if(require('fs').readdirSync('/tmp').some(n=>n.startsWith('pluton-mysql-')))process.exit(1)";Check 'Worker staging cleanup unverified.'
  }finally{
    foreach($name in $containers){
      $info=(& docker inspect $name | ConvertFrom-Json)[0]
      if($info.Config.Labels.'org.pluton.fixture' -ne $scope){throw 'Container ownership changed; cleanup refused.'}
      & docker rm -f $info.Id | Out-Null;Check 'Owned container cleanup failed.'
    }
    if($network){
      $info=(& docker network inspect $scope | ConvertFrom-Json)[0]
      if($info.Labels.'org.pluton.fixture' -ne $scope){throw 'Network ownership changed.'}
      & docker network rm $scope | Out-Null;Check 'Owned network cleanup failed.'
    }
    foreach($name in $created){
      $info=(& docker volume inspect $name | ConvertFrom-Json)[0]
      if($info.Labels.'org.pluton.fixture' -ne $scope){throw 'Volume ownership changed.'}
      & docker volume rm $name | Out-Null;Check 'Owned volume cleanup failed.'
    }
  }
}
Write-Output "PASS $($Scenarios.Count) Oracle MySQL $Mode cases. Privileged Linux host acceptance NOT performed."
