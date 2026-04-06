# Kubernetes deploy

Archivos base para desplegar `central-promos-enginee` en DigitalOcean Kubernetes.

## Orden recomendado

1. Integrar el cluster con el registry:

```bash
doctl kubernetes cluster registry add central-promos-enginee
```

2. Crear namespace y config:

```bash
KUBECONFIG=~/.kube/do-central-promos-enginee-config kubectl apply -f k8s/namespace.yaml
KUBECONFIG=~/.kube/do-central-promos-enginee-config kubectl apply -f k8s/configmap.yaml
```

3. Crear un secret real a partir de `k8s/secret.example.yaml` sin commitear valores sensibles.

4. Aplicar deployment y service:

```bash
KUBECONFIG=~/.kube/do-central-promos-enginee-config kubectl apply -f k8s/deployment.yaml
KUBECONFIG=~/.kube/do-central-promos-enginee-config kubectl apply -f k8s/service.yaml
```

## Variables sensibles

- `MONGO_URL`
- `MERCADOLIBRE_API_TOKEN`
- `PRICE_API_TOKEN`

## Imagen

La imagen esperada es:

`registry.digitalocean.com/central-promos-registry/central-promos-enginee:latest`
