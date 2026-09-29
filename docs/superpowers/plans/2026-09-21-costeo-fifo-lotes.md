# Costeo FIFO por lotes — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada compra quede registrada como un lote con su propio costo, que las ventas y pérdidas consuman del lote más antiguo primero (FIFO), y que el costo guardado en cada venta sea el costo real de la unidad que salió.

**Architecture:** Un módulo puro nuevo (`src/dominio/lotes.js`) concentra toda la lógica FIFO y es lo único que se prueba con `node --test`. `src/app/api.js` lo llama en cada punto donde hoy se toca `stockActual`, y agrega/actualiza filas en una hoja nueva `Lotes`. Los reportes existentes no se tocan: ya leen `Transacciones.costoUnitario`, que se fija al vender — este plan solo cambia de dónde sale ese número.

**Tech Stack:** Google Apps Script (V8) + Google Sheets, sin build. Pruebas con `node --test` (Node nativo, sin framework). `clasp` para subir.

**Spec:** `docs/superpowers/specs/2026-09-21-costeo-fifo-lotes-design.md`

## Global Constraints

- **Patrón dual Apps Script/Node:** todo archivo de `src/` abre con `if (typeof require !== 'undefined') { var x = require('./y.js'); }` usando `var` (nunca `const` — en Apps Script comparten un scope global y `const` redeclarado lanza) y cierra con `if (typeof module !== 'undefined') { module.exports = { ... }; }`.
- **Dinero siempre entero** (pesos colombianos). Cualquier división se redondea con `Math.round`.
- **Columnas nuevas SIEMPRE al final** del arreglo de la entidad en `ESQUEMA` — las filas ya escritas se mapean por posición y se corromperían si se inserta en medio.
- **Nada se elimina:** se anula con `estado: 'anulado'` + `anuladoPor`/`anuladoFecha`/`anuladoMotivo` vía `anularRegistro` de `src/dominio/anulacion.js`.
- **Capas:** `src/dominio/` es puro (sin `SpreadsheetApp`, sin I/O). Solo `src/app/api.js` puede llamar a `dominio` y `datos` en la misma función. `src/web/` habla con el backend solo por `google.script.run`.
- **Identificadores y mensajes en español, sin tildes en identificadores** (`anular`, no `anúlar`).
- **Los objetos de dominio se devuelven nuevos, no se mutan:** usar `Object.assign({}, original, cambios)`, como ya hacen `descontarStock` y `anularRegistro`.
- **JSON en celdas:** el dominio hace `JSON.stringify` al construir la fila; `api.js` hace `JSON.parse` al leerla (mismo patrón que `IngresosInventario.lineas`).
- **Nunca ejecutar `git commit`, `git push` ni crear un PR.** Los pasos de commit de este plan son instrucciones para Andrés; quien ejecute el plan deja los cambios listos y le avisa.
- **Baseline:** hoy pasan 137 pruebas (`npm test`); al terminar el plan deben ser 162. Los conteos que aparecen en cada tarea son acumulados sobre ese baseline. Ninguna tarea debe dejar pruebas en rojo.

---

## Estructura de archivos

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `src/datos/esquema.js` | Agrega la entidad `Lotes` y la columna `lotesConsumidos` a `Transacciones` y `Perdidas` | 1 |
| `test/datos/esquema.test.js` (nuevo) | Fija la forma del esquema para que nadie inserte columnas en medio | 1 |
| `src/dominio/lotes.js` (nuevo) | Motor FIFO puro: construir lote, consumir, devolver, validar anulación | 2, 3 |
| `test/dominio/lotes.test.js` (nuevo) | Pruebas del motor FIFO | 2, 3 |
| `src/dominio/transacciones.js` | `crearTransaccionFiado` toma el costo del consumo de lotes | 4 |
| `src/dominio/perdidas.js` | `crearPerdida` valora la pérdida con el costo real de los lotes | 5 |
| `src/dominio/reportes.js` | Nuevo `reporteInventario` | 6 |
| `src/app/api.js` | Crea lotes al ingresar, consume al vender/perder, devuelve al anular, expone el reporte | 7, 8, 9, 10, 11 |
| `src/web/admin.html` | "Ajustar stock" rediseñado + tabla "Inventario por lotes" | 10, 11 |

---

### Task 1: Esquema — hoja `Lotes` y columna `lotesConsumidos`

**Files:**
- Modify: `src/datos/esquema.js:9-33`
- Test: `test/datos/esquema.test.js` (crear, junto con la carpeta `test/datos/`)

**Interfaces:**
- Consumes: nada.
- Produces: `ESQUEMA.Lotes` = `['id', 'productoId', 'fecha', 'cantidadInicial', 'cantidadRestante', 'costoUnitario', 'estado', 'anuladoPor', 'anuladoFecha', 'anuladoMotivo']`. `ESQUEMA.Transacciones` y `ESQUEMA.Perdidas` terminan en `'lotesConsumidos'`.

- [ ] **Step 1: Escribir la prueba que falla**

Crear `test/datos/esquema.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert');
const { ESQUEMA } = require('../../src/datos/esquema.js');

test('ESQUEMA define la hoja Lotes con sus columnas en orden', () => {
  assert.deepStrictEqual(ESQUEMA.Lotes, [
    'id', 'productoId', 'fecha', 'cantidadInicial', 'cantidadRestante',
    'costoUnitario', 'estado', 'anuladoPor', 'anuladoFecha', 'anuladoMotivo'
  ]);
});

test('lotesConsumidos va al final de Transacciones', () => {
  const columnas = ESQUEMA.Transacciones;
  assert.strictEqual(columnas[columnas.length - 1], 'lotesConsumidos');
});

test('lotesConsumidos va al final de Perdidas', () => {
  const columnas = ESQUEMA.Perdidas;
  assert.strictEqual(columnas[columnas.length - 1], 'lotesConsumidos');
});

test('las columnas viejas de Transacciones conservan su posicion', () => {
  assert.strictEqual(ESQUEMA.Transacciones[0], 'id');
  assert.strictEqual(ESQUEMA.Transacciones[13], 'costoUnitario');
});
```

- [ ] **Step 2: Correr la prueba y verificar que falla**

Run: `npm test -- test/datos/esquema.test.js`
Expected: FAIL — `ESQUEMA.Lotes` es `undefined`.

- [ ] **Step 3: Agregar la entidad y las columnas**

En `src/datos/esquema.js`, agregar `'lotesConsumidos'` al final de `Transacciones` y de `Perdidas`, y agregar `Lotes` al final del objeto `ESQUEMA`:

```javascript
  Transacciones: [
    'id', 'usuarioId', 'productoId', 'productoNombre', 'cantidad',
    'valorUnitario', 'valorTotal', 'fecha', 'origen', 'estado',
    'anuladoPor', 'anuladoFecha', 'anuladoMotivo', 'costoUnitario',
    'lotesConsumidos'
  ],
```

```javascript
  Perdidas: [
    'id', 'productoId', 'productoNombre', 'cantidad', 'motivo', 'valor', 'fecha', 'estado',
    'anuladoPor', 'anuladoFecha', 'anuladoMotivo', 'lotesConsumidos'
  ],
```

```javascript
  Lotes: [
    'id', 'productoId', 'fecha', 'cantidadInicial', 'cantidadRestante',
    'costoUnitario', 'estado', 'anuladoPor', 'anuladoFecha', 'anuladoMotivo'
  ]
```

(`Lotes` va después de `IngresosInventario`; recordar la coma en la entrada anterior.)

- [ ] **Step 4: Correr la prueba y verificar que pasa**

Run: `npm test`
Expected: PASS — 126 pruebas (122 previas + 4 nuevas).

- [ ] **Step 5: Avisar a Andrés (él commitea)**

Cambios listos en `src/datos/esquema.js` y `test/datos/esquema.test.js`. Mensaje sugerido:
`feat: agregar hoja Lotes y columna lotesConsumidos al esquema`

---

### Task 2: Motor FIFO — `crearLote` y `consumirDeLotes`

**Files:**
- Create: `src/dominio/lotes.js`
- Test: `test/dominio/lotes.test.js` (crear)

**Interfaces:**
- Consumes: `esEnteroPositivo(valor)` de `src/dominio/dinero.js`.
- Produces:
  - `crearLote({ id, productoId, fecha, cantidad, costoUnitario })` → objeto lote con `cantidadInicial === cantidadRestante === cantidad`, `estado: 'activo'`.
  - `consumirDeLotes(lotes, productoId, cantidadRequerida, nombreProducto)` → `{ consumos: [{ loteId, cantidad, costoUnitario }], costoTotal, costoUnitarioPromedio, lotesActualizados }`. Lanza `Error('Stock insuficiente para <nombreProducto>')` sin tocar nada si no alcanza.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `test/dominio/lotes.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert');
const { crearLote, consumirDeLotes } = require('../../src/dominio/lotes.js');

function lote(cambios) {
  return Object.assign({
    id: 'l1', productoId: 'p1', fecha: '2026-09-01T10:00:00.000Z',
    cantidadInicial: 3, cantidadRestante: 3, costoUnitario: 2925,
    estado: 'activo', anuladoPor: '', anuladoFecha: '', anuladoMotivo: ''
  }, cambios || {});
}

test('crearLote arranca con cantidadRestante igual a la cantidad comprada', () => {
  const nuevo = crearLote({
    id: 'l9', productoId: 'p1', fecha: '2026-09-21T10:00:00.000Z',
    cantidad: 6, costoUnitario: 3000
  });
  assert.strictEqual(nuevo.cantidadInicial, 6);
  assert.strictEqual(nuevo.cantidadRestante, 6);
  assert.strictEqual(nuevo.costoUnitario, 3000);
  assert.strictEqual(nuevo.estado, 'activo');
  assert.strictEqual(nuevo.anuladoMotivo, '');
});

test('crearLote rechaza cantidad o costo invalidos', () => {
  const base = { id: 'l9', productoId: 'p1', fecha: '2026-09-21T10:00:00.000Z', cantidad: 6, costoUnitario: 3000 };
  assert.throws(() => crearLote(Object.assign({}, base, { cantidad: 0 })), /cantidad/i);
  assert.throws(() => crearLote(Object.assign({}, base, { costoUnitario: 0 })), /costo/i);
  assert.throws(() => crearLote(Object.assign({}, base, { id: '' })), /id/i);
});

test('consumirDeLotes toma del lote mas antiguo primero', () => {
  const lotes = [
    lote({ id: 'nuevo', fecha: '2026-09-20T10:00:00.000Z', cantidadInicial: 6, cantidadRestante: 6, costoUnitario: 3000 }),
    lote({ id: 'viejo', fecha: '2026-09-01T10:00:00.000Z', cantidadInicial: 3, cantidadRestante: 3, costoUnitario: 2925 })
  ];
  const resultado = consumirDeLotes(lotes, 'p1', 2, 'Quatro');
  assert.deepStrictEqual(resultado.consumos, [{ loteId: 'viejo', cantidad: 2, costoUnitario: 2925 }]);
  assert.strictEqual(resultado.costoTotal, 5850);
  assert.strictEqual(resultado.costoUnitarioPromedio, 2925);
  assert.strictEqual(resultado.lotesActualizados.length, 1);
  assert.strictEqual(resultado.lotesActualizados[0].id, 'viejo');
  assert.strictEqual(resultado.lotesActualizados[0].cantidadRestante, 1);
});

test('consumirDeLotes cruza al siguiente lote cuando el mas viejo no alcanza', () => {
  const lotes = [
    lote({ id: 'viejo', fecha: '2026-09-01T10:00:00.000Z', cantidadInicial: 3, cantidadRestante: 2, costoUnitario: 2925 }),
    lote({ id: 'nuevo', fecha: '2026-09-20T10:00:00.000Z', cantidadInicial: 6, cantidadRestante: 6, costoUnitario: 3000 })
  ];
  const resultado = consumirDeLotes(lotes, 'p1', 5, 'Quatro');
  assert.deepStrictEqual(resultado.consumos, [
    { loteId: 'viejo', cantidad: 2, costoUnitario: 2925 },
    { loteId: 'nuevo', cantidad: 3, costoUnitario: 3000 }
  ]);
  assert.strictEqual(resultado.costoTotal, 14850);
  assert.strictEqual(resultado.costoUnitarioPromedio, 2970);
  assert.strictEqual(resultado.lotesActualizados[0].cantidadRestante, 0);
  assert.strictEqual(resultado.lotesActualizados[1].cantidadRestante, 3);
});

test('consumirDeLotes redondea el costo unitario promedio a entero', () => {
  const lotes = [
    lote({ id: 'a', fecha: '2026-09-01T10:00:00.000Z', cantidadInicial: 1, cantidadRestante: 1, costoUnitario: 1000 }),
    lote({ id: 'b', fecha: '2026-09-02T10:00:00.000Z', cantidadInicial: 2, cantidadRestante: 2, costoUnitario: 1001 })
  ];
  const resultado = consumirDeLotes(lotes, 'p1', 3, 'Cafe');
  assert.strictEqual(resultado.costoTotal, 3002);
  assert.strictEqual(resultado.costoUnitarioPromedio, 1001);
  assert.ok(Number.isInteger(resultado.costoUnitarioPromedio));
});

test('consumirDeLotes ignora lotes de otro producto, anulados o agotados', () => {
  const lotes = [
    lote({ id: 'otroProducto', productoId: 'p2', fecha: '2026-09-01T10:00:00.000Z' }),
    lote({ id: 'anulado', fecha: '2026-09-02T10:00:00.000Z', estado: 'anulado' }),
    lote({ id: 'agotado', fecha: '2026-09-03T10:00:00.000Z', cantidadRestante: 0 }),
    lote({ id: 'bueno', fecha: '2026-09-04T10:00:00.000Z', cantidadInicial: 5, cantidadRestante: 5, costoUnitario: 1000 })
  ];
  const resultado = consumirDeLotes(lotes, 'p1', 2, 'Cafe');
  assert.deepStrictEqual(resultado.consumos, [{ loteId: 'bueno', cantidad: 2, costoUnitario: 1000 }]);
});

test('consumirDeLotes rechaza sin tocar nada cuando no alcanza el stock', () => {
  const lotes = [lote({ cantidadInicial: 3, cantidadRestante: 3 })];
  assert.throws(() => consumirDeLotes(lotes, 'p1', 4, 'Quatro'), /stock insuficiente para quatro/i);
  assert.strictEqual(lotes[0].cantidadRestante, 3);
});

test('consumirDeLotes rechaza cantidad invalida', () => {
  const lotes = [lote()];
  assert.throws(() => consumirDeLotes(lotes, 'p1', 0, 'Quatro'), /cantidad/i);
});

test('consumirDeLotes no muta los lotes originales', () => {
  const original = lote({ cantidadInicial: 5, cantidadRestante: 5 });
  consumirDeLotes([original], 'p1', 2, 'Cafe');
  assert.strictEqual(original.cantidadRestante, 5);
});
```

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `npm test -- test/dominio/lotes.test.js`
Expected: FAIL — no existe el módulo `src/dominio/lotes.js`.

- [ ] **Step 3: Escribir el módulo**

Crear `src/dominio/lotes.js`:

```javascript
if (typeof require !== 'undefined') {
  var dineroModulo = require('./dinero.js');
  var esEnteroPositivo = dineroModulo.esEnteroPositivo;
}

function crearLote(datos) {
  if (!datos.id) {
    throw new Error('Falta el id del lote');
  }
  if (!datos.productoId) {
    throw new Error('Falta el producto del lote');
  }
  if (!esEnteroPositivo(datos.cantidad)) {
    throw new Error('La cantidad debe ser un entero positivo');
  }
  if (!esEnteroPositivo(datos.costoUnitario)) {
    throw new Error('El costo unitario debe ser un entero positivo');
  }
  return {
    id: datos.id,
    productoId: datos.productoId,
    fecha: datos.fecha,
    cantidadInicial: datos.cantidad,
    cantidadRestante: datos.cantidad,
    costoUnitario: datos.costoUnitario,
    estado: 'activo',
    anuladoPor: '',
    anuladoFecha: '',
    anuladoMotivo: ''
  };
}

function lotesDisponibles(lotes, productoId) {
  return (lotes || [])
    .filter(function (lote) {
      return lote.productoId === productoId
        && lote.estado === 'activo'
        && Number(lote.cantidadRestante) > 0;
    })
    .sort(function (a, b) { return String(a.fecha).localeCompare(String(b.fecha)); });
}

function consumirDeLotes(lotes, productoId, cantidadRequerida, nombreProducto) {
  if (!esEnteroPositivo(cantidadRequerida)) {
    throw new Error('La cantidad debe ser un entero positivo');
  }
  const disponibles = lotesDisponibles(lotes, productoId);
  const total = disponibles.reduce(function (suma, lote) {
    return suma + Number(lote.cantidadRestante);
  }, 0);
  if (total < cantidadRequerida) {
    throw new Error('Stock insuficiente para ' + nombreProducto);
  }
  const consumos = [];
  const lotesActualizados = [];
  let pendiente = cantidadRequerida;
  let costoTotal = 0;
  for (let i = 0; i < disponibles.length && pendiente > 0; i++) {
    const lote = disponibles[i];
    const disponible = Number(lote.cantidadRestante);
    const toma = pendiente < disponible ? pendiente : disponible;
    const costoUnitario = Number(lote.costoUnitario);
    consumos.push({ loteId: lote.id, cantidad: toma, costoUnitario: costoUnitario });
    lotesActualizados.push(Object.assign({}, lote, { cantidadRestante: disponible - toma }));
    costoTotal += toma * costoUnitario;
    pendiente -= toma;
  }
  return {
    consumos: consumos,
    costoTotal: costoTotal,
    costoUnitarioPromedio: Math.round(costoTotal / cantidadRequerida),
    lotesActualizados: lotesActualizados
  };
}

if (typeof module !== 'undefined') {
  module.exports = { crearLote, lotesDisponibles, consumirDeLotes };
}
```

- [ ] **Step 4: Correr las pruebas y verificar que pasan**

Run: `npm test`
Expected: PASS — 135 pruebas (126 + 9 nuevas).

- [ ] **Step 5: Avisar a Andrés**

`feat: agregar motor FIFO de lotes con crearLote y consumirDeLotes`

---

### Task 3: Motor FIFO — `devolverALotes` y `puedeAnularseLote`

**Files:**
- Modify: `src/dominio/lotes.js`
- Test: `test/dominio/lotes.test.js`

**Interfaces:**
- Consumes: nada nuevo.
- Produces:
  - `devolverALotes(lotes, lotesConsumidos)` → arreglo con **solo los lotes tocados**, cada uno con `cantidadRestante` aumentada. `lotesConsumidos` es `[{ loteId, cantidad }]`.
  - `puedeAnularseLote(lote)` → `true` solo si `cantidadRestante === cantidadInicial`.

- [ ] **Step 1: Escribir las pruebas que fallan**

Agregar al final de `test/dominio/lotes.test.js` (y extender el `require` de arriba a `const { crearLote, consumirDeLotes, devolverALotes, puedeAnularseLote } = require('../../src/dominio/lotes.js');`):

```javascript
test('devolverALotes suma de vuelta a los lotes de origen', () => {
  const lotes = [
    lote({ id: 'viejo', cantidadInicial: 3, cantidadRestante: 0 }),
    lote({ id: 'nuevo', cantidadInicial: 6, cantidadRestante: 3 })
  ];
  const devueltos = devolverALotes(lotes, [
    { loteId: 'viejo', cantidad: 2 },
    { loteId: 'nuevo', cantidad: 3 }
  ]);
  assert.strictEqual(devueltos.length, 2);
  assert.strictEqual(devueltos[0].cantidadRestante, 2);
  assert.strictEqual(devueltos[1].cantidadRestante, 6);
});

test('devolverALotes solo devuelve los lotes tocados', () => {
  const lotes = [lote({ id: 'a', cantidadRestante: 1 }), lote({ id: 'b', cantidadRestante: 1 })];
  const devueltos = devolverALotes(lotes, [{ loteId: 'b', cantidad: 2 }]);
  assert.strictEqual(devueltos.length, 1);
  assert.strictEqual(devueltos[0].id, 'b');
  assert.strictEqual(devueltos[0].cantidadRestante, 3);
});

test('devolverALotes ignora un lote que ya no existe', () => {
  const devueltos = devolverALotes([lote({ id: 'a' })], [{ loteId: 'fantasma', cantidad: 2 }]);
  assert.deepStrictEqual(devueltos, []);
});

test('devolverALotes no muta los lotes originales', () => {
  const original = lote({ id: 'a', cantidadRestante: 1 });
  devolverALotes([original], [{ loteId: 'a', cantidad: 2 }]);
  assert.strictEqual(original.cantidadRestante, 1);
});

test('puedeAnularseLote solo acepta lotes intactos', () => {
  assert.strictEqual(puedeAnularseLote(lote({ cantidadInicial: 3, cantidadRestante: 3 })), true);
  assert.strictEqual(puedeAnularseLote(lote({ cantidadInicial: 3, cantidadRestante: 2 })), false);
  assert.strictEqual(puedeAnularseLote(lote({ cantidadInicial: 3, cantidadRestante: 0 })), false);
});
```

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `npm test -- test/dominio/lotes.test.js`
Expected: FAIL — `devolverALotes is not a function`.

- [ ] **Step 3: Implementar las dos funciones**

En `src/dominio/lotes.js`, antes del bloque `module.exports`:

```javascript
function devolverALotes(lotes, lotesConsumidos) {
  const porId = {};
  (lotesConsumidos || []).forEach(function (consumo) {
    porId[consumo.loteId] = (porId[consumo.loteId] || 0) + Number(consumo.cantidad);
  });
  const actualizados = [];
  (lotes || []).forEach(function (lote) {
    if (porId[lote.id] === undefined) {
      return;
    }
    actualizados.push(Object.assign({}, lote, {
      cantidadRestante: Number(lote.cantidadRestante) + porId[lote.id]
    }));
  });
  return actualizados;
}

function puedeAnularseLote(lote) {
  return Number(lote.cantidadRestante) === Number(lote.cantidadInicial);
}
```

Y actualizar el export:

```javascript
if (typeof module !== 'undefined') {
  module.exports = { crearLote, lotesDisponibles, consumirDeLotes, devolverALotes, puedeAnularseLote };
}
```

- [ ] **Step 4: Correr las pruebas y verificar que pasan**

Run: `npm test`
Expected: PASS — 140 pruebas.

- [ ] **Step 5: Avisar a Andrés**

`feat: agregar devolverALotes y puedeAnularseLote para anulaciones FIFO`

---

### Task 4: `crearTransaccionFiado` usa el costo del lote

**Files:**
- Modify: `src/dominio/transacciones.js:13-49`
- Test: `test/dominio/transacciones.test.js:91-94` (actualizar) y pruebas nuevas

**Interfaces:**
- Consumes: el objeto que devuelve `consumirDeLotes` (Task 2), pasado como `datos.consumo`.
- Produces: `crearTransaccionFiado({ id, usuarioId, producto, cantidad, fecha, origen, consumo })` → la transacción ahora lleva `costoUnitario: consumo.costoUnitarioPromedio` y `lotesConsumidos: JSON.stringify(consumo.consumos)`.

- [ ] **Step 1: Actualizar la prueba existente y agregar las nuevas**

En `test/dominio/transacciones.test.js`, extender el helper `datosBase` para que incluya un consumo, y reemplazar la prueba de la línea 91:

```javascript
const CONSUMO = {
  consumos: [{ loteId: 'l1', cantidad: 2, costoUnitario: 800 }],
  costoTotal: 1600,
  costoUnitarioPromedio: 800,
  lotesActualizados: []
};

function datosBase(cambios) {
  return Object.assign({
    id: 't1',
    usuarioId: 'u1',
    producto: PRODUCTO,
    cantidad: 2,
    fecha: '2026-09-12T10:00:00.000Z',
    origen: 'autoregistro',
    consumo: CONSUMO
  }, cambios || {});
}
```

```javascript
test('crearTransaccionFiado guarda el costo promedio de los lotes consumidos', () => {
  const transaccion = crearTransaccionFiado(datosBase());
  assert.strictEqual(transaccion.costoUnitario, 800);
});

test('crearTransaccionFiado guarda de que lotes salio la venta', () => {
  const consumo = {
    consumos: [
      { loteId: 'viejo', cantidad: 1, costoUnitario: 2925 },
      { loteId: 'nuevo', cantidad: 1, costoUnitario: 3000 }
    ],
    costoTotal: 5925,
    costoUnitarioPromedio: 2963,
    lotesActualizados: []
  };
  const transaccion = crearTransaccionFiado(datosBase({ consumo: consumo }));
  assert.strictEqual(transaccion.costoUnitario, 2963);
  assert.deepStrictEqual(JSON.parse(transaccion.lotesConsumidos), consumo.consumos);
});

test('crearTransaccionFiado exige el consumo de lotes', () => {
  assert.throws(() => crearTransaccionFiado(datosBase({ consumo: null })), /lote/i);
});
```

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `npm test -- test/dominio/transacciones.test.js`
Expected: FAIL — `transaccion.lotesConsumidos` es `undefined` y el costo sigue saliendo de `producto.costo`.

- [ ] **Step 3: Cambiar la construcción de la transacción**

En `src/dominio/transacciones.js`, dentro de `crearTransaccionFiado`, agregar la validación después del bloque que valida `datos.producto`:

```javascript
  if (!datos.consumo || !datos.consumo.consumos) {
    throw new Error('Falta el consumo de lotes de la transaccion');
  }
```

y reemplazar el campo `costoUnitario` del objeto devuelto (última línea antes del `};`):

```javascript
    costoUnitario: datos.consumo.costoUnitarioPromedio,
    lotesConsumidos: JSON.stringify(datos.consumo.consumos)
```

- [ ] **Step 4: Correr las pruebas y verificar que pasan**

Run: `npm test`
Expected: PASS — 142 pruebas.

- [ ] **Step 5: Avisar a Andrés**

`feat: la transaccion de fiado toma el costo del lote consumido`

---

### Task 5: `crearPerdida` se valora con el costo del lote

**Files:**
- Modify: `src/dominio/perdidas.js:9-38`
- Test: `test/dominio/perdidas.test.js:8-16` (actualizar) y pruebas nuevas

**Interfaces:**
- Consumes: el resultado de `consumirDeLotes` (Task 2) como `datos.consumo`.
- Produces: `crearPerdida({ id, producto, cantidad, motivo, fecha, consumo })` → `valor: consumo.costoTotal` (exacto, no `cantidad × producto.costo`) y `lotesConsumidos: JSON.stringify(consumo.consumos)`.

- [ ] **Step 1: Actualizar las pruebas**

En `test/dominio/perdidas.test.js`, agregar el consumo a `BASE` y reemplazar la primera prueba:

```javascript
const CONSUMO = {
  consumos: [{ loteId: 'l1', cantidad: 2, costoUnitario: 800 }],
  costoTotal: 1600,
  costoUnitarioPromedio: 800,
  lotesActualizados: []
};

const BASE = {
  id: 'pe1', producto: PRODUCTO, cantidad: 2, motivo: 'se vencio',
  fecha: '2026-09-14T10:00:00.000Z', consumo: CONSUMO
};
```

```javascript
test('crearPerdida valora la perdida al costo real de los lotes consumidos', () => {
  const perdida = crearPerdida(BASE);
  assert.strictEqual(perdida.valor, 1600);
  assert.strictEqual(perdida.productoId, 'p1');
  assert.strictEqual(perdida.productoNombre, 'Cafe');
  assert.strictEqual(perdida.cantidad, 2);
  assert.strictEqual(perdida.motivo, 'se vencio');
  assert.strictEqual(perdida.estado, 'pendiente');
});

test('crearPerdida usa el costo exacto cuando la perdida cruza dos lotes', () => {
  const consumo = {
    consumos: [
      { loteId: 'viejo', cantidad: 1, costoUnitario: 2925 },
      { loteId: 'nuevo', cantidad: 2, costoUnitario: 3000 }
    ],
    costoTotal: 8925,
    costoUnitarioPromedio: 2975,
    lotesActualizados: []
  };
  const perdida = crearPerdida(Object.assign({}, BASE, { cantidad: 3, consumo: consumo }));
  assert.strictEqual(perdida.valor, 8925);
  assert.deepStrictEqual(JSON.parse(perdida.lotesConsumidos), consumo.consumos);
});

test('crearPerdida exige el consumo de lotes', () => {
  assert.throws(() => crearPerdida(Object.assign({}, BASE, { consumo: null })), /lote/i);
});
```

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `npm test -- test/dominio/perdidas.test.js`
Expected: FAIL — `perdida.lotesConsumidos` es `undefined`.

- [ ] **Step 3: Cambiar la construcción de la pérdida**

En `src/dominio/perdidas.js`, agregar tras la validación de `datos.producto`:

```javascript
  if (!datos.consumo || !datos.consumo.consumos) {
    throw new Error('Falta el consumo de lotes de la perdida');
  }
```

y en el objeto devuelto, reemplazar el campo `valor` y agregar el nuevo:

```javascript
    valor: datos.consumo.costoTotal,
    fecha: datos.fecha,
    estado: 'pendiente',
    anuladoPor: '',
    anuladoFecha: '',
    anuladoMotivo: '',
    lotesConsumidos: JSON.stringify(datos.consumo.consumos)
```

`calcularValorTotal` deja de usarse en este archivo: quitar `var calcularValorTotal = dineroModulo.calcularValorTotal;` del bloque de requires.

- [ ] **Step 4: Correr las pruebas y verificar que pasan**

Run: `npm test`
Expected: PASS — 144 pruebas.

- [ ] **Step 5: Avisar a Andrés**

`feat: la perdida se valora con el costo real de los lotes consumidos`

---

### Task 6: `reporteInventario`

**Files:**
- Modify: `src/dominio/reportes.js` (agregar función antes del `module.exports` de la línea 148, y agregarla al export)
- Test: `test/dominio/reportes.test.js`

**Interfaces:**
- Consumes: filas de `Lotes` (Task 1) y de `Productos`.
- Produces: `reporteInventario(lotes, productos)` → `{ valorTotal, porProducto: [{ productoId, nombre, cantidadTotal, valorTotal, lotes: [{ fecha, cantidadRestante, costoUnitario, valor }] }] }`. Solo lotes `estado === 'activo'` con `cantidadRestante > 0`; los lotes de cada producto van del más antiguo al más nuevo; los productos se ordenan por `valorTotal` descendente.

- [ ] **Step 1: Escribir las pruebas que fallan**

Agregar al final de `test/dominio/reportes.test.js` (y agregar `reporteInventario` al `require` de ese archivo):

```javascript
test('reporteInventario agrupa los lotes activos por producto, del mas viejo al mas nuevo', () => {
  const productos = [
    { id: 'p1', nombre: 'Quatro', activo: true },
    { id: 'p2', nombre: 'Cafe', activo: true }
  ];
  const lotes = [
    { id: 'l2', productoId: 'p1', fecha: '2026-09-20T10:00:00.000Z', cantidadInicial: 6, cantidadRestante: 6, costoUnitario: 3000, estado: 'activo' },
    { id: 'l1', productoId: 'p1', fecha: '2026-09-01T10:00:00.000Z', cantidadInicial: 3, cantidadRestante: 1, costoUnitario: 2925, estado: 'activo' },
    { id: 'l3', productoId: 'p2', fecha: '2026-09-05T10:00:00.000Z', cantidadInicial: 10, cantidadRestante: 4, costoUnitario: 800, estado: 'activo' }
  ];
  const reporte = reporteInventario(lotes, productos);

  assert.strictEqual(reporte.valorTotal, 24125);

  const quatro = reporte.porProducto[0];
  assert.strictEqual(quatro.nombre, 'Quatro');
  assert.strictEqual(quatro.cantidadTotal, 7);
  assert.strictEqual(quatro.valorTotal, 20925);
  assert.strictEqual(quatro.lotes[0].costoUnitario, 2925);
  assert.strictEqual(quatro.lotes[0].valor, 2925);
  assert.strictEqual(quatro.lotes[1].costoUnitario, 3000);

  const cafe = reporte.porProducto[1];
  assert.strictEqual(cafe.nombre, 'Cafe');
  assert.strictEqual(cafe.cantidadTotal, 4);
  assert.strictEqual(cafe.valorTotal, 3200);
});

test('reporteInventario ignora lotes anulados o agotados', () => {
  const productos = [{ id: 'p1', nombre: 'Quatro', activo: true }];
  const lotes = [
    { id: 'l1', productoId: 'p1', fecha: '2026-09-01T10:00:00.000Z', cantidadInicial: 3, cantidadRestante: 0, costoUnitario: 2925, estado: 'activo' },
    { id: 'l2', productoId: 'p1', fecha: '2026-09-02T10:00:00.000Z', cantidadInicial: 3, cantidadRestante: 3, costoUnitario: 2925, estado: 'anulado' }
  ];
  const reporte = reporteInventario(lotes, productos);
  assert.strictEqual(reporte.valorTotal, 0);
  assert.deepStrictEqual(reporte.porProducto, []);
});

test('reporteInventario no lista productos sin lotes', () => {
  const productos = [{ id: 'p1', nombre: 'Quatro', activo: true }];
  const reporte = reporteInventario([], productos);
  assert.strictEqual(reporte.valorTotal, 0);
  assert.deepStrictEqual(reporte.porProducto, []);
});
```

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `npm test -- test/dominio/reportes.test.js`
Expected: FAIL — `reporteInventario is not a function`.

- [ ] **Step 3: Implementar el reporte**

En `src/dominio/reportes.js`, antes del bloque `module.exports`:

```javascript
function reporteInventario(lotes, productos) {
  const nombrePorId = {};
  (productos || []).forEach(function (producto) {
    nombrePorId[producto.id] = producto.nombre;
  });

  const grupos = {};
  (lotes || [])
    .filter(function (lote) {
      return lote.estado === 'activo' && Number(lote.cantidadRestante) > 0;
    })
    .sort(function (a, b) { return String(a.fecha).localeCompare(String(b.fecha)); })
    .forEach(function (lote) {
      const clave = lote.productoId;
      if (!grupos[clave]) {
        grupos[clave] = {
          productoId: clave,
          nombre: nombrePorId[clave] || clave,
          cantidadTotal: 0,
          valorTotal: 0,
          lotes: []
        };
      }
      const grupo = grupos[clave];
      const cantidad = Number(lote.cantidadRestante);
      const costoUnitario = Number(lote.costoUnitario);
      const valor = cantidad * costoUnitario;
      grupo.cantidadTotal += cantidad;
      grupo.valorTotal += valor;
      grupo.lotes.push({
        fecha: lote.fecha,
        cantidadRestante: cantidad,
        costoUnitario: costoUnitario,
        valor: valor
      });
    });

  const porProducto = Object.keys(grupos)
    .map(function (clave) { return grupos[clave]; })
    .sort(function (a, b) { return b.valorTotal - a.valorTotal; });

  return {
    valorTotal: porProducto.reduce(function (suma, fila) { return suma + fila.valorTotal; }, 0),
    porProducto: porProducto
  };
}
```

Agregar `reporteInventario` a la lista del `module.exports` de ese archivo.

- [ ] **Step 4: Correr las pruebas y verificar que pasan**

Run: `npm test`
Expected: PASS — 147 pruebas.

- [ ] **Step 5: Avisar a Andrés**

`feat: agregar reporte de inventario valorizado por lotes`

---

### Task 7: `api.js` — crear lotes al ingresar inventario

**Files:**
- Modify: `src/app/api.js:157-192` (`apiCrearProducto`), `src/app/api.js:488-529` (`apiConfirmarIngresoInventario`)

**Interfaces:**
- Consumes: `crearLote` (Task 2), `ESQUEMA.Lotes` (Task 1).
- Produces: toda entrada de inventario deja una fila en `Lotes`. `producto.costo` se sigue actualizando como referencia informativa.

> **Nota de capas:** `api.js` no tiene bloque de `require` (en Apps Script todo comparte scope global). Las funciones de `src/dominio/lotes.js` quedan disponibles sin importar nada. Esta capa no se prueba con `node --test`; se verifica a mano tras desplegar (paso final del plan).

- [ ] **Step 1: Crear el primer lote al crear un producto**

En `apiCrearProducto`, reemplazar el bloque `agregarFila(libro, 'Productos', {...})` por uno que guarde el id y cree el lote cuando hay stock inicial:

```javascript
    const productoId = nuevoId();
    agregarFila(libro, 'Productos', {
      id: productoId,
      nombre: normalizados.nombre,
      alias: normalizados.alias,
      categoria: normalizados.categoria,
      costo: normalizados.costo,
      precioVenta: normalizados.precioVenta,
      stockActual: normalizados.stockActual,
      activo: true,
      porcentajeAumento: normalizados.porcentajeAumento
    });
    if (normalizados.stockActual > 0) {
      agregarFila(libro, 'Lotes', crearLote({
        id: nuevoId(),
        productoId: productoId,
        fecha: ahoraIso(),
        cantidad: normalizados.stockActual,
        costoUnitario: normalizados.costo
      }));
    }
```

- [ ] **Step 2: Crear un lote por línea al confirmar una factura**

En `apiConfirmarIngresoInventario`, reemplazar el segundo `lineas.forEach` completo (el que hoy crea el producto o le suma stock) por este, que además crea el lote y recuerda su id en la línea:

```javascript
    lineas.forEach(function (linea) {
      if (linea.esNuevo) {
        const id = nuevoId();
        agregarFila(libro, 'Productos', {
          id: id, nombre: linea.nombre, alias: '', categoria: String(linea.categoria).trim(),
          costo: Number(linea.costoUnitario), precioVenta: Number(linea.precioVenta),
          stockActual: Number(linea.cantidad), activo: true, porcentajeAumento: 0
        });
        linea.productoId = id;
      } else {
        const producto = productos.filter(function (p) { return p.id === linea.productoId; })[0];
        actualizarPorId(libro, 'Productos', producto.id, {
          stockActual: producto.stockActual + Number(linea.cantidad),
          costo: Number(linea.costoUnitario)
        });
      }
      const loteId = nuevoId();
      agregarFila(libro, 'Lotes', crearLote({
        id: loteId,
        productoId: linea.productoId,
        fecha: ahoraIso(),
        cantidad: Number(linea.cantidad),
        costoUnitario: Number(linea.costoUnitario)
      }));
      linea.loteId = loteId;
    });
```

`linea.loteId` es lo que Task 9 necesita para saber qué lote anular si se anula el ingreso. No hace falta tocar el esquema: `crearIngresoInventario` serializa `lineas` tal cual (`JSON.stringify(datos.lineas)`, `src/dominio/facturas.js:104`) y esta asignación ocurre antes de esa llamada, así que el `loteId` viaja dentro de `IngresosInventario.lineas`.

- [ ] **Step 3: Verificar que no hay regresión**

Run: `npm test`
Expected: PASS — 147 pruebas (esta capa no tiene pruebas propias; se confirma que nada de dominio se rompió).

- [ ] **Step 4: Avisar a Andrés**

`feat: crear un lote por cada entrada de inventario`

---

### Task 8: `api.js` — consumir lotes al vender y al registrar pérdida

**Files:**
- Modify: `src/app/api.js:111-142` (`registrarFiado`), `src/app/api.js:363-396` (`apiRegistrarPerdida`)

**Interfaces:**
- Consumes: `consumirDeLotes` (Task 2), `crearTransaccionFiado` con `consumo` (Task 4), `crearPerdida` con `consumo` (Task 5).
- Produces: cada venta y cada pérdida descuenta de los lotes más antiguos y deja `lotesConsumidos` en su fila.

> **Por qué `descontarStock` sigue ahí:** `consumirDeLotes` es quien decide de dónde sale la mercancía y cuánto costó; `descontarStock` sigue siendo quien mantiene `producto.stockActual` sincronizado (el spec, sección 3.1, dice explícitamente que ese campo se conserva porque medio sistema lo lee). Las dos llamadas conviven: no reemplazar una por la otra.

- [ ] **Step 1: Consumir lotes en `registrarFiado`**

Reemplazar el cuerpo del `try` de `registrarFiado` (desde `const libro = obtenerLibro();` hasta el `return transaccion;`) por:

```javascript
    const libro = obtenerLibro();
    const productos = leerTodo(libro, 'Productos');
    let producto = null;
    for (let i = 0; i < productos.length; i++) {
      if (productos[i].id === productoId) {
        producto = productos[i];
        break;
      }
    }
    if (!producto || producto.activo !== true) {
      throw new Error('El producto no existe o esta inactivo');
    }
    const consumo = consumirDeLotes(leerTodo(libro, 'Lotes'), producto.id, cantidad, producto.nombre);
    const transaccion = crearTransaccionFiado({
      id: nuevoId(),
      usuarioId: usuario.id,
      producto: producto,
      cantidad: cantidad,
      fecha: ahoraIso(),
      origen: origen,
      consumo: consumo
    });
    const actualizado = descontarStock(producto, cantidad);
    agregarFila(libro, 'Transacciones', transaccion);
    consumo.lotesActualizados.forEach(function (lote) {
      actualizarPorId(libro, 'Lotes', lote.id, { cantidadRestante: lote.cantidadRestante });
    });
    actualizarPorId(libro, 'Productos', producto.id, { stockActual: actualizado.stockActual });
    return transaccion;
```

- [ ] **Step 2: Consumir lotes en `apiRegistrarPerdida`**

En `apiRegistrarPerdida`, reemplazar desde `const perdida = crearPerdida({...})` hasta el `return`:

```javascript
    const consumo = consumirDeLotes(leerTodo(libro, 'Lotes'), producto.id, Number(cantidad), producto.nombre);
    const perdida = crearPerdida({
      id: nuevoId(),
      producto: producto,
      cantidad: Number(cantidad),
      motivo: motivo,
      fecha: ahoraIso(),
      consumo: consumo
    });
    const actualizado = descontarStock(producto, Number(cantidad));
    agregarFila(libro, 'Perdidas', perdida);
    consumo.lotesActualizados.forEach(function (lote) {
      actualizarPorId(libro, 'Lotes', lote.id, { cantidadRestante: lote.cantidadRestante });
    });
    actualizarPorId(libro, 'Productos', producto.id, { stockActual: actualizado.stockActual });
    return { ok: true, mensaje: 'Perdida registrada: ' + perdida.cantidad + ' x ' + perdida.productoNombre, productos: productosVisibles() };
```

- [ ] **Step 3: Verificar que no hay regresión**

Run: `npm test`
Expected: PASS — 147 pruebas.

- [ ] **Step 4: Avisar a Andrés**

`feat: ventas y perdidas consumen del lote mas antiguo primero`

---

### Task 9: `api.js` — anulaciones devuelven a los lotes

**Files:**
- Modify: `src/app/api.js:795+` (`apiAnularTransaccion`), `src/app/api.js:398-441` (`apiAnularPerdida`), `src/app/api.js:531-566` (`apiAnularIngresoInventario`)

**Interfaces:**
- Consumes: `devolverALotes` y `puedeAnularseLote` (Task 3), el `loteId` que Task 7 guardó en cada línea de `IngresosInventario`.
- Produces: anular una venta o pérdida repone las unidades en los lotes exactos de origen; anular un ingreso anula su lote y se rechaza si ya se consumió.

- [ ] **Step 1: Devolver a los lotes al anular una transacción**

En `apiAnularTransaccion`, después del `actualizarPorId(libro, 'Transacciones', ...)` y antes del bloque que repone `stockActual`, agregar:

```javascript
    const consumosTransaccion = original.lotesConsumidos ? JSON.parse(original.lotesConsumidos) : [];
    devolverALotes(leerTodo(libro, 'Lotes'), consumosTransaccion).forEach(function (lote) {
      actualizarPorId(libro, 'Lotes', lote.id, { cantidadRestante: lote.cantidadRestante });
    });
```

- [ ] **Step 2: Devolver a los lotes al anular una pérdida**

En `apiAnularPerdida`, después del `actualizarPorId(libro, 'Perdidas', ...)`, agregar el mismo bloque leyendo de la pérdida:

```javascript
    const consumosPerdida = original.lotesConsumidos ? JSON.parse(original.lotesConsumidos) : [];
    devolverALotes(leerTodo(libro, 'Lotes'), consumosPerdida).forEach(function (lote) {
      actualizarPorId(libro, 'Lotes', lote.id, { cantidadRestante: lote.cantidadRestante });
    });
```

- [ ] **Step 3: Anular el lote al anular un ingreso, rechazando si ya se consumió**

En `apiAnularIngresoInventario`, después de `const lineas = JSON.parse(original.lineas);` y **antes** de tocar nada, agregar la validación todo-o-nada y luego la anulación de cada lote:

```javascript
    const lotes = leerTodo(libro, 'Lotes');
    const lotesDelIngreso = [];
    for (let k = 0; k < lineas.length; k++) {
      const lote = lotes.filter(function (l) { return l.id === lineas[k].loteId; })[0];
      if (!lote) {
        continue;
      }
      if (!puedeAnularseLote(lote)) {
        return { ok: false, mensaje: 'No se puede anular: ya se consumieron unidades de este lote', productos: [] };
      }
      lotesDelIngreso.push(lote);
    }
    lotesDelIngreso.forEach(function (lote) {
      const loteAnulado = anularRegistro(lote, {
        anuladoPor: admin.nombre, anuladoFecha: ahoraIso(), anuladoMotivo: motivo
      });
      actualizarPorId(libro, 'Lotes', lote.id, {
        estado: loteAnulado.estado, anuladoPor: loteAnulado.anuladoPor,
        anuladoFecha: loteAnulado.anuladoFecha, anuladoMotivo: loteAnulado.anuladoMotivo
      });
    });
```

Esta validación va antes del `actualizarPorId(libro, 'IngresosInventario', ...)` que marca el ingreso como anulado, para que un rechazo no deje el ingreso a medio anular.

- [ ] **Step 4: Verificar que no hay regresión**

Run: `npm test`
Expected: PASS — 147 pruebas.

- [ ] **Step 5: Avisar a Andrés**

`feat: las anulaciones reponen las unidades en sus lotes de origen`

---

### Task 10: "Ajustar stock" se convierte en "Sumar al inventario"

**Files:**
- Modify: `src/app/api.js:194-213` (`apiActualizarProducto`), y agregar `apiAjustarStockSubir` junto a `apiConfirmarIngresoInventario`
- Modify: `src/web/admin.html:59-73` (bloque "Ajustar stock") y su manejador en el `<script>`

**Interfaces:**
- Consumes: `apiConfirmarIngresoInventario` (Task 7).
- Produces: `apiAjustarStockSubir(token, productoId, cantidad, costoUnitario)` → `{ ok, mensaje, productos }`. `apiActualizarProducto` deja de aceptar `stockActual`.

- [ ] **Step 1: Quitar `stockActual` de `apiActualizarProducto`**

En `src/app/api.js:198`, quitar `'stockActual'` de la lista de campos permitidos:

```javascript
    ['nombre', 'categoria', 'costo', 'precioVenta', 'activo'].forEach(function (campo) {
```

- [ ] **Step 2: Agregar `apiAjustarStockSubir`**

Justo después de `apiConfirmarIngresoInventario`, agregar:

```javascript
function apiAjustarStockSubir(token, productoId, cantidad, costoUnitario) {
  try {
    exigirAdmin(token);
    const producto = leerTodo(obtenerLibro(), 'Productos')
      .filter(function (p) { return p.id === productoId && p.activo === true; })[0];
    if (!producto) {
      return { ok: false, mensaje: 'El producto no existe o esta inactivo', productos: [] };
    }
    return apiConfirmarIngresoInventario(token, [{
      nombre: producto.nombre,
      productoId: producto.id,
      cantidad: Number(cantidad),
      costoUnitario: Number(costoUnitario),
      esNuevo: false
    }]);
  } catch (error) {
    return { ok: false, mensaje: error.message, productos: [] };
  }
}
```

Reusar `apiConfirmarIngresoInventario` hace que el ajuste quede registrado en `IngresosInventario` (anulable con el mismo botón de "Ultimos movimientos") y cree su lote, sin duplicar lógica.

- [ ] **Step 3: Cambiar el formulario en el panel**

En `src/web/admin.html`, reemplazar el bloque "Ajustar stock" por:

```html
          <div class="bloque">
            <h3>Sumar al inventario</h3>
            <p class="sub">Para unidades que aparecieron en un conteo y el sistema no tenia. Para dar de baja unidades, use "Registrar perdida".</p>
            <div class="rejilla">
              <div class="campo">
                <label for="productoAjuste">Producto</label>
                <select id="productoAjuste"></select>
              </div>
              <div class="campo">
                <label for="cantidadAjuste">Cantidad a sumar</label>
                <input id="cantidadAjuste" type="number" min="1" step="1" value="1">
              </div>
              <div class="campo">
                <label for="costoAjuste">Costo por unidad</label>
                <input id="costoAjuste" type="number" min="1" step="1">
              </div>
              <button id="btnAjustarStock" class="campo-ancho">Sumar al inventario</button>
              <div id="avisoStock" class="campo-ancho"></div>
            </div>
          </div>
```

- [ ] **Step 4: Cambiar el manejador del botón**

En el `<script>` de `admin.html`, reemplazar el listener de `btnAjustarStock` (el que hoy llama a `apiActualizarProducto`) por:

```javascript
      document.getElementById('btnAjustarStock').addEventListener('click', function () {
        var boton = this;
        boton.disabled = true;
        google.script.run.withSuccessHandler(function (respuesta) {
          boton.disabled = false;
          mostrarAviso('avisoStock', respuesta.mensaje, !respuesta.ok);
          if (respuesta.ok) {
            pintarProductos(respuesta.productos);
            document.getElementById('cantidadAjuste').value = '1';
            document.getElementById('costoAjuste').value = '';
          }
        }).apiAjustarStockSubir(
          token,
          document.getElementById('productoAjuste').value,
          Number(document.getElementById('cantidadAjuste').value),
          Number(document.getElementById('costoAjuste').value)
        );
      });
```

- [ ] **Step 5: Verificar ids y que no hay regresión**

Run: `npm test`
Expected: PASS — 147 pruebas.

Además, verificar que ningún `getElementById` del script quedó sin su elemento en el marcado (el id `stockNuevo` ya no debe aparecer en ninguna parte):

Run: `node -e "const h=require('fs').readFileSync('src/web/admin.html','utf8');const m=h.slice(0,h.indexOf('<script>'));const g=h.slice(h.indexOf('<script>'));const ids=[...m.matchAll(/\sid=\"([^\"]+)\"/g)].map(x=>x[1]);const usados=[...g.matchAll(/getElementById\('([^']+)'\)/g)].map(x=>x[1]);const faltan=[...new Set(usados)].filter(i=>!ids.includes(i));console.log('faltantes:',faltan.length?faltan:'ninguno');console.log('stockNuevo presente:',h.includes('stockNuevo'));"`
Expected: `faltantes: ninguno` y `stockNuevo presente: false`.

- [ ] **Step 6: Avisar a Andrés**

`feat: reemplazar ajuste de stock por suma al inventario con costo`

---

### Task 11: Exponer el reporte de inventario en el panel

**Files:**
- Modify: `src/app/api.js:652-677` (`apiReportes`)
- Modify: `src/web/admin.html` (bloque "Reportes" y el manejador de `btnReportes`)

**Interfaces:**
- Consumes: `reporteInventario(lotes, productos)` (Task 6).
- Produces: `apiReportes` devuelve además `inventario: { valorTotal, porProducto }`; el panel lo pinta en una tabla nueva.

- [ ] **Step 1: Agregar el reporte a `apiReportes`**

En el `return` del `try`, agregar la línea del inventario (y la hoja `Lotes` a las lecturas):

```javascript
    const lotes = leerTodo(libro, 'Lotes');
    return {
      ok: true,
      mensaje: '',
      ganancia: reporteGanancia(movimientos.transacciones, productos, desde, hasta),
      perdidas: reportePerdidas(perdidas, desde, hasta),
      cartera: reporteCartera(movimientos, usuarios),
      gastos: reporteGastosCompartidos(movimientos.gastos),
      inventario: reporteInventario(lotes, productos)
    };
```

Y en el `catch`, agregar el valor vacío correspondiente para que la forma de la respuesta no cambie:

```javascript
      gastos: [],
      inventario: { valorTotal: 0, porProducto: [] }
```

- [ ] **Step 2: Agregar la tabla al panel**

En `src/web/admin.html`, dentro del bloque "Reportes", después de la tabla de "Perdidas":

```html
            <h4>Inventario por lotes</h4>
            <p class="sub" id="valorInventario"></p>
            <table>
              <thead>
                <tr><th>Producto</th><th class="valor">Cant.</th><th class="valor">Costo unit.</th><th class="valor">Valor</th></tr>
              </thead>
              <tbody id="tablaInventario"></tbody>
            </table>
```

- [ ] **Step 3: Pintar la tabla al pedir reportes**

En el manejador de `btnReportes`, junto a donde ya se pintan `tablaGanancia`, `tablaCartera` y `tablaPerdidas`, agregar:

```javascript
          document.getElementById('valorInventario').textContent =
            'Valor total del inventario: ' + pesos(respuesta.inventario.valorTotal);
          var filasInventario = [];
          respuesta.inventario.porProducto.forEach(function (fila) {
            fila.lotes.forEach(function (lote, indice) {
              filasInventario.push([
                indice === 0 ? fila.nombre : '',
                String(lote.cantidadRestante),
                pesos(lote.costoUnitario),
                pesos(lote.valor)
              ]);
            });
          });
          pintarFilas('tablaInventario', filasInventario);
```

Cada lote va en su propia fila, con el nombre del producto solo en la primera — así se ve de un vistazo que un producto tiene unidades a dos costos distintos, y el primer renglón de cada producto es el lote que sale en la próxima venta.

- [ ] **Step 4: Verificar que no hay regresión**

Run: `npm test`
Expected: PASS — 147 pruebas.

Run: `node -e "const h=require('fs').readFileSync('src/web/admin.html','utf8');const m=h.slice(0,h.indexOf('<script>'));const g=h.slice(h.indexOf('<script>'));const ids=[...m.matchAll(/\sid=\"([^\"]+)\"/g)].map(x=>x[1]);const dup=ids.filter((i,n)=>ids.indexOf(i)!==n);const usados=[...g.matchAll(/getElementById\('([^']+)'\)/g)].map(x=>x[1]);console.log('duplicados:',dup.length?dup:'ninguno');console.log('faltantes:',[...new Set(usados)].filter(i=>!ids.includes(i)).join(',')||'ninguno');"`
Expected: `duplicados: ninguno` y `faltantes: ninguno`.

- [ ] **Step 5: Avisar a Andrés**

`feat: mostrar el inventario valorizado por lotes en los reportes`

---

## Despliegue (lo hace Andrés, no es tarea de código)

Después de que todas las tareas estén en verde y commiteadas:

1. `npm run push` — sube `src/` al proyecto de Apps Script.
2. En el editor de Apps Script: **Seleccionar función → `configurarInicial()` → Ejecutar**. Esto crea la hoja `Lotes` y escribe los encabezados nuevos de `Transacciones` y `Perdidas`. **Es obligatorio:** sin esto la hoja `Lotes` no existe y toda venta falla.
3. **Implementar → Gestionar implementaciones → editar la implementación existente → Nueva versión → Implementar.** No crear una implementación nueva desde cero (cambiaría la URL).

### Verificación manual en producción

Como las capas `app` y `web` no tienen pruebas automáticas, confirmar a mano en este orden:

1. Crear un producto con stock inicial 3 y costo 2925 → revisar en la hoja `Lotes` que quedó una fila con `cantidadInicial` 3 y `cantidadRestante` 3.
2. "Ingresar factura" con ese mismo producto, cantidad 6, costo 3000 → debe haber un segundo lote; el producto queda con stock 9.
3. En "Reportes → Inventario por lotes": el producto aparece en dos renglones (3 a $2.925 y 6 a $3.000), con valor total $26.775.
4. Registrar un fiado de 2 unidades → en `Lotes`, el lote viejo baja a 1; en `Transacciones`, `costoUnitario` es 2925 y `lotesConsumidos` apunta al lote viejo.
5. Registrar un fiado de 2 unidades más → consume 1 del lote viejo y 1 del nuevo; `costoUnitario` queda 2963 (redondeo de 5925/2).
6. Anular ese último fiado desde "Ultimos movimientos" → el lote viejo vuelve a 1 y el nuevo a 6.
7. Intentar anular el ingreso de la factura del paso 2 → debe rechazarlo con "ya se consumieron unidades de este lote".
