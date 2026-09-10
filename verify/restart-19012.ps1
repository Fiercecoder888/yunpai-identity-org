# Restart the demo backend on 127.0.0.1:19012 with the newest working-copy code.
# ASCII-only on purpose: no BOM needed, PowerShell 5.1 parses it safely.
# Tenant data (runtime\identity-manual-0909.sqlite) is NOT touched.
param(
    [int]$Port = 19012,
    [string]$Repo = "E:\AIStudy\AIProjects\factory\NewWork1\_repo-identity-org",
    [string]$Python = "E:\AIStudy\AIProjects\factory\NewWork1\yunpai-langgraph\.venv\Scripts\python.exe",
    [string]$KeyFile = "E:\AIStudy\AIProjects\factory\NewWork0\runtime\deepseek_api_key.txt",
    [string]$VerifyDir = "E:\AIStudy\AIProjects\factory\NewWork1\_pkg\_verify"
)

$ErrorActionPreference = "Stop"

# 1) stop the current listener on $Port (only python processes)
$targets = Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
    Where-Object { $_.CommandLine -match "--port $Port\b" }
foreach ($t in $targets) {
    Write-Host "stopping pid=$($t.ProcessId) on port $Port"
    Stop-Process -Id $t.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

# 2) start a fresh backend with the documented env
$env:PYTHONPATH = Join-Path $Repo "src"
$env:PYTHONUTF8 = "1"
$env:YUNPAI_TOOL_TRANSPORT = "local"
$env:YUNPAI_DEFAULT_TENANT = "default"
$env:YUNPAI_TOOL_AUTHZ = "enforce"
$env:YUNPAI_RUN_DB = "runtime/runs-manual-0909.sqlite"
$env:YUNPAI_IDENTITY_DB = "runtime/identity-manual-0909.sqlite"
$env:QWEN_ROUTER_ENABLED = "true"
$env:QWEN_BASE_URL = "https://api.deepseek.com/v1"
$env:QWEN_MODEL = "deepseek-chat"
$env:QWEN_API_KEY = (Get-Content -Raw $KeyFile).Trim()

$log = Join-Path $VerifyDir "backend-$Port.log"
$err = Join-Path $VerifyDir "backend-$Port.err.log"
$proc = Start-Process -FilePath $Python `
    -ArgumentList "-m", "uvicorn", "yunpai_langgraph.api:create_app", "--factory", "--host", "127.0.0.1", "--port", "$Port" `
    -WorkingDirectory $Repo -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $log -RedirectStandardError $err
Write-Host "started pid=$($proc.Id) port=$Port log=$log"

# 3) wait for health
$ok = $false
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $h = Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 3
        Write-Host ("health: tools={0} bound={1} transport={2} planner_configured={3}" -f $h.tools, $h.bound, $h.transport, $h.planner_model.configured)
        $ok = $true
        break
    } catch { }
}
if (-not $ok) { Write-Host "backend did not become healthy; see $err"; exit 1 }
