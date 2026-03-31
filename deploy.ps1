# deploy.ps1
# Usage: .\deploy.ps1 [-Message "My commit message"]
param(
    [string]$Message = "feat: mise à jour admin EQUIPE",
    [switch]$NoVercel
)

Write-Host "[deploy] Vérification du statut git..." -ForegroundColor Cyan
$st = git status --porcelain
if ($st) {
    Write-Host "Des fichiers modifiés sont présents :" -ForegroundColor Yellow
    Write-Host $st
    Write-Host "Ajout et commit en cours..." -ForegroundColor Cyan
    git add .
    git commit -m $Message
} else {
    Write-Host "Aucun fichier à committer (arbre propre)." -ForegroundColor Green
}

Write-Host "Push vers origin (branche actuelle)..." -ForegroundColor Cyan
git push origin HEAD

if (-not $NoVercel) {
    if (-not $Env:VERCEL_TOKEN) {
        Write-Host "VERCEL_TOKEN non défini. Ignoring déploiement Vercel." -ForegroundColor Yellow
        return
    }

    Write-Host "Déploiement Vercel (production)..." -ForegroundColor Cyan
    npx vercel --prod --token $Env:VERCEL_TOKEN --confirm
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Déploiement Vercel terminé avec succès." -ForegroundColor Green
    } else {
        Write-Host "Échec du déploiement Vercel." -ForegroundColor Red
    }
}
