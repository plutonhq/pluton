param([string]$Image = 'pluton-phase5-real-db:local', [string]$InstallerImage = 'node:20-bookworm-slim')
# Disposable native Restic only. No production repository, host network, or data mount.
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$fixtureArguments = @('run','--rm','--init','--network','none','--read-only','--user','node','--tmpfs','/tmp:rw,exec,nosuid,nodev,size=512m')
foreach ($mapping in @(@('backend/__tests__/integration','/app/backend/__tests__/integration'), @('agent/dist','/app/agent/dist'))) {
    $fixtureSource = (Resolve-Path (Join-Path $repoRoot $mapping[0])).Path
    $fixtureArguments += @('--mount',"type=bind,source=$fixtureSource,target=$($mapping[1]),readonly")
}
$fixtureArguments += @($Image, '/app/backend/__tests__/integration/resticIncremental.smoke.ts')
& docker @fixtureArguments
if ($LASTEXITCODE -ne 0) { throw 'Disposable native incremental regression failed.' }

# Historical helper/CDN installers must stop before any download or system mutation.
foreach ($installer in @('installers/linux-server/install.sh','installers/linux-server/install_dev.sh','installers/linux/AppDir/usr/share/pluton/install.sh')) {
    $fixtureSource = (Resolve-Path (Join-Path $repoRoot $installer)).Path
    $fixtureArguments = @('run','--rm','--network','none','--read-only','--user','node', '--mount',"type=bind,source=$fixtureSource,target=/fixture.sh,readonly",'--entrypoint','sh',$InstallerImage,'-c','output=$(sed ''s/\r$//'' /fixture.sh | bash 2>&1); status=$?; [ "$status" -eq 1 ] && printf ''%s'' "$output" | grep -q ''disabled'' && printf ''%s'' "$output" | grep -q ''/docs/deployment/docker''')
    & docker @fixtureArguments
    if ($LASTEXITCODE -ne 0) { throw "Historical installer did not stop safely: $installer" }
    Write-Output "PASS historical installer disabled before side effects: $installer"
}
