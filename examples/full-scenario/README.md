# Ejemplo completo: Canary Release de principio a fin

## La historia

**MiTienda.com** es una plataforma de e-commerce con dos usuarios activos:
- **Laura** (plan: `enterprise`, userId: `laura-001`) — cliente corporativo
- **Pedro** (plan: `free`, userId: `pedro-042`) — cliente gratuito

Ambos usan la misma API de productos. Hoy, el equipo de backend va a lanzar
una **nueva versión del endpoint de productos** que incluye reseñas con IA.

El reto: **Laura debe probar la v2 sin que Pedro se entere de que algo cambió.**

---

## Fase 1: El estado actual (sin canary)

```
Pedro  ──GET /products/1──→  { name: "Laptop Pro", price: 1299 }
Laura  ──GET /products/1──→  { name: "Laptop Pro", price: 1299 }
```

Ambos ven lo mismo. Un solo controller, una sola respuesta.

→ Ver: `01-before-canary.ts`

---

## Fase 2: El dev integra @canary-node/core

El dev:
1. Instala el paquete
2. Configura `CanaryModule.forRoot()` con las reglas de targeting
3. Añade `@UseGuards(CanaryGuard)` + `@CanaryExperiment('product-v2')` al controller
4. Pone un `if (variant === 'canary')` para separar la lógica

```
Pedro  ──GET /products/1──→  { name: "Laptop Pro", price: 1299 }              ← STABLE (nada cambió)
Laura  ──GET /products/1──→  { name: "Laptop Pro", price: 1299, reviews: ..., aiSummary: ... }  ← CANARY
```

→ Ver: `02-with-canary.ts`

---

## Fase 3: Medir rendimiento

El dev compara métricas entre stable y canary:

```
GET /admin/canary/product-v2/metrics

{
  stable: { avgResponseTimeMs: 45, p95: 62, errorRate: 0.1 },
  canary: { avgResponseTimeMs: 52, p95: 71, errorRate: 0.2 },
  verdict: "no-significant-difference"
}
```

→ Ver: `03-measure.ts`

---

## Fase 4: Rollout gradual

Las métricas son buenas. El dev abre el canary a más usuarios:

```
POST /admin/canary/product-v2/rollout  { percentage: 25 }
POST /admin/canary/product-v2/rollout  { percentage: 50 }
POST /admin/canary/product-v2/rollout  { percentage: 100 }  ← Todos ven v2
```

---

## Fase 5: Apagar el experimento

La v2 ya es la versión estable. El dev limpia:

1. Elimina el `if/else` del controller — solo deja el código v2
2. Borra el experimento: `DELETE /admin/canary/product-v2`
3. Quita el `@CanaryExperiment` decorator

El código queda limpio, sin rastro de canary.

→ Ver: `04-cleanup.ts`
