<#
.SYNOPSIS
  One-shot local backend setup for Windows without Docker or WSL:
  PostgreSQL 16 (native) -> database/user -> backend/.env -> migrations ->
  backend dev server -> /health check.

.DESCRIPTION
  Safe to re-run: every step checks what already exists and skips it.
  - Never prints secrets. Firebase Admin values are read from the
    service-account JSON you downloaded and written only to backend/.env,
    which must be gitignored (checked before anything is written).
  - Never deletes or resets data.
  - Installing PostgreSQL needs an Administrator PowerShell; every other
    step works in a normal one.

.PARAMETER ServiceAccountJson
  Path to the Firebase Admin service-account JSON (Firebase Console ->
  Project settings -> Service accounts -> Generate new private key).
  Keep it outside the repository.

.PARAMETER SkipBackendStart
  Prepare everything but do not start `npm run dev`.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File backend\scripts\setup-local-windows.ps1 -ServiceAccountJson "$env:USERPROFILE\secrets\nfouz-admin.json"
#>
[CmdletBinding()]
param(
    [string]$ServiceAccountJson,
    [switch]$SkipBackendStart
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

# Must match backend/.env.example (DATABASE_URL) and backend/docker-compose.yml.
$DbUser = 'nfouz'
$DbPassword = 'nfouz_pass'
$DbName = 'nfouz_db'
$DbPort = 5432
$PlaceholderProjectId = 'your-firebase-project-id'

function Write-Step([string]$Message) { Write-Host "`n== $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message) { Write-Host "   OK    $Message" -ForegroundColor Green }
function Write-Note([string]$Message) { Write-Host "   NOTE  $Message" -ForegroundColor Yellow }
function Stop-Setup([string]$Message) {
    Write-Host "`n   STOP  $Message" -ForegroundColor Red
    exit 1
}

function Find-PostgresBin {
    $psql = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending | Select-Object -First 1
    if ($psql) { return $psql.DirectoryName }
    $cmd = Get-Command psql.exe -ErrorAction SilentlyContinue
    if ($cmd) { return (Split-Path $cmd.Source) }
    return $null
}

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    return ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function ConvertTo-PlainText([Security.SecureString]$Secure) {
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Invoke-Psql([string]$Bin, [string]$User, [string]$Password, [string]$Database, [string]$Sql) {
    # Windows PowerShell 5.1 turns redirected native stderr into errors;
    # a failed login is an expected answer here, not a script failure.
    $ErrorActionPreference = 'Continue'
    $previous = $env:PGPASSWORD
    $env:PGPASSWORD = $Password
    try {
        $output = & (Join-Path $Bin 'psql.exe') -h localhost -p $DbPort -U $User -d $Database -v ON_ERROR_STOP=1 -tAc $Sql 2>&1
        return @{ Ok = ($LASTEXITCODE -eq 0); Output = ($output | Out-String).Trim() }
    }
    finally { $env:PGPASSWORD = $previous }
}

function Get-EnvValue([string[]]$Lines, [string]$Key) {
    foreach ($line in $Lines) {
        if ($line -like "$Key=*") { return $line.Substring($Key.Length + 1).Trim('"') }
    }
    return $null
}

# Fills the three FIREBASE_* lines of an .env file from a service-account
# JSON. Returns the project id. Values are never written to the console.
function Set-FirebaseEnv([string]$EnvPath, [string]$JsonPath) {
    $account = Get-Content -LiteralPath $JsonPath -Raw | ConvertFrom-Json
    foreach ($field in 'type', 'project_id', 'client_email', 'private_key') {
        if (-not ($account.PSObject.Properties.Name -contains $field) -or [string]::IsNullOrWhiteSpace($account.$field)) {
            throw "The JSON file is missing '$field' - is it the Firebase Admin service-account key?"
        }
    }
    if ($account.type -ne 'service_account') {
        throw "The JSON file is not a service-account key (type is '$($account.type)')."
    }

    # backend/src/config/env.js turns literal \n back into newlines.
    $key = $account.private_key -replace "`r?`n", '\n'
    $updated = foreach ($line in (Get-Content -LiteralPath $EnvPath)) {
        if ($line -like 'FIREBASE_PROJECT_ID=*') { "FIREBASE_PROJECT_ID=$($account.project_id)" }
        elseif ($line -like 'FIREBASE_CLIENT_EMAIL=*') { "FIREBASE_CLIENT_EMAIL=$($account.client_email)" }
        elseif ($line -like 'FIREBASE_PRIVATE_KEY=*') { 'FIREBASE_PRIVATE_KEY="' + $key + '"' }
        else { $line }
    }
    [IO.File]::WriteAllLines($EnvPath, [string[]]$updated, (New-Object Text.UTF8Encoding $false))
    return $account.project_id
}

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$backend = Join-Path $repo 'backend'
$envFile = Join-Path $backend '.env'
$envExample = Join-Path $backend '.env.example'

# ------------------------------------------------------------------ 1
Write-Step 'Checking prerequisites'
foreach ($tool in 'node', 'npm', 'git') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Stop-Setup "$tool is not installed or not on PATH." }
}
Write-Ok "node $(node --version), npm $(npm --version)"
& git -C $repo check-ignore -q 'backend/.env'
if ($LASTEXITCODE -ne 0) { Stop-Setup 'backend/.env is NOT gitignored - refusing to write credentials. Pull the latest branch first.' }
Write-Ok 'backend/.env is gitignored'

# ------------------------------------------------------------------ 2
Write-Step 'PostgreSQL'
$pgBin = Find-PostgresBin
$superPassword = $null
if (-not $pgBin) {
    if (-not (Test-IsAdministrator)) {
        Stop-Setup 'PostgreSQL is not installed. Re-run this script in an Administrator PowerShell so it can install PostgreSQL 16.'
    }
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Stop-Setup 'winget is not available. Install PostgreSQL 16 from https://www.postgresql.org/download/windows/ (port 5432), then re-run.'
    }
    Write-Note 'PostgreSQL 16 is not installed - installing it with winget (a few minutes).'
    $secure = Read-Host "Choose a password for the local PostgreSQL admin user 'postgres' (letters and digits only; keep it - it is not saved)" -AsSecureString
    $superPassword = ConvertTo-PlainText $secure
    if ($superPassword -notmatch '^[A-Za-z0-9]{8,}$') { Stop-Setup 'Use at least 8 letters/digits for the postgres password.' }
    winget install --id PostgreSQL.PostgreSQL.16 --exact --silent --accept-package-agreements --accept-source-agreements `
        --override "--mode unattended --unattendedmodeui none --superpassword $superPassword --serverport $DbPort"
    if ($LASTEXITCODE -ne 0) {
        Stop-Setup "winget could not install PostgreSQL 16 (exit $LASTEXITCODE). Install it from https://www.postgresql.org/download/windows/ (port 5432), then re-run."
    }
    $pgBin = Find-PostgresBin
    if (-not $pgBin) { Stop-Setup 'PostgreSQL was installed but psql.exe was not found under C:\Program Files\PostgreSQL. Open a new PowerShell and re-run.' }
}
Write-Ok "PostgreSQL tools: $pgBin"

$service = Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($service -and $service.Status -ne 'Running') {
    Write-Note "Starting Windows service $($service.Name)"
    try { Start-Service $service.Name } catch { Stop-Setup "Could not start $($service.Name) - start it from services.msc or re-run as Administrator." }
}

$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    $ErrorActionPreference = 'Continue'
    & (Join-Path $pgBin 'pg_isready.exe') -h localhost -p $DbPort *> $null
    $ErrorActionPreference = 'Stop'
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 2
}
if (-not $ready) { Stop-Setup "PostgreSQL is not accepting connections on localhost:$DbPort." }
Write-Ok "PostgreSQL is accepting connections on localhost:$DbPort"

# ------------------------------------------------------------------ 3
Write-Step "Database '$DbName' and user '$DbUser'"
$appLogin = Invoke-Psql $pgBin $DbUser $DbPassword $DbName 'SELECT 1'
if ($appLogin.Ok) {
    Write-Ok 'Already set up - skipping'
}
else {
    if (-not $superPassword) {
        $secure = Read-Host "Password of the local PostgreSQL admin user 'postgres' (needed once to create $DbUser/$DbName)" -AsSecureString
        $superPassword = ConvertTo-PlainText $secure
    }
    $role = Invoke-Psql $pgBin 'postgres' $superPassword 'postgres' "DO `$`$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DbUser') THEN CREATE ROLE $DbUser LOGIN PASSWORD '$DbPassword'; END IF; END `$`$;"
    if (-not $role.Ok) { Stop-Setup "Could not create user ${DbUser}: $($role.Output)" }
    $exists = Invoke-Psql $pgBin 'postgres' $superPassword 'postgres' "SELECT 1 FROM pg_database WHERE datname = '$DbName'"
    if ($exists.Output -ne '1') {
        $db = Invoke-Psql $pgBin 'postgres' $superPassword 'postgres' "CREATE DATABASE $DbName OWNER $DbUser"
        if (-not $db.Ok) { Stop-Setup "Could not create database ${DbName}: $($db.Output)" }
    }
    $appLogin = Invoke-Psql $pgBin $DbUser $DbPassword $DbName 'SELECT 1'
    if (-not $appLogin.Ok) { Stop-Setup "User $DbUser still cannot log in: $($appLogin.Output)" }
    Write-Ok 'Created and verified'
}
$superPassword = $null

# ------------------------------------------------------------------ 4
Write-Step 'backend/.env'
if (-not (Test-Path -LiteralPath $envFile)) {
    Copy-Item -LiteralPath $envExample -Destination $envFile
    Write-Ok 'Created from .env.example'
}
else {
    Write-Ok 'Exists - keeping your values'
}
$expectedUrl = "postgres://${DbUser}:${DbPassword}@localhost:${DbPort}/${DbName}"
if ((Get-EnvValue (Get-Content -LiteralPath $envFile) 'DATABASE_URL') -ne $expectedUrl) {
    Write-Note "DATABASE_URL in backend/.env differs from $expectedUrl - left unchanged."
}

if ($ServiceAccountJson) {
    if (-not (Test-Path -LiteralPath $ServiceAccountJson)) { Stop-Setup "Service-account file not found: $ServiceAccountJson" }
    $insideRepo = (Resolve-Path -LiteralPath $ServiceAccountJson).Path.StartsWith($repo, [StringComparison]::OrdinalIgnoreCase)
    if ($insideRepo) { Write-Note 'The service-account JSON is inside the repository - move it outside to avoid committing it.' }
    try { $adminProject = Set-FirebaseEnv $envFile $ServiceAccountJson } catch { Stop-Setup $_.Exception.Message }
    Write-Ok "Firebase Admin values written (project: $adminProject; key not shown)"
}

$adminProject = Get-EnvValue (Get-Content -LiteralPath $envFile) 'FIREBASE_PROJECT_ID'
$firebaseConfigured = $adminProject -and $adminProject -ne $PlaceholderProjectId
$unityConfig = Join-Path $repo 'Assets\google-services.json'
if ($firebaseConfigured -and (Test-Path -LiteralPath $unityConfig)) {
    $unityProject = (Get-Content -LiteralPath $unityConfig -Raw | ConvertFrom-Json).project_info.project_id
    if ($unityProject -ne $adminProject) {
        Stop-Setup "Firebase project mismatch: backend uses '$adminProject' but Unity uses '$unityProject'. Download the service-account key from the '$unityProject' project."
    }
    Write-Ok "Backend and Unity use the same Firebase project ($adminProject)"
}

# ------------------------------------------------------------------ 5
Write-Step 'Migrations (npm run migrate)'
Push-Location $backend
try {
    if (-not (Test-Path 'node_modules')) {
        Write-Note 'Installing npm dependencies'
        npm install
        if ($LASTEXITCODE -ne 0) { Stop-Setup 'npm install failed.' }
    }
    npm run migrate
    if ($LASTEXITCODE -ne 0) { Stop-Setup 'npm run migrate failed - see the error above. Nothing was reset.' }
    Write-Ok 'Migrations up to date'
}
finally { Pop-Location }

# ------------------------------------------------------------------ 6
if (-not $firebaseConfigured) {
    Write-Step 'Firebase Admin credentials still missing'
    Write-Host '   1. Firebase Console -> project NFOUZ -> gear icon -> Project settings -> Service accounts'
    Write-Host '   2. Generate new private key -> save the JSON OUTSIDE the repository'
    Write-Host '   3. Re-run this script with:  -ServiceAccountJson "<path to that JSON>"'
    Stop-Setup 'Database is ready; the backend cannot start until Firebase Admin values are set.'
}
if ($SkipBackendStart) {
    Write-Step 'Done (backend not started: -SkipBackendStart)'
    exit 0
}

Write-Step 'Starting backend (npm run dev) in a new window'
if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) {
    Write-Note 'Something is already listening on port 3000 - not starting a second backend.'
}
else {
    Start-Process powershell -WorkingDirectory $backend -ArgumentList '-NoExit', '-Command', 'npm run dev'
    Write-Note 'If Windows Firewall asks about Node.js, choose Cancel - Unity reaches it via localhost.'
}

$status = $null
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    try {
        $response = Invoke-WebRequest -Uri 'http://localhost:3000/health' -UseBasicParsing -TimeoutSec 5
        $status = [int]$response.StatusCode
        break
    }
    catch {
        # 503 arrives as an exception carrying the response; connection
        # refused (backend still starting) has no Response property.
        $responseProperty = $_.Exception.PSObject.Properties['Response']
        if ($responseProperty -and $responseProperty.Value) { $status = [int]$responseProperty.Value.StatusCode; break }
    }
}
if ($status -eq 200) {
    Write-Ok 'GET http://localhost:3000/health -> 200 (database ok, Firebase Admin initialized)'
    Write-Host "`n   Ready: test Boot -> Login -> Register -> Onboarding -> MainMap in Unity." -ForegroundColor Green
}
elseif ($status) {
    Stop-Setup "/health returned $status - check the backend window for the error."
}
else {
    Stop-Setup 'The backend did not answer on port 3000 within 60 s - check the backend window for the error.'
}
