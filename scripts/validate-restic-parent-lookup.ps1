param(
    [string]$Image = 'pluton-restic-parent-tests:local',
    [switch]$BaselineOnly
)
# Local disposable fixture only. Build agent/dist first and the fixture image with:
# docker build -f agent/test-fixtures/restic-parent.Dockerfile -t pluton-restic-parent-tests:local .
# Base image setup is documented by the existing Phase 5/6 fixture instructions.
# Never mounts host data, credentials, a Docker socket, or production repositories.
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dockerArguments = @('run','--rm','--init','--network','none','--read-only','--user','node',
    '--tmpfs','/tmp:rw,exec,nosuid,nodev,size=512m')
foreach ($mapping in @(@('backend/__tests__/integration','/app/backend/__tests__/integration'), @('agent/dist','/app/agent/dist'))) {
    $fixtureSource = (Resolve-Path (Join-Path $repoRoot $mapping[0])).Path
    $dockerArguments += @('--mount',"type=bind,source=$fixtureSource,target=$($mapping[1]),readonly")
}
$dockerArguments += @($Image,'/app/backend/__tests__/integration/resticParentLookup.smoke.ts')
if ($BaselineOnly) { $dockerArguments += 'baseline' }
& docker @dockerArguments
if ($LASTEXITCODE -ne 0) { throw 'Disposable real SFTP parent lookup regression failed.' }
if ($BaselineOnly) { return }

# Real DB lifecycle, parent timeout fallback, plus exact-snapshot Phase 6 imports.
$fixtureKey = [Guid]::NewGuid().ToString('N')
$fixturePassword = [Guid]::NewGuid().ToString('N')
$dockerArguments = @('run','--rm','--init','--network','none','--read-only','--user','node',
    '--tmpfs','/tmp:rw,exec,nosuid,nodev,size=1536m',
    '--tmpfs','/data:rw,noexec,nosuid,nodev,uid=1000,gid=1000,mode=700,size=64m',
    '-e','NODE_ENV=test','-e','PLUTON_DATA_DIR=/data','-e','PLUTON_RECOVERY_NATIVE_FIXTURE=1',
    '-e',"ENCRYPTION_KEY=$fixtureKey",'-e','USER_NAME=fixture-admin','-e',"USER_PASSWORD=$fixturePassword")
foreach ($mapping in @(@('backend/src','/app/backend/src'), @('backend/__tests__','/app/backend/__tests__'),
    @('backend/drizzle','/app/backend/drizzle'), @('agent/dist','/app/agent/dist'), @('agent/package.json','/app/agent/package.json'))) {
    $fixtureSource = (Resolve-Path (Join-Path $repoRoot $mapping[0])).Path
    $dockerArguments += @('--mount',"type=bind,source=$fixtureSource,target=$($mapping[1]),readonly")
}
$dockerArguments += @($Image,'/app/backend/__tests__/integration/phase5Database.smoke.ts','phase6-mariadb','parent-fallback')
& docker @dockerArguments
if ($LASTEXITCODE -ne 0) { throw 'Disposable DB lifecycle and parent timeout recovery regression failed.' }
