# Costeo FIFO por lotes (diseño)

## 1. Contexto y alcance

Hoy `Productos` guarda un solo `costo` por producto. Cuando llega una nueva
compra del mismo producto a un precio distinto (ej. Quatro a $2.925 y luego a
$3.000), "Ingresar factura" sobrescribe ese costo único. La siguiente venta
usa el costo sobrescrito para *toda* la cantidad vendida, sin importar si la
unidad física que salió venía del lote viejo o del nuevo — la ganancia
reportada de esa venta puede no reflejar lo que realmente costó esa unidad.

Este diseño introduce costeo FIFO: cada compra queda registrada como un lote
independiente con su propia cantidad y costo, y las ventas (y pérdidas)
consumen primero del lote más antiguo. El costo que se guarda en cada
transacción pasa a ser el costo real de la unidad que salió, no un valor
único global del producto.

**No estaba en el pedido original** (`docs/superpowers/specs/2026-09-12-tienda-sistema-design.md`)
ni en las fases ya implementadas — surge de un problema real detectado al usar
"Ingresar factura" (Fase 3, ya en producción) con compras sucesivas a precios
distintos del mismo producto.

## 2. Qué NO cambia

`src/dominio/reportes.js` no se toca. `reporteGanancia` ya lee
`transaccion.costoUnitario` — un valor que se fija en el momento de la venta y
nunca se recalcula después (ver `crearTransaccionFiado`,
`src/dominio/transacciones.js:47`). Este diseño solo cambia **de dónde sale**
ese valor al crear la transacción: en vez de `producto.costo` (un solo
número), sale del lote (o lotes) que la venta consumió. Transacciones ya
guardadas no se tocan ni se recalculan.

Esto significa que las cifras de ganancia de ventas *futuras* van a ser más
precisas que hoy, pero la estructura y el comportamiento de los reportes
existentes no cambian.

## 3. Modelo de datos

### 3.1 Nueva hoja `Lotes`

```
Lotes: [
  'id', 'productoId', 'fecha', 'cantidadInicial', 'cantidadRestante',
  'costoUnitario', 'estado', 'anuladoPor', 'anuladoFecha', 'anuladoMotivo'
]
```

- `estado`: `'activo'` o `'anulado'` (mismo patrón que el resto de entidades
  mutables, vía `anularRegistro` de `src/dominio/anulacion.js`).
- Un lote se crea con `cantidadRestante = cantidadInicial` y se va
  descontando a medida que ventas o pérdidas consumen de él.
- `producto.stockActual` sigue existiendo tal cual — se mantiene como la suma
  de `cantidadRestante` de los lotes activos del producto. Nada del resto del
  sistema que ya lee `stockActual` (listados, selects del panel, "Mi cuenta")
  cambia.
- `producto.costo` pasa a ser informativo: refleja el costo del **lote más
  reciente**, usado solo para sugerir precio de venta en "Nuevo producto" y
  como referencia visual. El cálculo real de ganancia usa los lotes, nunca
  este campo.

### 3.2 Columnas nuevas en entidades existentes

`Transacciones` y `Perdidas` ganan una columna `lotesConsumidos` (JSON en una
celda, mismo patrón que `GastosCompartidos.participantes` e
`IngresosInventario.lineas`):

```json
[{"loteId": "l1", "cantidad": 2}, {"loteId": "l2", "cantidad": 3}]
```

Se agregan **al final** de cada arreglo en `ESQUEMA`, como exige la
convención del proyecto (filas existentes se mapean por posición).

## 4. Consumo FIFO

Nueva función pura en `src/dominio/lotes.js`:

```
consumirDeLotes(lotesDelProducto, cantidadRequerida)
  → { consumos: [{ loteId, cantidad, costoUnitario }],
      costoTotal,        // entero exacto, suma de cantidad*costoUnitario de cada lote
      costoUnitarioPromedio,  // Math.round(costoTotal / cantidadRequerida)
      lotesActualizados }     // mismos lotes con cantidadRestante descontada
```

- Recibe los lotes `estado === 'activo'` de un producto ordenados por
  `fecha` ascendente (los más viejos primero).
- Descuenta de cada lote hasta cubrir `cantidadRequerida`; si un lote no
  alcanza, sigue con el siguiente.
- Si la suma de `cantidadRestante` de todos los lotes activos es menor que lo
  pedido, lanza error `'Stock insuficiente para <producto>'` — mismo mensaje
  que hoy usa `descontarStock`, sin tocar ningún lote (todo o nada).
- Cuando una venta cruza dos lotes con costos distintos, `costoTotal` es
  exacto (enteros × enteros); `costoUnitarioPromedio` se redondea porque
  `Transacciones.costoUnitario` sigue siendo un solo campo — la regla de
  dinero-siempre-entero del proyecto ya acepta este tipo de redondeo (ver
  `calcularPrecioVentaSugerido` en el panel admin). El desvío posible es de
  fracciones de peso y solo ocurre en la venta puntual que cruza el límite
  entre dos lotes, no se arrastra a las demás.

`registrarFiado` (`src/app/api.js`) y `apiRegistrarPerdida` llaman a
`consumirDeLotes` en vez de `descontarStock` directo, guardan
`lotesConsumidos` en la fila creada, y usan `costoUnitarioPromedio` como
`costoUnitario` de la transacción/pérdida.

## 5. Cuándo se crea un lote

Tres puntos de entrada, todos construyen un lote con `crearLote(datos)`
(`src/dominio/lotes.js`):

- **"Nuevo producto"** (`apiCrearProducto`): el `stockActual` inicial se
  convierte automáticamente en el primer lote del producto (`fecha = ahora`,
  `costoUnitario = costo` recibido en el formulario).
- **"Ingresar factura"** (`apiConfirmarIngresoInventario`): cada línea que
  suma stock a un producto existente crea un lote nuevo con la
  `cantidad`/`costoUnitario` de esa línea. Hoy esa misma línea sobrescribe
  `producto.costo` sin dejar rastro del costo anterior; con lotes, el costo
  anterior queda conservado en su propio lote (consumido en su momento por
  FIFO) y `producto.costo` solo se actualiza como referencia informativa
  (sección 3.1) — la diferencia real es que el costo viejo ya no se pierde.
  Una línea `esNuevo` sigue creando el producto y, además, su primer lote.
- **"Ajustar stock" (rediseñado)**: deja de permitir fijar un stock
  arbitrario. Pasa a ser exclusivamente para sumar unidades encontradas en un
  conteo físico que el sistema no tenía registradas — pide cantidad y costo,
  y crea un lote, igual que una compra pequeña. Bajar stock por corrección ya
  lo cubre "Registrar pérdida" (sección 6).

En los tres casos, tras crear el lote se actualiza `producto.costo` al
`costoUnitario` de ese lote (el campo informativo de la sección 3.1) y
`producto.stockActual` suma la cantidad del lote nuevo.

## 6. "Ajustar stock" se reemplaza

El formulario actual permite fijar `stockActual` a cualquier número, sin
costo — con lotes eso queda indefinido (¿de qué lote sale la diferencia?).
Se reemplaza por dos casos ya cubiertos:

- **Bajar stock** (mermas no vistas, conteo físico menor al registrado): usa
  **"Registrar pérdida"**, que ya existe, ya pide motivo, y con este cambio
  ya consume de los lotes más antiguos como una venta (sección 4).
- **Subir stock** (conteo encontró más de lo registrado — caso raro): nuevo
  formulario reducido que solo permite sumar, pidiendo el costo de esas
  unidades — porque es efectivamente una entrada de inventario sin factura,
  no puede quedar sin costo. Crea un lote (sección 5).

El endpoint `apiActualizarProducto` deja de aceptar `stockActual` en
`cambios` (ver `src/app/api.js:194-213`) — sigue existiendo para otros campos
(`nombre`, `categoria`, `activo`).

**Registro y anulación del ajuste hacia arriba:** para no inventar una entidad
nueva solo para esto, `apiAjustarStockSubir` arma internamente una única
línea (`{ productoId, cantidad, costoUnitario, esNuevo: false }`) y reusa el
mismo camino que `apiConfirmarIngresoInventario` — crea el lote y agrega una
fila a `IngresosInventario` con esa línea. Así el ajuste hereda gratis
anulación, motivo y trazabilidad (`apiAnularIngresoInventario`), sin duplicar
lógica ni agregar una hoja `AjustesStock` separada.

## 7. Anulaciones

Mismo patrón `anularRegistro` que ya usa el proyecto, pero devolviendo
cantidades a los lotes exactos de origen usando `lotesConsumidos`:

- **Anular una transacción de fiado o una pérdida**: por cada entrada de
  `lotesConsumidos`, suma esa `cantidad` de vuelta a `cantidadRestante` del
  lote correspondiente (si el lote sigue activo). `producto.stockActual`
  sube igual que hoy.
- **Anular un lote directamente no existe como acción del admin** — un lote
  se anula solo indirectamente, anulando el "Ingresar factura" o el "Ajustar
  stock" que lo creó (`apiAnularIngresoInventario` ahora también anula el
  lote asociado). **Regla:** solo se puede anular si
  `cantidadRestante === cantidadInicial` (nadie ha consumido nada de ese
  lote todavía). Si ya se vendió o perdió parte de ese lote, la anulación se
  rechaza con un mensaje claro (`'No se puede anular: ya se consumieron
  unidades de este lote'`) — el admin corrige con "Registrar pérdida" o un
  ajuste manual si hace falta. Este es el mismo tipo de límite que ya acepta
  el proyecto en Fase 3 (ver "Fuera de alcance" del spec de facturas: no se
  revierte el costo del producto al anular un ingreso).
- **"Nuevo producto" no tiene anulación hoy** (se desactiva con `activo:
  false`, no con el patrón de anulación) — no cambia con este diseño; su
  lote inicial queda simplemente inactivo junto con el producto.

## 8. Arquitectura técnica

Se mantiene la separación de capas del proyecto:

- **`src/dominio/lotes.js`** (nuevo, puro): `crearLote`, `consumirDeLotes`,
  `devolverALotes`, validación de anulación de lote. Cubierto por
  `test/dominio/lotes.test.js`.
- **`src/dominio/transacciones.js`**: `crearTransaccionFiado` deja de leer
  `producto.costo` directo — recibe el resultado de `consumirDeLotes` y arma
  `costoUnitario`/`lotesConsumidos` con eso.
- **`src/dominio/perdidas.js`** (o donde viva `crearPerdida` hoy): mismo
  cambio que transacciones.
- **`src/datos/esquema.js`**: nueva entidad `Lotes`, columnas
  `lotesConsumidos` agregadas al final de `Transacciones` y `Perdidas`.
- **`src/app/api.js`**: `registrarFiado`, `apiRegistrarPerdida`,
  `apiCrearProducto`, `apiConfirmarIngresoInventario`,
  `apiAnularIngresoInventario`, `apiAnularTransaccion`, `apiAnularPerdida`,
  `apiActualizarProducto` tocan lotes además de lo que ya hacen. Nuevo
  `apiAjustarStockSubir(token, productoId, cantidad, costoUnitario)`
  reemplaza el uso de `apiActualizarProducto` para stock.
- **`src/web/admin.html`**: el bloque "Ajustar stock" cambia sus campos
  (cantidad a sumar + costo, ya no "nuevo stock"). Se agrega una tabla nueva
  de reportes, "Inventario por lotes" (sección 9). El resto del panel no
  cambia de forma visible.

## 9. Reporte: inventario por lotes

No hay hoy ninguna vista de cuánto vale el inventario actual ni de qué lotes
componen el stock de cada producto — con lotes ya modelados, agregarlo es
directo y da visibilidad que el sistema nunca tuvo.

**Nueva función pura** `reporteInventario(lotes, productos)` en
`src/dominio/reportes.js`:

```js
{
  valorTotal: 45200,   // suma de cantidadRestante * costoUnitario de todo lote activo
  porProducto: [
    {
      productoId, nombre,
      cantidadTotal: 9,       // suma de cantidadRestante de sus lotes activos
      valorTotal: 26325,      // suma de cantidadRestante * costoUnitario
      lotes: [
        { fecha, cantidadRestante, costoUnitario, valor }
        // ordenados del más antiguo al más nuevo — el primero es
        // el que se consume en la próxima venta
      ]
    }
  ]
}
```

Solo considera lotes `estado === 'activo'` con `cantidadRestante > 0`.

**Expuesto en `apiReportes`** (`src/app/api.js:652-677`) junto a `ganancia`,
`perdidas`, `cartera` y `gastos`, mismo `try/catch` y mismo rango de fechas
que ya reciben los demás — aunque en este caso el reporte no filtra por
fecha (es una foto del inventario *ahora*, no un acumulado del rango), para
mantener consistente la forma de la respuesta.

**En el panel** (`src/web/admin.html`, bloque "Reportes"): una cuarta tabla
después de "Perdidas", **"Inventario por lotes"** — columnas Producto,
Cantidad, Costo unitario, Valor, con el total general (`valorTotal`) arriba
de la tabla como ya hace "Ganancia por producto" con `resumenReportes`.

## 10. Fuera de alcance

- Costeo distinto a FIFO (promedio ponderado, LIFO, costo estándar) —
  decisión explícita del usuario, ver conversación de diseño.
- Revertir un lote parcialmente consumido (sección 7) — se rechaza en vez de
  reconstruirse.
- Migración de datos existentes — no aplica: al momento de este diseño no
  hay productos cargados en el inventario todavía, así que no hay
  `stockActual`/`costo` previos que convertir a lotes.
