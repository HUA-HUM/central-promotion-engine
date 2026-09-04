# central-promos-enginee

Microservicio NestJS para orquestar promociones de Mercado Libre con tres procesos separados:

- `SyncAllPromotions`: sincroniza promociones elegibles, detalle de ítems y métricas económicas.
- `ActivatePromotions`: activa promociones rentables guardadas en Mongo.
- `DeactivatePromotions`: pausa o elimina promociones activas que dejan de cumplir reglas.

Las promociones tipo `DEAL` se sincronizan y recalculan igual que el resto, pero **no se activan ni desactivan automáticamente**: `ActivatePromotions`/`DeactivatePromotions` las saltean siempre, y la decisión de entrar/salir de la promoción queda en manos del usuario vía los endpoints manuales `POST /promotions/deal/activate` y `POST /promotions/deal/deactivate`. Ver [DEAL: sincronización, control de precio y activación manual](#deal-sincronización-control-de-precio-y-activación-manual).

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

Ambos procesos automáticos ignoran promociones `DEAL` (quedan en `skipped`); ver la sección siguiente.

## DEAL: sincronización, control de precio y activación manual

Las promociones `DEAL` siguen un flujo distinto al resto (`SMART`/`PRE_NEGOTIATED`):

- **Sync automático**: sí. Cada sync recalcula rentabilidad usando `max_discounted_price` como precio de participación (fallback `suggested_discounted_price` → `original_price`).
- **Activación/desactivación automática**: no. `ActivatePromotions`/`DeactivatePromotions` (cron y los endpoints bulk `/promotions/activate` y `/promotions/deactivate`) saltean explícitamente cualquier promoción `type: DEAL`.
- **Control de precio**: si el precio con descuento que exige Mercado Libre para participar de la DEAL no da rentable, `DealPriceControlService` (invocado desde el sync, `src/core/interactors/promotion/models/DealPromotion.ts`) sube el precio base/lista del producto (no el descuento) buscando un precio objetivo rentable, acotado por `DEAL_PRICE_CONTROL_MAX_BASE_INCREASE_PERCENTAGE`. Solo corre si `DEAL_PRICE_CONTROL_ENABLED=true`.
- **Automeli**: antes de tocar el precio base en Mercado Libre, hay que sacar la publicación del actualizador externo Automeli (si no, Automeli puede pisar el precio). El repository de Automeli (`src/core/drivers/repositories/automeli/`) expone `update()` → `meli_excluded` y `enableUpdate()` → `enabled`. Si Automeli responde `matched: 0`, no se actualiza precio.
- **Activación manual**: `POST /promotions/deal/activate` revalida rentabilidad con `max_discounted_price`, verifica que no haya otra DEAL activa para el mismo ítem, asegura Automeli en `meli_excluded` y activa en Mercado Libre.
- **Desactivación manual**: `POST /promotions/deal/deactivate` pausa/elimina la promoción en Mercado Libre y libera Automeli (`enabled`) solo si fue esta DEAL la que lo había excluido (`priceControl.controlledBy === 'DEAL' && priceControl.updaterDisabled === true`).

Ambos endpoints reciben `{ promotionId, mlas?, updatedBy? }`: si `mlas` se omite o es `null`, operan sobre **todos** los ítems sincronizados de esa `promotionId`; un array vacío no procesa nada; un array con MLAs puntuales opera solo sobre esos.

El estado del control de precio se persiste por `Promotion` en el campo `priceControl` (`PRICE_UPDATED_PENDING_SYNC`, `ACTIVE`, `RELEASED`, `SKIPPED`).

## Variables de entorno

Copiar `.env.example` y completar:

- Mongo: `MONGO_URL`
- Campaign MLA API: `CAMPAIGN_MLA_API_BASE_URL`, `CAMPAIGN_MLA_API_TIMEOUT`, `CAMPAIGN_MLA_API_TOKEN`
- Sync promotion types: `SYNC_PROMOTION_TYPES`
- APIs externas: `MERCADOLIBRE_API_*`, `PRICE_API_*`
- Automeli (control de actualizador externo para DEAL): `AUTOMELI_API_BASE_URL`, `AUTOMELI_API_TIMEOUT`, `AUTOMELI_API_TOKEN`, `AUTOMELI_SELLER_ID`
- Control de precio DEAL: `DEAL_PRICE_CONTROL_ENABLED` (default `false`), `DEAL_PRICE_CONTROL_MAX_BASE_INCREASE_PERCENTAGE` (default `0.3`)
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
- `POST /promotions/sync-one`
- `POST /promotions/activate`
- `POST /promotions/deactivate`
- `POST /promotions/deactivate-failed`
- `POST /promotions/deal/activate` — activación manual de DEAL (`{ promotionId, mlas?, updatedBy? }`)
- `POST /promotions/deal/deactivate` — desactivación manual de DEAL (`{ promotionId, mlas?, updatedBy? }`)
- `POST /automeli/exclude` — excluye MLAs del actualizador Automeli (`meli_excluded`)
- `POST /automeli/include` — vuelve a habilitar MLAs en Automeli (`enabled`)
- `GET /promotions?status=SYNCED&sellerId=...`
- `GET /promotions/catalogs`
- `GET /promotions/stats`
- `GET /promotions/active`
- `GET /promotions/failed`

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
