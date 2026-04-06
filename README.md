# central-promos-enginee

Microservicio NestJS para orquestar promociones de Mercado Libre con tres procesos separados:

- `SyncAllPromotions`: sincroniza promociones elegibles, detalle de ítems y métricas económicas.
- `ActivatePromotions`: activa promociones rentables guardadas en Mongo.
- `DeactivatePromotions`: pausa o elimina promociones activas que dejan de cumplir reglas.

## Arquitectura

La estructura sigue el estilo de `mercadolibre-api-bidcom`:

- `src/app/module`: módulos Nest y wiring de dependencias.
- `src/app/service`: schedulers y servicios de orquestación.
- `src/app/controller`: endpoints manuales.
- `src/app/drivers`: adapters Nest para Mongo, APIs externas y observabilidad.
- `src/core/interactors`: casos de uso puros.
- `src/core/entities`: entidades y tipos del dominio.
- `src/core/adapters`: contratos para desacoplar negocio de infraestructura.

## Procesos

### Sync

1. Consulta promociones disponibles en `mercadolibre-api`.
2. Consulta MLAs aptos para cada promoción.
3. Pide detalle por MLA.
4. Enriquese cada ítem con `price-api` usando `mla + suggestedPrice`.
5. Consolida y persiste en Mongo.

### Activate

1. Busca documentos sincronizados pendientes.
2. Evalúa `profit` y `profitability`.
3. Activa en Mercado Libre mediante `mercadolibre-api`.
4. Guarda estado, timestamps y auditoría.

### Deactivate

1. Busca promociones activas en Mongo.
2. Consulta precio vigente del MLA en `price-api`.
3. Recalcula métricas con el precio vigente.
4. Si no cumple reglas, pausa o elimina en Mercado Libre.
5. Persiste motivo y auditoría.

## Variables de entorno

Copiar `.env.example` y completar:

- Mongo: `MONGO_URL`
- APIs externas: `MERCADOLIBRE_API_*`, `PRICE_API_*`
- Reglas: `DEFAULT_MIN_PROFITABILITY`, `DEFAULT_MIN_PROFIT`
- Cron: `SYNC_PROMOTIONS_CRON`, `ACTIVATE_PROMOTIONS_CRON`, `DEACTIVATE_PROMOTIONS_CRON`
- Logging: `SERVICE_NAME`

## Ejecución local

```bash
npm install
npm run start:dev
```

## Endpoints manuales

- `POST /promotions/sync`
- `POST /promotions/activate`
- `POST /promotions/deactivate`
- `GET /promotions?status=SYNCED&sellerId=...`

## Logging y observabilidad

La app no tiene conexión directa con Datadog desde el código.
El enfoque es el mismo del repo viejo:

- logger propio centralizado
- logs estructurados en JSON
- salida por `stdout/stderr`
- campo `service` tomado de `SERVICE_NAME`

Los logs salen por consola y Datadog debe capturarlos desde infraestructura, por ejemplo desde el contenedor en producción.

El logger central está en `src/core/drivers/logger/Logger.ts`.
Los logs estructurados incluyen campos útiles como:

- `service`
- `process`
- `sellerId`
- `promotionId`
- `itemId`

Las integraciones HTTP también usan helpers estructurados para request/response/error.


Deployment pipeline ready via GitHub Actions.
