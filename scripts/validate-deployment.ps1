param([string]$Image = 'pluton-deploy-hardening:local', [string]$DriverImage = 'pluton-deployment-driver:local')
# Explicitly authorized local test-driver socket ONLY. Never mount it in Pluton.
$ErrorActionPreference = 'Stop'
if ($env:DOCKER_HOST -and $env:DOCKER_HOST -notmatch '^(npipe|unix)://') { throw 'Only a local Docker endpoint is allowed.' }
$endpoint = & docker context inspect --format '{{.Endpoints.docker.Host}}'
if ($LASTEXITCODE -ne 0 -or $endpoint -notmatch '^(npipe|unix)://') { throw 'Only a local Docker context is allowed.' }
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$fixtureVolume = 'pluton-deployment-driver-' + [Guid]::NewGuid().ToString('N')
try {
    & docker volume create $fixtureVolume | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot create disposable driver workspace.' }
    $mountpoint = (& docker volume inspect --format '{{.Mountpoint}}' $fixtureVolume).Trim()
    if ($LASTEXITCODE -ne 0 -or $mountpoint -notmatch '^/var/lib/docker/volumes/pluton-deployment-driver-[a-f0-9]{32}/_data$') { throw 'Unexpected local fixture mountpoint.' }
    $arguments = @('run','--rm','--init','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true',
        '--tmpfs','/tmp:rw,noexec,nosuid,nodev,mode=1777,size=64m',
        '--tmpfs','/root/.docker:rw,noexec,nosuid,nodev,mode=700,size=16m',
        '--mount','type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock',
        '--mount',"type=volume,source=$fixtureVolume,target=$mountpoint",
        '--mount',"type=bind,source=$root/deploy,target=/reviewed/deploy,readonly",
        '--mount',"type=bind,source=$root/scripts,target=/reviewed/scripts,readonly",
        '-e',"PLUTON_DEPLOY_FIXTURE_ROOT=$mountpoint",$DriverImage,
        '/reviewed/scripts/validate-deployment.py',$Image)
    & docker @arguments
    if ($LASTEXITCODE -ne 0) { throw 'Disposable deployment/rollback acceptance failed.' }
} finally {
    # Only the exact random local driver workspace, never any application volume.
    & docker volume rm $fixtureVolume | Out-Null
}
