# GitHub And Deploy

## Qué hace el workflow

El workflow de GitHub Actions está en:

- `.github/workflows/deploy-production.yml`

Se ejecuta cuando:

- hay push a `main`
- o lo corrés manualmente con `workflow_dispatch`

El flujo hace esto:

1. instala `doctl`
2. hace login en DigitalOcean Container Registry
3. construye la imagen `linux/amd64`
4. sube la imagen a DOCR con tag `latest` y `${GITHUB_SHA}`
5. obtiene kubeconfig del cluster `central-promos-enginee`
6. aplica manifests base
7. actualiza la imagen del deployment
8. espera a que el rollout termine

## Secret de GitHub requerido

Tenés que crear este secret en el repo:

- `DIGITALOCEAN_ACCESS_TOKEN`

Ese token debe tener permisos para:

- Container Registry
- Kubernetes

## Cómo hacer que solo vos puedas deployar a producción

El archivo `.github/CODEOWNERS` ya te deja como dueño del código:

- `@arturogutierrez11`

Pero además tenés que configurar en GitHub:

1. `Settings > Branches > Add branch protection rule`
2. branch name pattern: `main`
3. activar:
   - `Require a pull request before merging`
   - `Require review from Code Owners`
   - `Restrict who can push to matching branches`
4. dejar solo tu usuario con permiso para push/merge a `main`

Además, para endurecer el deploy:

1. `Settings > Environments > production`
2. agregar `Required reviewers`
3. ponerte a vos como único reviewer

Con eso:

- solo vos aprobás deploys del environment `production`
- y solo vos deberías poder mergear a `main`

## Publicación inicial del repo

Como este directorio se inicializó localmente, falta crear el repo remoto en GitHub y hacer el primer push.

Después de crear el repo vacío en GitHub:

```bash
git add .
git commit -m "Initial commit"
git remote add origin git@github.com:arturogutierrez11/central-promotion-engine.git
git push -u origin main
```
