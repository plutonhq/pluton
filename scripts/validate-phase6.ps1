param(
    [string[]]$Modes = @('phase6-filesystem', 'phase6-mariadb', 'phase6-postgresql', 'phase6-mixed', 'phase6-mixed-failure'),
    [string]$Image = 'pluton-phase5-real-db:local',
    [switch]$BackendTests
)
# Disposable tests only. No host database, host network, live credentials or Docker socket mount.
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$fixtureKey = [Guid]::NewGuid().ToString('N')
$fixturePassword = [Guid]::NewGuid().ToString('N')
if ($BackendTests) { $Modes = @('backend-tests') }
foreach ($mode in $Modes) {
    if ($mode -notin @('single','two-mariadb','mixed','phase6-filesystem','phase6-mariadb','phase6-postgresql','phase6-mixed','phase6-mixed-failure','backend-tests')) { throw 'Unsupported disposable fixture mode.' }
    $dockerArguments = @('run','--rm','--init','--network','none','--read-only','--user','node',
        '--tmpfs','/tmp:rw,exec,nosuid,nodev,size=1536m',
        '--tmpfs','/data:rw,noexec,nosuid,nodev,uid=1000,gid=1000,mode=700,size=64m',
        '-e','NODE_ENV=test','-e','PLUTON_DATA_DIR=/data','-e','PLUTON_RECOVERY_NATIVE_FIXTURE=1',
        '-e',"ENCRYPTION_KEY=$fixtureKey",'-e','USER_NAME=fixture-admin','-e',"USER_PASSWORD=$fixturePassword")
    foreach ($mapping in @(@('backend/src','/app/backend/src'), @('backend/__tests__','/app/backend/__tests__'),
        @('backend/drizzle','/app/backend/drizzle'), @('deploy/persistent-restore','/app/deploy/persistent-restore'),
        @('agent/dist','/app/agent/dist'), @('agent/package.json','/app/agent/package.json'))) {
        $source = (Resolve-Path (Join-Path $repoRoot $mapping[0])).Path
        $dockerArguments += @('--mount',"type=bind,source=$source,target=$($mapping[1]),readonly")
    }
    if ($BackendTests) {
        $dockerArguments += @('--workdir','/app/backend','--entrypoint','/app/backend/node_modules/.bin/jest',
            $Image,'--config','jest.config.ts','--runInBand','--silent','--verbose=false',
            '__tests__/stores/RecoveryTestStore.test.ts','__tests__/services/RecoveryTestService.test.ts',
            '__tests__/utils/recoveryValidation.test.ts','__tests__/utils/recoveryDatabaseImport.test.ts',
            '__tests__/utils/recoveryDatabaseClients.test.ts','__tests__/utils/recoveryProcess.test.ts',
            '__tests__/routes/recoveryTests.test.ts','__tests__/services/RemoteRepositoryRecoveryService.test.ts',
            '__tests__/utils/restic/ManagedSftpRepositorySession.test.ts')
        $dockerArguments += @('__tests__/stores/DatabaseRestoreStore.test.ts','__tests__/routes/databaseRestores.test.ts','__tests__/utils/persistentDatabaseImporter.test.ts')
    } else {
        $dockerArguments += @($Image,'/app/backend/__tests__/integration/phase5Database.smoke.ts',$mode)
    }
    & docker @dockerArguments
    if ($LASTEXITCODE -ne 0) { throw "Disposable integration failed: $mode" }
}
