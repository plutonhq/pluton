param([string]$FixtureImage='pluton-persistent-operator-fixture:local',[string]$RuntimeImage='pluton-persistent-ci:local',[switch]$BuildFixture,
  [ValidateSet('mariadb','postgresql')][string[]]$Engines=@('mariadb','postgresql'),
  [ValidateSet('internal','custom')][string[]]$Modes=@('internal','custom'),
  [switch]$AllowLocalMountFixture,[switch]$QuotaOnly)
# Explicitly authorized LOCAL operator fixture only, never an application/worker privilege.
if(-not $AllowLocalMountFixture){throw 'This operator mount/loop fixture requires explicit local authorization.'}
$context=& docker context inspect --format '{{.Endpoints.docker.Host}}'
if($LASTEXITCODE -ne 0 -or $context -notmatch '^(npipe|unix)://'){throw 'Only a local Docker endpoint is allowed.'}
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dist=Join-Path $repo 'backend/dist';$migrations=Join-Path $repo 'backend/drizzle'
if(-not (Test-Path -LiteralPath (Join-Path $dist 'utils/persistentDatabaseImporter.js'))){throw 'Build the backend first.'}
if($BuildFixture){
  & docker build --load -f (Join-Path $repo 'backend/__tests__/fixtures/persistent-restore/Dockerfile') --build-arg "RUNTIME_IMAGE=$RuntimeImage" -t $FixtureImage $repo
  if($LASTEXITCODE -ne 0){throw 'Disposable native fixture build failed.'}
}
$matrix=@([pscustomobject]@{engine='quota';mode='quota'})
if(-not $QuotaOnly){foreach($engine in $Engines){foreach($mode in $Modes){$matrix+=[pscustomobject]@{engine=$engine;mode=$mode}}}}
foreach($case in $matrix){
  $engine=$case.engine;$mode=$case.mode;$scope='pluton-retained-fixture-'+[Guid]::NewGuid().ToString('N');$volume="$scope-state";$created=$false
  try {
    & docker volume create --label org.pluton.fixture=persistent-restore $volume | Out-Null
    if($LASTEXITCODE -ne 0){throw 'Fixture volume creation failed.'};$created=$true
    $args=@('run','--rm','--name',$scope,'--init','--network','none','--read-only','--user','0:0',
      '--cap-add','SYS_ADMIN','--device','/dev/loop-control','--device-cgroup-rule','b 7:* rwm','--security-opt','apparmor=unconfined',
      '--memory','2g','--memory-swap','2g','--cpus','1','--pids-limit','128',
      '--tmpfs','/tmp:rw,nosuid,nodev,size=128m','--tmpfs','/run:rw,noexec,nosuid,nodev,size=32m',
      '--tmpfs','/data:rw,noexec,nosuid,nodev,uid=10001,gid=10001,mode=700,size=16m',
      '--tmpfs','/etc/pluton-persistent-restores:rw,noexec,nosuid,nodev,mode=755,size=4m',
      '--add-host',('persistent-db-'+('a'*24)+':127.0.0.1'),'--mount',"type=volume,source=$volume,target=/fixture/state",
      '--mount',"type=bind,source=$dist,target=/app/backend/dist,readonly",
      '--mount',"type=bind,source=$migrations,target=/app/drizzle,readonly")
    if($engine -eq 'quota'){
      & docker @args $FixtureImage
      if($LASTEXITCODE -ne 0){throw 'Actual quota test failed.'}
    }else{
      # Separate containers, same bounded on-disk image and SQLite state: not merely a process restart.
      foreach($phase in @('import','inspect-delete')){
        & docker @args --entrypoint node $FixtureImage /fixture/native-smoke.cjs $engine $phase $mode
        if($LASTEXITCODE -ne 0){throw "Persistent $engine $mode $phase fixture failed."}
      }
    }
  }finally{
    # Only the exact generated fixture is stopped/removed; application/production resources are never enumerated.
    $present=& docker container ls -aq --filter "name=^/$scope$"
    if($LASTEXITCODE -eq 0 -and $present){& docker rm -f $present | Out-Null}
    if($created){& docker volume rm $volume | Out-Null;if($LASTEXITCODE -ne 0){Write-Warning 'Fixture volume retained; investigate its mount before removing it.'}}
  }
}
