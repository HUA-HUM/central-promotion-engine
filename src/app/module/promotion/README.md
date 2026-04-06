# Promotion Module

Este módulo concentra el wiring principal del microservicio:

- adapters HTTP para `mercadolibre-api` y `price-api`
- repositorio Mongo para promociones consolidadas
- interactors `SyncAllPromotions`, `ActivatePromotions` y `DeactivatePromotions`
- controller para ejecución manual
- scheduler para ejecución automática

La idea es mantener el estilo del proyecto legado, pero empujando la lógica de negocio a `src/core/interactors` y dejando Nest como capa de composición.
