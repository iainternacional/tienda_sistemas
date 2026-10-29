# Retiros de ganancia — Diseño

## Objetivo
Registrar el dinero real que el admin saca de la ganancia y aparta (retiro personal, helados para todos, repuestos, etc.), para que el sistema muestre cuánto de la ganancia sigue disponible.

## Decisiones (acordadas con Andrés)
- Un retiro tiene: valor (entero, pesos), motivo (texto libre, obligatorio), fecha automática, admin que lo registró.
- No hay categorías/tipos: solo el motivo escrito.
- Un retiro **no modifica** la ganancia ni las pérdidas históricas; solo reduce el "dinero disponible".
- Disponible = Ganancia total − Pérdidas totales − Retiros activos. Se calcula sin filtro de fechas (es un saldo acumulado, no un periodo).
- No se puede registrar un retiro mayor al disponible.
- Nada se borra: un retiro se anula (`estado: 'anulado'` + anuladoPor/Fecha/Motivo) y deja de contar.
- Solo admin registra y anula.

## Datos
Nueva hoja `Retiros`: `id, valor, motivo, fecha, admin, estado, anuladoPor, anuladoFecha, anuladoMotivo`. Requiere re-ejecutar `configurarInicial()` tras desplegar.

## Reportes
`apiReportes` devuelve `retiros: { total, lineas[] }` (respeta desde/hasta para el listado y total del periodo) y `disponible` (acumulado, sin rango). La UI muestra bloque "Retiros" con tabla (fecha, valor, motivo, estado/anular) y la línea "Dinero disponible".

## Fuera de alcance
Categorías de retiro, reintegros, retiros por usuario distinto del admin.
