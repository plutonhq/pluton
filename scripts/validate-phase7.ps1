param([string]$Image = 'pluton-phase6-tests:local')
# No host network/ports, real credentials, Docker socket, or production volumes.
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$fixtureNetwork = 'pluton-phase7-' + [Guid]::NewGuid().ToString('N')
$fixtureCertificateDirectory = Join-Path ([IO.Path]::GetTempPath()) ('pluton-phase7-certificate-' + [Guid]::NewGuid().ToString('N'))
if ($fixtureNetwork -notmatch '^pluton-phase7-[a-f0-9]{32}$') { throw 'Invalid disposable network target.' }
& docker network create --internal $fixtureNetwork | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not create the isolated notification fixture network.' }
try {
    # Ephemeral synthetic CA/key only; never committed or added to host trust.
    New-Item -ItemType Directory -Path $fixtureCertificateDirectory | Out-Null
    $fixtureRsa = [Security.Cryptography.RSA]::Create(2048)
    $fixtureRequest = [Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=smtp.example.internal', $fixtureRsa, [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $fixtureSan = [Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
    $fixtureSan.AddDnsName('smtp.example.internal')
    $fixtureRequest.CertificateExtensions.Add($fixtureSan.Build())
    $fixtureRequest.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true,$false,0,$true))
    $fixtureCertificate = $fixtureRequest.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5),[DateTimeOffset]::UtcNow.AddDays(1))
    [IO.File]::WriteAllText((Join-Path $fixtureCertificateDirectory 'cert.pem'), $fixtureCertificate.ExportCertificatePem())
    [IO.File]::WriteAllText((Join-Path $fixtureCertificateDirectory 'key.pem'), $fixtureRsa.ExportPkcs8PrivateKeyPem())
    $fixtureCertificate.Dispose()
    $fixtureRsa.Dispose()
    $dockerArguments = @('run','--rm','--init','--network',$fixtureNetwork,'--read-only','--user','node',
        '--tmpfs','/tmp:rw,exec,nosuid,nodev,size=512m',
        '--tmpfs','/data:rw,noexec,nosuid,nodev,uid=1000,gid=1000,mode=700,size=64m',
        '-e','NODE_ENV=test','-e','PHASE7_FIXTURE_CA_SOURCE=/fixture-certificates',
        '--mount',"type=bind,source=$fixtureCertificateDirectory,target=/fixture-certificates,readonly",
        '--workdir','/app/backend','--entrypoint','node')
    foreach ($mapping in @(@('backend/src','/app/backend/src'), @('backend/__tests__','/app/backend/__tests__'), @('backend/drizzle','/app/backend/drizzle'))) {
        $fixtureSource = (Resolve-Path (Join-Path $repoRoot $mapping[0])).Path
        $dockerArguments += @('--mount',"type=bind,source=$fixtureSource,target=$($mapping[1]),readonly")
    }
    $dockerArguments += @($Image,'--import','tsx','/app/backend/__tests__/integration/phase7Notifications.smoke.ts')
    & docker @dockerArguments
    if ($LASTEXITCODE -ne 0) { throw 'Isolated Phase 7 integration failed.' }
} finally {
    & docker network rm $fixtureNetwork | Out-Null
    $fixtureAbsolute = [IO.Path]::GetFullPath($fixtureCertificateDirectory)
    $fixtureParent = [IO.Path]::GetDirectoryName($fixtureAbsolute).TrimEnd('\','/')
    $fixtureTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\','/')
    if ($fixtureParent -ne $fixtureTempRoot -or [IO.Path]::GetFileName($fixtureAbsolute) -notmatch '^pluton-phase7-certificate-[a-f0-9]{32}$') { throw 'Refusing unsafe fixture certificate cleanup.' }
    if (Test-Path -LiteralPath $fixtureAbsolute) { Remove-Item -LiteralPath $fixtureAbsolute -Recurse -Force }
}
