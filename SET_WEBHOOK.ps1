param(
    [Parameter(Mandatory=$true)]
    [string]$TunnelUrl
)

$EVO_URL = "http://localhost:8080"
$EVO_KEY = "B6D711FCDE4D4FD59365415B5E45B4C1"
$WEBHOOK_URL = "$TunnelUrl/api/whatsapp/evolution/webhook"

$headers = @{
    "apikey" = $EVO_KEY
    "Content-Type" = "application/json"
}

$body = @{
    webhook = @{
        enabled = $true
        url = $WEBHOOK_URL
        webhookByEvents = $false
        events = @("MESSAGES_UPSERT")
    }
} | ConvertTo-Json -Depth 5

Write-Host ""
Write-Host "============================================"
Write-Host "  Registrando Webhook en Evolution API"
Write-Host "  URL del Webhook: $WEBHOOK_URL"
Write-Host "============================================"

try {
    $r1 = Invoke-RestMethod -Uri "$EVO_URL/webhook/set/cobranzas_mx" -Method Post -Headers $headers -Body $body
    Write-Host "OK - cobranzas_mx -> $($r1.url)"
} catch {
    Write-Host "ERROR cobranzas_mx: $($_.Exception.Message)"
}

try {
    $r2 = Invoke-RestMethod -Uri "$EVO_URL/webhook/set/cobranzas_cl" -Method Post -Headers $headers -Body $body
    Write-Host "OK - cobranzas_cl -> $($r2.url)"
} catch {
    Write-Host "ERROR cobranzas_cl: $($_.Exception.Message)"
}

try {
    $r3 = Invoke-RestMethod -Uri "$EVO_URL/webhook/set/cobranzas_co" -Method Post -Headers $headers -Body $body
    Write-Host "OK - cobranzas_co -> $($r3.url)"
} catch {
    Write-Host "SKIP cobranzas_co (instancia no existe aun)"
}

Write-Host ""
Write-Host "SIGUIENTE PASO: Actualiza la variable REACT_APP_BACKEND_URL en Vercel"
Write-Host "con la URL del tunel (sin /api al final):"
Write-Host "  $TunnelUrl"
Write-Host ""
