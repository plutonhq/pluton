param([string]$Image = 'pluton-phase6-tests:local', [switch]$Compiled)
# Disposable namespace only: no host listener/network, Docker socket, real data or production volumes.
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$fixtureCertificates = Join-Path ([IO.Path]::GetTempPath()) ('pluton-dual-origin-' + [Guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $fixtureCertificates | Out-Null
    $fixtureRsa = [Security.Cryptography.RSA]::Create(2048)
    $fixtureRequest = [Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=pluton.example.internal', $fixtureRsa, [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $fixtureSan = [Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
    $fixtureSan.AddDnsName('pluton.example.internal')
    $fixtureRequest.CertificateExtensions.Add($fixtureSan.Build())
    $fixtureRequest.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true,$false,0,$true))
    $fixtureCertificate = $fixtureRequest.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5),[DateTimeOffset]::UtcNow.AddDays(1))
    [IO.File]::WriteAllText((Join-Path $fixtureCertificates 'cert.pem'),$fixtureCertificate.ExportCertificatePem())
    [IO.File]::WriteAllText((Join-Path $fixtureCertificates 'key.pem'),$fixtureRsa.ExportPkcs8PrivateKeyPem())
    $fixtureCertificate.Dispose()
    $fixtureRsa.Dispose()
    $dockerArguments=@('run','--rm','--init','--network','none','--read-only','--user','10001:10001','--cap-drop','ALL','--security-opt','no-new-privileges:true',
        '--tmpfs','/tmp:rw,noexec,nosuid,nodev,uid=10001,gid=10001,mode=700,size=256m',
        '-e','PLUTON_DUAL_ORIGIN_FIXTURE=1','--workdir','/app/backend','--entrypoint','node',
        '--mount',"type=bind,source=$fixtureCertificates,target=/fixture-certificates,readonly")
    foreach($mapping in @(@('backend/src','/app/backend/src'),@('backend/__tests__','/app/backend/__tests__'))) {
        $source=(Resolve-Path (Join-Path $repoRoot $mapping[0])).Path
        $dockerArguments+=@('--mount',"type=bind,source=$source,target=$($mapping[1]),readonly")
    }
    if($Compiled){$dockerArguments+=@('-e','PLUTON_WEB_FIXTURE_COMPILED=1')}
    $dockerArguments+=@($Image)
    if($Compiled){$dockerArguments+=@('--loader','/app/backend/loader.mjs')}
    $dockerArguments+=@('--import','tsx','/app/backend/__tests__/integration/dualOriginTransport.smoke.ts')
    & docker @dockerArguments
    if($LASTEXITCODE -ne 0){throw 'Disposable dual-origin HTTPS/HTTP integration failed.'}
} finally {
    $resolved=[IO.Path]::GetFullPath($fixtureCertificates)
    if([IO.Path]::GetDirectoryName($resolved).TrimEnd('\','/') -ne [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\','/') -or
        [IO.Path]::GetFileName($resolved) -notmatch '^pluton-dual-origin-[a-f0-9]{32}$'){throw 'Unsafe fixture cleanup path.'}
    if(Test-Path -LiteralPath $resolved){Remove-Item -LiteralPath $resolved -Recurse -Force}
}
