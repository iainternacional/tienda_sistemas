# Fase 2 — Prestamos, pagos, perdidas, gastos compartidos y reportes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completar las secciones 2 y 5 del spec que quedaron fuera de Fase 1: las entidades Prestamo, Pago, Perdida y GastoCompartido, un saldo del comprador que las sume todas, y los cuatro reportes del administrador.

**Architecture:** Se mantiene la arquitectura de Fase 1 — logica de negocio en modulos puros bajo `src/dominio/` (sin dependencias de Apps Script, probados con `node --test`), acceso a Sheets aislado en `src/datos/`, y `src/app/api.js` como unica capa que toca ambos mundos. Cada entidad nueva es una hoja mas en `ESQUEMA` y un modulo de dominio con su creador y sus reglas. La anulacion, que hoy vive duplicada en `transacciones.js`, se extrae a un modulo compartido para que las cuatro entidades la reusen.

**Tech Stack:** Google Apps Script, Google Sheets, HTML Service, `node --test` para las pruebas locales, `clasp` para el despliegue.

**Spec:** `docs/superpowers/specs/2026-09-12-tienda-sistema-design.md`

## Global Constraints

- **Idioma:** identificadores, mensajes de usuario, comentarios y mensajes de commit en espanol, sin tildes en los identificadores.
- **Modulos compatibles con Apps Script:** cada archivo de `src/` abre con el bloque `if (typeof require !== 'undefined') { var ... = require(...); }` y cierra con `if (typeof module !== 'undefined') { module.exports = { ... }; }`. Usar `var` (no `const`) en esos requires: en Apps Script todos los archivos comparten scope global y una redeclaracion `var` es un no-op.
- **Dinero en enteros:** todos los valores son pesos colombianos enteros. Ninguna operacion puede producir decimales; el reparto de un gasto compartido distribuye el residuo en vez de redondear.
- **Columnas nuevas van al final** de su arreglo en `ESQUEMA`, nunca en medio: las filas ya escritas en la hoja real se mapean por posicion y se corromperian.
- **Nada se borra:** todo movimiento se anula marcando `estado = 'anulado'` con quien, cuando y por que, conservando el registro original.
- **Tras cambiar `ESQUEMA`:** hay que correr `npm run push` y volver a ejecutar `configurarInicial()` en el editor de Apps Script para que los encabezados nuevos aparezcan en la hoja.
- **Toda tarea termina con `npm test` en verde.** Fase 1 aporta 49 pruebas que no pueden romperse.

---

## Decisiones de diseño que fija este plan

Estas tres preguntas quedaron abiertas en el spec y se resuelven aqui para que todas las tareas asuman lo mismo.

**1. Las cuotas de un gasto compartido se calculan al vuelo, no se guardan como filas.**
El spec dice que al guardar un gasto "el sistema genera automaticamente una cuota individual por cada participante". Se guarda un solo registro `GastoCompartido` con la lista de participantes, y las cuotas se derivan de el. Asi, anular el gasto anula sus cuotas sin tener que tocar N filas, que es justo lo que el spec pide ("anula tambien las cuotas generadas").

**2. El saldo es deudas pendientes menos abonos generales.**
- Un pago **dirigido** (con `aplicadoA` no vacio) marca esos movimientos como `estado = 'pagado'`, que los saca del saldo. El pago en si **no** se resta aparte, porque ya se reflejo en el estado de los movimientos.
- Un pago **general** (con `aplicadoA` vacio) no toca ningun movimiento y se resta del saldo como abono.

Sin esta regla se descontaria dos veces. `saldo = deudas pendientes − abonos generales`.

**3. La transaccion guarda el costo del momento.**
El reporte de ganancia del spec es `(precio_venta − costo) × cantidad`. Hoy `Transaccion` guarda `valorUnitario` (el precio de venta al momento de la venta) pero no el costo, asi que si el admin cambia el costo de un producto, la ganancia historica cambiaria sola. Se agrega `costoUnitario` al final de `ESQUEMA.Transacciones`. Las transacciones creadas antes de este cambio tienen la celda vacia; el reporte cae al costo actual del producto para esas, y lo reporta como estimado.

---

### Task 1: Anulacion compartida y esquema de las entidades nuevas

Sienta la base que usan todas las tareas siguientes: una sola implementacion de la anulacion y las cuatro hojas nuevas declaradas.

**Files:**
- Create: `src/dominio/anulacion.js`
- Create: `test/dominio/anulacion.test.js`
- Modify: `src/datos/esquema.js`
- Modify: `src/dominio/transacciones.js`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces:
  - `anularRegistro(registro, datos) -> registro anulado` donde `datos` es `{ anuladoPor, anuladoFecha, anuladoMotivo }`. Lanza si ya estaba anulado o si falta el motivo.
  - `ESQUEMA.Prestamos`, `ESQUEMA.Pagos`, `ESQUEMA.Perdidas`, `ESQUEMA.GastosCompartidos`.

- [ ] **Step 1: Escribir la prueba que falla**

Crear `test/dominio/anulacion.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert');
const { anularRegistro } = require('../../src/dominio/anulacion.js');

const DATOS = { anuladoPor: 'Admin', anuladoFecha: '2026-09-14T10:00:00.000Z', anuladoMotivo: 'error de digitacion' };

test('anularRegistro marca el registro conservando los campos originales', () => {
  const original = { id: 'p1', usuarioId: 'u1', valor: 20000, estado: 'pendiente' };
  const anulado = anularRegistro(original, DATOS);
  assert.strictEqual(anulado.estado, 'anulado');
  assert.strictEqual(anulado.anuladoPor, 'Admin');
  assert.strictEqual(anulado.anuladoFecha, '2026-09-14T10:00:00.000Z');
  assert.strictEqual(anulado.anuladoMotivo, 'error de digitacion');
  assert.strictEqual(anulado.valor, 20000);
  assert.strictEqual(original.estado, 'pendiente');
});

test('anularRegistro recorta el motivo', () => {
  const anulado = anularRegistro({ id: 'p1', estado: 'pendiente' }, Object.assign({}, DATOS, { anuladoMotivo: '  se devolvio  ' }));
  assert.strictEqual(anulado.anuladoMotivo, 'se devolvio');
});

test('anularRegistro exige motivo', () => {
  assert.throws(() => anularRegistro({ id: 'p1', estado: 'pendiente' }, Object.assign({}, DATOS, { anuladoMotivo: '   ' })), /motivo/i);
});

test('anularRegistro rechaza anular dos veces', () => {
  assert.throws(() => anularRegistro({ id: 'p1', estado: 'anulado' }, DATOS), /ya esta anulad/i);
});
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

Run: `npm test`
Expected: FAIL con `Cannot find module '../../src/dominio/anulacion.js'`

- [ ] **Step 3: Implementar `src/dominio/anulacion.js`**

```javascript
function anularRegistro(registro, datos) {
  if (registro.estado === 'anulado') {
    throw new Error('El registro ya esta anulado');
  }
  if (!datos.anuladoMotivo || String(datos.anuladoMotivo).trim() === '') {
    throw new Error('Debe indicar el motivo de la anulacion');
  }
  return Object.assign({}, registro, {
    estado: 'anulado',
    anuladoPor: datos.anuladoPor,
    anuladoFecha: datos.anuladoFecha,
    anuladoMotivo: String(datos.anuladoMotivo).trim()
  });
}

if (typeof module !== 'undefined') {
  module.exports = { anularRegistro };
}
```

- [ ] **Step 4: Correr la prueba para verificar que pasa**

Run: `npm test`
Expected: PASS, las 4 pruebas nuevas en verde y las 49 de Fase 1 intactas.

- [ ] **Step 5: Hacer que `anularTransaccion` delegue en la funcion compartida**

En `src/dominio/transacciones.js`, agregar el require al bloque de cabecera y reemplazar el cuerpo de `anularTransaccion`. El mensaje de error cambia de "La transaccion ya esta anulada" a "El registro ya esta anulado", asi que hay que aflojar el regex de la prueba existente en `test/dominio/transacciones.test.js:88`, que espera el femenino: cambiar `/ya esta anulada/i` por `/ya esta anulad/i`.

Cabecera (agregar la ultima linea al bloque que ya existe):

```javascript
if (typeof require !== 'undefined') {
  var dineroModulo = require('./dinero.js');
  var esEnteroPositivo = dineroModulo.esEnteroPositivo;
  var calcularValorTotal = dineroModulo.calcularValorTotal;
  var productosModulo = require('./productos.js');
  var hayStockSuficiente = productosModulo.hayStockSuficiente;
  var anulacionModulo = require('./anulacion.js');
  var anularRegistro = anulacionModulo.anularRegistro;
}
```

Cuerpo:

```javascript
function anularTransaccion(transaccion, datos) {
  return anularRegistro(transaccion, datos);
}
```

- [ ] **Step 6: Correr las pruebas para verificar que nada se rompio**

Run: `npm test`
Expected: PASS — 53 pruebas. Si `transacciones.test.js` falla, revisar que el require quedo dentro del bloque `if (typeof require !== 'undefined')`.

- [ ] **Step 7: Declarar las hojas nuevas en el esquema**

En `src/datos/esquema.js`, agregar las cuatro hojas despues de `Transacciones` y agregar `costoUnitario` al final de `Transacciones`:

```javascript
var ESQUEMA = {
  Usuarios: [
    'id', 'nombre', 'area', 'rol', 'tipoLogin', 'emailCorporativo',
    'usuario', 'salt', 'claveHash', 'esPseudoUsuario', 'activo'
  ],
  Productos: [
    'id', 'nombre', 'categoria', 'costo', 'precioVenta', 'stockActual', 'activo', 'alias', 'porcentajeAumento'
  ],
  Transacciones: [
    'id', 'usuarioId', 'productoId', 'productoNombre', 'cantidad',
    'valorUnitario', 'valorTotal', 'fecha', 'origen', 'estado',
    'anuladoPor', 'anuladoFecha', 'anuladoMotivo', 'costoUnitario'
  ],
  Prestamos: [
    'id', 'usuarioId', 'valor', 'fecha', 'estado',
    'anuladoPor', 'anuladoFecha', 'anuladoMotivo'
  ],
  Pagos: [
    'id', 'usuarioId', 'valor', 'fecha', 'aplicadoA', 'estado',
    'anuladoPor', 'anuladoFecha', 'anuladoMotivo'
  ],
  Perdidas: [
    'id', 'productoId', 'productoNombre', 'cantidad', 'motivo', 'valor', 'fecha', 'estado',
    'anuladoPor', 'anuladoFecha', 'anuladoMotivo'
  ],
  GastosCompartidos: [
    'id', 'motivo', 'descripcion', 'valorTotal', 'participantes', 'fecha', 'estado',
    'anuladoPor', 'anuladoFecha', 'anuladoMotivo'
  ]
};
```

`participantes` y `aplicadoA` se guardan como ids separados por coma en una sola celda, porque una celda de Sheets no almacena arreglos.

- [ ] **Step 8: Correr las pruebas**

Run: `npm test`
Expected: FAIL primero. `test/datos/hoja.test.js:7` fija las hojas existentes con `deepStrictEqual` y ahora hay siete. Actualizar esa prueba:

```javascript
test('el esquema define una hoja por entidad', () => {
  assert.deepStrictEqual(Object.keys(ESQUEMA).sort(), [
    'GastosCompartidos', 'Pagos', 'Perdidas', 'Prestamos', 'Productos', 'Transacciones', 'Usuarios'
  ]);
  assert.strictEqual(ESQUEMA.Productos[0], 'id');
});
```

Volver a correr: PASS — 53 pruebas.

- [ ] **Step 9: Commit**

```bash
git add src/dominio/anulacion.js test/dominio/anulacion.test.js src/dominio/transacciones.js src/datos/esquema.js
git commit -m "feat: anulacion compartida y esquema de prestamos, pagos, perdidas y gastos compartidos"
```

---

### Task 2: Dominio y registro de prestamos en efectivo

**Files:**
- Create: `src/dominio/prestamos.js`
- Create: `test/dominio/prestamos.test.js`
- Modify: `src/app/api.js`
- Modify: `src/web/admin.html`

**Interfaces:**
- Consumes: `anularRegistro` de Task 1; `ESQUEMA.Prestamos` de Task 1.
- Produces:
  - `crearPrestamo(datos) -> prestamo` donde `datos` es `{ id, usuarioId, valor, fecha }`.
  - `apiRegistrarPrestamo(token, usuarioId, valor)` y `apiAnularPrestamo(token, prestamoId, motivo)` en `api.js`.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `test/dominio/prestamos.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert');
const { crearPrestamo } = require('../../src/dominio/prestamos.js');

const BASE = { id: 'pr1', usuarioId: 'u1', valor: 20000, fecha: '2026-09-14T10:00:00.000Z' };

test('crearPrestamo arma el registro pendiente', () => {
  assert.deepStrictEqual(crearPrestamo(BASE), {
    id: 'pr1',
    usuarioId: 'u1',
    valor: 20000,
    fecha: '2026-09-14T10:00:00.000Z',
    estado: 'pendiente',
    anuladoPor: '',
    anuladoFecha: '',
    anuladoMotivo: ''
  });
});

test('crearPrestamo exige id', () => {
  assert.throws(() => crearPrestamo(Object.assign({}, BASE, { id: '' })), /id/i);
});

test('crearPrestamo exige usuario', () => {
  assert.throws(() => crearPrestamo(Object.assign({}, BASE, { usuarioId: '' })), /usuario/i);
});

test('crearPrestamo rechaza valor cero o negativo', () => {
  assert.throws(() => crearPrestamo(Object.assign({}, BASE, { valor: 0 })), /valor/i);
  assert.throws(() => crearPrestamo(Object.assign({}, BASE, { valor: -5000 })), /valor/i);
});

test('crearPrestamo rechaza valor con decimales', () => {
  assert.throws(() => crearPrestamo(Object.assign({}, BASE, { valor: 1500.5 })), /valor/i);
});
```

- [ ] **Step 2: Correr las pruebas para verificar que fallan**

Run: `npm test`
Expected: FAIL con `Cannot find module '../../src/dominio/prestamos.js'`

- [ ] **Step 3: Implementar `src/dominio/prestamos.js`**

```javascript
if (typeof require !== 'undefined') {
  var dineroModulo = require('./dinero.js');
  var esEnteroPositivo = dineroModulo.esEnteroPositivo;
}

function crearPrestamo(datos) {
  if (!datos.id) {
    throw new Error('Falta el id del prestamo');
  }
  if (!datos.usuarioId) {
    throw new Error('Falta el usuario del prestamo');
  }
  if (!esEnteroPositivo(datos.valor)) {
    throw new Error('El valor del prestamo debe ser un entero positivo');
  }
  return {
    id: datos.id,
    usuarioId: datos.usuarioId,
    valor: datos.valor,
    fecha: datos.fecha,
    estado: 'pendiente',
    anuladoPor: '',
    anuladoFecha: '',
    anuladoMotivo: ''
  };
}

if (typeof module !== 'undefined') {
  module.exports = { crearPrestamo };
}
```

- [ ] **Step 4: Correr las pruebas para verificar que pasan**

Run: `npm test`
Expected: PASS — 58 pruebas.

- [ ] **Step 5: Agregar los endpoints en `src/app/api.js`**

Insertar despues de `apiRegistrarFiadoComoAdmin`:

```javascript
function apiRegistrarPrestamo(token, usuarioId, valor) {
  try {
    exigirAdmin(token);
    const libro = obtenerLibro();
    const usuarios = leerTodo(libro, 'Usuarios');
    let destino = null;
    for (let i = 0; i < usuarios.length; i++) {
      if (usuarios[i].id === usuarioId && usuarios[i].activo === true) {
        destino = usuarios[i];
        break;
      }
    }
    if (!destino) {
      return { ok: false, mensaje: 'No se encontro el usuario' };
    }
    const prestamo = crearPrestamo({
      id: nuevoId(),
      usuarioId: destino.id,
      valor: Number(valor),
      fecha: ahoraIso()
    });
    agregarFila(libro, 'Prestamos', prestamo);
    return { ok: true, mensaje: 'Prestamo registrado a ' + destino.nombre };
  } catch (error) {
    return { ok: false, mensaje: error.message };
  }
}

function apiAnularPrestamo(token, prestamoId, motivo) {
  try {
    const admin = exigirAdmin(token);
    const libro = obtenerLibro();
    const prestamos = leerTodo(libro, 'Prestamos');
    let original = null;
    for (let i = 0; i < prestamos.length; i++) {
      if (prestamos[i].id === prestamoId) {
        original = prestamos[i];
        break;
      }
    }
    if (!original) {
      return { ok: false, mensaje: 'No se encontro el prestamo' };
    }
    const anulado = anularRegistro(original, {
      anuladoPor: admin.nombre,
      anuladoFecha: ahoraIso(),
      anuladoMotivo: motivo
    });
    actualizarPorId(libro, 'Prestamos', prestamoId, {
      estado: anulado.estado,
      anuladoPor: anulado.anuladoPor,
      anuladoFecha: anulado.anuladoFecha,
      anuladoMotivo: anulado.anuladoMotivo
    });
    return { ok: true, mensaje: 'Prestamo anulado' };
  } catch (error) {
    return { ok: false, mensaje: error.message };
  }
}
```

- [ ] **Step 6: Agregar la tarjeta de prestamos al panel admin**

En `src/web/admin.html`, insertar esta tarjeta despues de la de "Registrar fiado a nombre de alguien":

```html
      <div class="tarjeta">
        <h2>Prestar efectivo</h2>
        <label for="usuarioPrestamo">Comprador</label>
        <select id="usuarioPrestamo"></select>
        <label for="valorPrestamo">Valor prestado</label>
        <input id="valorPrestamo" type="number" min="1" step="1">
        <button id="btnPrestamo">Registrar prestamo</button>
        <div id="avisoPrestamo"></div>
      </div>
```

En el script, dentro de `cargarTodo`, el handler de `apiListarUsuarios` llena hoy un solo select. Reemplazarlo para que llene los dos:

```javascript
          google.script.run.withSuccessHandler(function (respuesta) {
            ['usuarioDestino', 'usuarioPrestamo'].forEach(function (idSelect) {
              var select = document.getElementById(idSelect);
              select.innerHTML = '';
              respuesta.usuarios.forEach(function (usuario) {
                var opcion = document.createElement('option');
                opcion.value = usuario.id;
                opcion.textContent = usuario.nombre;
                select.appendChild(opcion);
              });
            });
          }).apiListarUsuarios(token);
```

Y agregar el handler del boton junto a los demas:

```javascript
      document.getElementById('btnPrestamo').addEventListener('click', function () {
        var boton = this;
        boton.disabled = true;
        google.script.run.withSuccessHandler(function (respuesta) {
          boton.disabled = false;
          mostrarAviso('avisoPrestamo', respuesta.mensaje, !respuesta.ok);
          if (respuesta.ok) { document.getElementById('valorPrestamo').value = ''; }
        }).apiRegistrarPrestamo(
          token,
          document.getElementById('usuarioPrestamo').value,
          Number(document.getElementById('valorPrestamo').value)
        );
      });
```

- [ ] **Step 7: Correr las pruebas**

Run: `npm test`
Expected: PASS — 58 pruebas.

- [ ] **Step 8: Commit**

```bash
git add src/dominio/prestamos.js test/dominio/prestamos.test.js src/app/api.js src/web/admin.html
git commit -m "feat: registro y anulacion de prestamos en efectivo"
```

---

### Task 3: Dominio y registro de perdidas

Una perdida descuenta stock y no genera deuda para nadie. Anularla devuelve el stock, igual que anular una transaccion.

**Files:**
- Create: `src/dominio/perdidas.js`
- Create: `test/dominio/perdidas.test.js`
- Modify: `src/app/api.js`
- Modify: `src/web/admin.html`

**Interfaces:**
- Consumes: `anularRegistro` de Task 1; `descontarStock` y `hayStockSuficiente` de `src/dominio/productos.js` (Fase 1).
- Produces:
  - `crearPerdida(datos) -> perdida` donde `datos` es `{ id, producto, cantidad, motivo, fecha }`.
  - `apiRegistrarPerdida(token, productoId, cantidad, motivo)` y `apiAnularPerdida(token, perdidaId, motivo)`.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `test/dominio/perdidas.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert');
const { crearPerdida } = require('../../src/dominio/perdidas.js');

const PRODUCTO = { id: 'p1', nombre: 'Cafe', costo: 800, precioVenta: 1500, stockActual: 10, activo: true };
const BASE = { id: 'pe1', producto: PRODUCTO, cantidad: 2, motivo: 'se vencio', fecha: '2026-09-14T10:00:00.000Z' };

test('crearPerdida valora la perdida al costo del producto', () => {
  const perdida = crearPerdida(BASE);
  assert.strictEqual(perdida.valor, 1600);
  assert.strictEqual(perdida.productoId, 'p1');
  assert.strictEqual(perdida.productoNombre, 'Cafe');
  assert.strictEqual(perdida.cantidad, 2);
  assert.strictEqual(perdida.motivo, 'se vencio');
  assert.strictEqual(perdida.estado, 'pendiente');
});

test('crearPerdida exige motivo', () => {
  assert.throws(() => crearPerdida(Object.assign({}, BASE, { motivo: '   ' })), /motivo/i);
});

test('crearPerdida rechaza cantidad invalida', () => {
  assert.throws(() => crearPerdida(Object.assign({}, BASE, { cantidad: 0 })), /cantidad/i);
});

test('crearPerdida rechaza cuando no alcanza el stock', () => {
  assert.throws(() => crearPerdida(Object.assign({}, BASE, { cantidad: 11 })), /stock/i);
});

test('crearPerdida exige producto', () => {
  assert.throws(() => crearPerdida(Object.assign({}, BASE, { producto: null })), /producto/i);
});
```

- [ ] **Step 2: Correr las pruebas para verificar que fallan**

Run: `npm test`
Expected: FAIL con `Cannot find module '../../src/dominio/perdidas.js'`

- [ ] **Step 3: Implementar `src/dominio/perdidas.js`**

```javascript
if (typeof require !== 'undefined') {
  var dineroModulo = require('./dinero.js');
  var esEnteroPositivo = dineroModulo.esEnteroPositivo;
  var calcularValorTotal = dineroModulo.calcularValorTotal;
  var productosModulo = require('./productos.js');
  var hayStockSuficiente = productosModulo.hayStockSuficiente;
}

function crearPerdida(datos) {
  if (!datos.id) {
    throw new Error('Falta el id de la perdida');
  }
  if (!datos.producto) {
    throw new Error('Falta el producto de la perdida');
  }
  if (!datos.motivo || String(datos.motivo).trim() === '') {
    throw new Error('Debe indicar el motivo de la perdida');
  }
  if (!esEnteroPositivo(datos.cantidad)) {
    throw new Error('La cantidad debe ser un entero positivo');
  }
  if (!hayStockSuficiente(datos.producto, datos.cantidad)) {
    throw new Error('Stock insuficiente para ' + datos.producto.nombre);
  }
  return {
    id: datos.id,
    productoId: datos.producto.id,
    productoNombre: datos.producto.nombre,
    cantidad: datos.cantidad,
    motivo: String(datos.motivo).trim(),
    valor: calcularValorTotal(datos.cantidad, datos.producto.costo),
    fecha: datos.fecha,
    estado: 'pendiente',
    anuladoPor: '',
    anuladoFecha: '',
    anuladoMotivo: ''
  };
}

if (typeof module !== 'undefined') {
  module.exports = { crearPerdida };
}
```

- [ ] **Step 4: Correr las pruebas para verificar que pasan**

Run: `npm test`
Expected: PASS — 63 pruebas.

- [ ] **Step 5: Agregar los endpoints en `src/app/api.js`**

Insertar despues de `apiAnularPrestamo`. Toman el bloqueo porque tocan stock, igual que `registrarFiado`:

```javascript
function apiRegistrarPerdida(token, productoId, cantidad, motivo) {
  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(30000);
  try {
    exigirAdmin(token);
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
      return { ok: false, mensaje: 'El producto no existe o esta inactivo', productos: [] };
    }
    const perdida = crearPerdida({
      id: nuevoId(),
      producto: producto,
      cantidad: Number(cantidad),
      motivo: motivo,
      fecha: ahoraIso()
    });
    const actualizado = descontarStock(producto, Number(cantidad));
    agregarFila(libro, 'Perdidas', perdida);
    actualizarPorId(libro, 'Productos', producto.id, { stockActual: actualizado.stockActual });
    return { ok: true, mensaje: 'Perdida registrada: ' + perdida.cantidad + ' x ' + perdida.productoNombre, productos: productosVisibles() };
  } catch (error) {
    return { ok: false, mensaje: error.message, productos: [] };
  } finally {
    bloqueo.releaseLock();
  }
}

function apiAnularPerdida(token, perdidaId, motivo) {
  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(30000);
  try {
    const admin = exigirAdmin(token);
    const libro = obtenerLibro();
    const perdidas = leerTodo(libro, 'Perdidas');
    let original = null;
    for (let i = 0; i < perdidas.length; i++) {
      if (perdidas[i].id === perdidaId) {
        original = perdidas[i];
        break;
      }
    }
    if (!original) {
      return { ok: false, mensaje: 'No se encontro la perdida', productos: [] };
    }
    const anulado = anularRegistro(original, {
      anuladoPor: admin.nombre,
      anuladoFecha: ahoraIso(),
      anuladoMotivo: motivo
    });
    actualizarPorId(libro, 'Perdidas', perdidaId, {
      estado: anulado.estado,
      anuladoPor: anulado.anuladoPor,
      anuladoFecha: anulado.anuladoFecha,
      anuladoMotivo: anulado.anuladoMotivo
    });
    const productos = leerTodo(libro, 'Productos');
    for (let j = 0; j < productos.length; j++) {
      if (productos[j].id === original.productoId) {
        actualizarPorId(libro, 'Productos', original.productoId, {
          stockActual: productos[j].stockActual + original.cantidad
        });
        break;
      }
    }
    return { ok: true, mensaje: 'Perdida anulada y stock devuelto', productos: productosVisibles() };
  } catch (error) {
    return { ok: false, mensaje: error.message, productos: [] };
  } finally {
    bloqueo.releaseLock();
  }
}
```

- [ ] **Step 6: Agregar la tarjeta de perdidas al panel admin**

En `src/web/admin.html`, insertar despues de la tarjeta de prestamos:

```html
      <div class="tarjeta">
        <h2>Registrar perdida</h2>
        <label for="productoPerdida">Producto</label>
        <select id="productoPerdida"></select>
        <label for="cantidadPerdida">Cantidad</label>
        <input id="cantidadPerdida" type="number" min="1" step="1" value="1">
        <label for="motivoPerdida">Motivo</label>
        <input id="motivoPerdida" type="text">
        <button id="btnPerdida">Registrar perdida</button>
        <div id="avisoPerdida"></div>
      </div>
```

En `pintarProductos`, agregar el select nuevo:

```javascript
      function pintarProductos(productos) {
        productosCache = productos;
        llenarSelectProductos(document.getElementById('productoAjuste'), productos);
        llenarSelectProductos(document.getElementById('productoAdmin'), productos);
        llenarSelectProductos(document.getElementById('productoPerdida'), productos);
      }
```

Y el handler del boton:

```javascript
      document.getElementById('btnPerdida').addEventListener('click', function () {
        var boton = this;
        boton.disabled = true;
        google.script.run.withSuccessHandler(function (respuesta) {
          boton.disabled = false;
          mostrarAviso('avisoPerdida', respuesta.mensaje, !respuesta.ok);
          if (respuesta.ok) {
            pintarProductos(respuesta.productos);
            document.getElementById('motivoPerdida').value = '';
            document.getElementById('cantidadPerdida').value = '1';
          }
        }).apiRegistrarPerdida(
          token,
          document.getElementById('productoPerdida').value,
          Number(document.getElementById('cantidadPerdida').value),
          document.getElementById('motivoPerdida').value
        );
      });
```

- [ ] **Step 7: Correr las pruebas**

Run: `npm test`
Expected: PASS — 63 pruebas.

- [ ] **Step 8: Commit**

```bash
git add src/dominio/perdidas.js test/dominio/perdidas.test.js src/app/api.js src/web/admin.html
git commit -m "feat: registro y anulacion de perdidas de inventario"
```

---

### Task 4: Gastos compartidos y reparto de cuotas

El reparto tiene que sumar exactamente el valor total aunque no sea divisible: el residuo se distribuye de a un peso entre los primeros participantes.

**Files:**
- Create: `src/dominio/gastosCompartidos.js`
- Create: `test/dominio/gastosCompartidos.test.js`
- Modify: `src/app/api.js`
- Modify: `src/web/admin.html`

**Interfaces:**
- Consumes: `esEnteroPositivo` de `src/dominio/dinero.js`; `anularRegistro` de Task 1.
- Produces:
  - `repartirEntre(valorTotal, cantidadParticipantes) -> number[]`
  - `crearGastoCompartido(datos) -> gasto` donde `datos` es `{ id, motivo, descripcion, valorTotal, participantes, fecha }` y `participantes` es un arreglo de ids.
  - `cuotasDeGasto(gasto) -> [{ gastoId, usuarioId, valor, fecha, motivo, descripcion }]` — devuelve `[]` si el gasto esta anulado.
  - `apiRegistrarGastoCompartido(token, datos)` y `apiAnularGastoCompartido(token, gastoId, motivo)`.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `test/dominio/gastosCompartidos.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert');
const { repartirEntre, crearGastoCompartido, cuotasDeGasto } = require('../../src/dominio/gastosCompartidos.js');

const BASE = {
  id: 'g1',
  motivo: 'cumpleanos',
  descripcion: 'Torta de Ana',
  valorTotal: 30000,
  participantes: ['u1', 'u2', 'u3'],
  fecha: '2026-09-14T10:00:00.000Z'
};

test('repartirEntre divide exacto cuando es divisible', () => {
  assert.deepStrictEqual(repartirEntre(30000, 3), [10000, 10000, 10000]);
});

test('repartirEntre distribuye el residuo entre los primeros', () => {
  assert.deepStrictEqual(repartirEntre(10000, 3), [3334, 3333, 3333]);
});

test('repartirEntre siempre suma el valor total', () => {
  [[10000, 3], [7, 4], [1, 3], [99999, 7]].forEach(function (caso) {
    const partes = repartirEntre(caso[0], caso[1]);
    assert.strictEqual(partes.length, caso[1]);
    assert.strictEqual(partes.reduce((a, b) => a + b, 0), caso[0]);
  });
});

test('repartirEntre rechaza cero participantes', () => {
  assert.throws(() => repartirEntre(10000, 0), /participante/i);
});

test('crearGastoCompartido guarda los participantes como texto separado por coma', () => {
  const gasto = crearGastoCompartido(BASE);
  assert.strictEqual(gasto.participantes, 'u1,u2,u3');
  assert.strictEqual(gasto.valorTotal, 30000);
  assert.strictEqual(gasto.motivo, 'cumpleanos');
  assert.strictEqual(gasto.estado, 'pendiente');
});

test('crearGastoCompartido rechaza un motivo desconocido', () => {
  assert.throws(() => crearGastoCompartido(Object.assign({}, BASE, { motivo: 'paseo' })), /motivo/i);
});

test('crearGastoCompartido exige al menos un participante', () => {
  assert.throws(() => crearGastoCompartido(Object.assign({}, BASE, { participantes: [] })), /participante/i);
});

test('crearGastoCompartido rechaza participantes repetidos', () => {
  assert.throws(() => crearGastoCompartido(Object.assign({}, BASE, { participantes: ['u1', 'u1'] })), /repetid/i);
});

test('crearGastoCompartido rechaza valor invalido', () => {
  assert.throws(() => crearGastoCompartido(Object.assign({}, BASE, { valorTotal: 0 })), /valor/i);
});

test('cuotasDeGasto genera una cuota por participante', () => {
  const cuotas = cuotasDeGasto(crearGastoCompartido(BASE));
  assert.strictEqual(cuotas.length, 3);
  assert.deepStrictEqual(cuotas.map(c => c.usuarioId), ['u1', 'u2', 'u3']);
  assert.deepStrictEqual(cuotas.map(c => c.valor), [10000, 10000, 10000]);
  assert.strictEqual(cuotas[0].gastoId, 'g1');
  assert.strictEqual(cuotas[0].descripcion, 'Torta de Ana');
});

test('cuotasDeGasto no genera nada para un gasto anulado', () => {
  const anulado = Object.assign({}, crearGastoCompartido(BASE), { estado: 'anulado' });
  assert.deepStrictEqual(cuotasDeGasto(anulado), []);
});
```

- [ ] **Step 2: Correr las pruebas para verificar que fallan**

Run: `npm test`
Expected: FAIL con `Cannot find module '../../src/dominio/gastosCompartidos.js'`

- [ ] **Step 3: Implementar `src/dominio/gastosCompartidos.js`**

```javascript
if (typeof require !== 'undefined') {
  var dineroModulo = require('./dinero.js');
  var esEnteroPositivo = dineroModulo.esEnteroPositivo;
}

const MOTIVOS_GASTO_VALIDOS = ['bienvenida', 'cumpleanos', 'otro'];

function repartirEntre(valorTotal, cantidadParticipantes) {
  if (!esEnteroPositivo(cantidadParticipantes)) {
    throw new Error('Debe haber al menos un participante');
  }
  if (!esEnteroPositivo(valorTotal)) {
    throw new Error('El valor total debe ser un entero positivo');
  }
  const base = Math.floor(valorTotal / cantidadParticipantes);
  const residuo = valorTotal - base * cantidadParticipantes;
  const partes = [];
  for (let i = 0; i < cantidadParticipantes; i++) {
    partes.push(i < residuo ? base + 1 : base);
  }
  return partes;
}

function crearGastoCompartido(datos) {
  if (!datos.id) {
    throw new Error('Falta el id del gasto compartido');
  }
  if (MOTIVOS_GASTO_VALIDOS.indexOf(datos.motivo) === -1) {
    throw new Error('Motivo invalido: ' + datos.motivo);
  }
  const participantes = datos.participantes || [];
  if (participantes.length === 0) {
    throw new Error('Debe elegir al menos un participante');
  }
  for (let i = 0; i < participantes.length; i++) {
    if (participantes.indexOf(participantes[i]) !== i) {
      throw new Error('Hay participantes repetidos');
    }
  }
  if (!esEnteroPositivo(datos.valorTotal)) {
    throw new Error('El valor total debe ser un entero positivo');
  }
  return {
    id: datos.id,
    motivo: datos.motivo,
    descripcion: String(datos.descripcion || '').trim(),
    valorTotal: datos.valorTotal,
    participantes: participantes.join(','),
    fecha: datos.fecha,
    estado: 'pendiente',
    anuladoPor: '',
    anuladoFecha: '',
    anuladoMotivo: ''
  };
}

function participantesDe(gasto) {
  return String(gasto.participantes || '')
    .split(',')
    .map(function (id) { return id.trim(); })
    .filter(function (id) { return id !== ''; });
}

function cuotasDeGasto(gasto) {
  if (gasto.estado === 'anulado') {
    return [];
  }
  const ids = participantesDe(gasto);
  if (ids.length === 0) {
    return [];
  }
  const partes = repartirEntre(gasto.valorTotal, ids.length);
  return ids.map(function (usuarioId, indice) {
    return {
      gastoId: gasto.id,
      usuarioId: usuarioId,
      valor: partes[indice],
      fecha: gasto.fecha,
      motivo: gasto.motivo,
      descripcion: gasto.descripcion
    };
  });
}

if (typeof module !== 'undefined') {
  module.exports = { repartirEntre, crearGastoCompartido, cuotasDeGasto, participantesDe };
}
```

- [ ] **Step 4: Correr las pruebas para verificar que pasan**

Run: `npm test`
Expected: PASS — 74 pruebas.

- [ ] **Step 5: Agregar los endpoints en `src/app/api.js`**

Insertar despues de `apiAnularPerdida`:

```javascript
function apiRegistrarGastoCompartido(token, datos) {
  try {
    exigirAdmin(token);
    const libro = obtenerLibro();
    const gasto = crearGastoCompartido({
      id: nuevoId(),
      motivo: String(datos.motivo || '').trim(),
      descripcion: datos.descripcion,
      valorTotal: Number(datos.valorTotal),
      participantes: datos.participantes || [],
      fecha: ahoraIso()
    });
    agregarFila(libro, 'GastosCompartidos', gasto);
    const cuotas = cuotasDeGasto(gasto);
    return {
      ok: true,
      mensaje: 'Gasto repartido entre ' + cuotas.length + ' personas'
    };
  } catch (error) {
    return { ok: false, mensaje: error.message };
  }
}

function apiAnularGastoCompartido(token, gastoId, motivo) {
  try {
    const admin = exigirAdmin(token);
    const libro = obtenerLibro();
    const gastos = leerTodo(libro, 'GastosCompartidos');
    let original = null;
    for (let i = 0; i < gastos.length; i++) {
      if (gastos[i].id === gastoId) {
        original = gastos[i];
        break;
      }
    }
    if (!original) {
      return { ok: false, mensaje: 'No se encontro el gasto compartido' };
    }
    const anulado = anularRegistro(original, {
      anuladoPor: admin.nombre,
      anuladoFecha: ahoraIso(),
      anuladoMotivo: motivo
    });
    actualizarPorId(libro, 'GastosCompartidos', gastoId, {
      estado: anulado.estado,
      anuladoPor: anulado.anuladoPor,
      anuladoFecha: anulado.anuladoFecha,
      anuladoMotivo: anulado.anuladoMotivo
    });
    return { ok: true, mensaje: 'Gasto anulado y cuotas retiradas de los saldos' };
  } catch (error) {
    return { ok: false, mensaje: error.message };
  }
}
```

- [ ] **Step 6: Agregar la tarjeta de gastos compartidos al panel admin**

En `src/web/admin.html`, insertar despues de la tarjeta de perdidas. El selector de participantes es un `<select multiple>`:

```html
      <div class="tarjeta">
        <h2>Gasto compartido</h2>
        <label for="motivoGasto">Motivo</label>
        <select id="motivoGasto">
          <option value="bienvenida">Bienvenida</option>
          <option value="cumpleanos">Cumpleanos</option>
          <option value="otro">Otro</option>
        </select>
        <label for="descripcionGasto">Descripcion</label>
        <input id="descripcionGasto" type="text">
        <label for="valorGasto">Valor total</label>
        <input id="valorGasto" type="number" min="1" step="1">
        <label for="participantesGasto">Participantes (mantenga Ctrl para elegir varios)</label>
        <select id="participantesGasto" multiple size="8"></select>
        <button id="btnGasto">Repartir gasto</button>
        <div id="avisoGasto"></div>
      </div>
```

En `cargarTodo`, agregar `participantesGasto` a la lista de selects que llena `apiListarUsuarios`:

```javascript
            ['usuarioDestino', 'usuarioPrestamo', 'participantesGasto'].forEach(function (idSelect) {
```

Y el handler del boton:

```javascript
      document.getElementById('btnGasto').addEventListener('click', function () {
        var boton = this;
        var seleccionados = [];
        var opciones = document.getElementById('participantesGasto').options;
        for (var i = 0; i < opciones.length; i++) {
          if (opciones[i].selected) { seleccionados.push(opciones[i].value); }
        }
        boton.disabled = true;
        google.script.run.withSuccessHandler(function (respuesta) {
          boton.disabled = false;
          mostrarAviso('avisoGasto', respuesta.mensaje, !respuesta.ok);
          if (respuesta.ok) {
            document.getElementById('descripcionGasto').value = '';
            document.getElementById('valorGasto').value = '';
          }
        }).apiRegistrarGastoCompartido(token, {
          motivo: document.getElementById('motivoGasto').value,
          descripcion: document.getElementById('descripcionGasto').value,
          valorTotal: Number(document.getElementById('valorGasto').value),
          participantes: seleccionados
        });
      });
```

- [ ] **Step 7: Correr las pruebas**

Run: `npm test`
Expected: PASS — 74 pruebas.

- [ ] **Step 8: Commit**

```bash
git add src/dominio/gastosCompartidos.js test/dominio/gastosCompartidos.test.js src/app/api.js src/web/admin.html
git commit -m "feat: gastos compartidos con reparto de cuotas sin residuo"
```

---

### Task 5: Pagos y abonos

**Files:**
- Create: `src/dominio/pagos.js`
- Create: `test/dominio/pagos.test.js`
- Modify: `src/app/api.js`
- Modify: `src/web/admin.html`

**Interfaces:**
- Consumes: `esEnteroPositivo` de `src/dominio/dinero.js`.
- Produces:
  - `crearPago(datos) -> pago` donde `datos` es `{ id, usuarioId, valor, aplicadoA, fecha }` y `aplicadoA` es un arreglo de ids (puede ir vacio).
  - `esAbonoGeneral(pago) -> boolean`
  - `apiRegistrarPago(token, usuarioId, valor)` — registra abono general.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `test/dominio/pagos.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert');
const { crearPago, esAbonoGeneral } = require('../../src/dominio/pagos.js');

const BASE = { id: 'pg1', usuarioId: 'u1', valor: 15000, aplicadoA: [], fecha: '2026-09-14T10:00:00.000Z' };

test('crearPago arma un abono general cuando no se aplica a nada', () => {
  const pago = crearPago(BASE);
  assert.strictEqual(pago.aplicadoA, '');
  assert.strictEqual(pago.valor, 15000);
  assert.strictEqual(pago.estado, 'pendiente');
  assert.strictEqual(esAbonoGeneral(pago), true);
});

test('crearPago guarda los ids aplicados separados por coma', () => {
  const pago = crearPago(Object.assign({}, BASE, { aplicadoA: ['t1', 't2'] }));
  assert.strictEqual(pago.aplicadoA, 't1,t2');
  assert.strictEqual(esAbonoGeneral(pago), false);
});

test('crearPago exige usuario', () => {
  assert.throws(() => crearPago(Object.assign({}, BASE, { usuarioId: '' })), /usuario/i);
});

test('crearPago rechaza valor invalido', () => {
  assert.throws(() => crearPago(Object.assign({}, BASE, { valor: 0 })), /valor/i);
  assert.throws(() => crearPago(Object.assign({}, BASE, { valor: 120.5 })), /valor/i);
});

test('esAbonoGeneral trata el texto vacio con espacios como general', () => {
  assert.strictEqual(esAbonoGeneral({ aplicadoA: '   ' }), true);
});
```

- [ ] **Step 2: Correr las pruebas para verificar que fallan**

Run: `npm test`
Expected: FAIL con `Cannot find module '../../src/dominio/pagos.js'`

- [ ] **Step 3: Implementar `src/dominio/pagos.js`**

```javascript
if (typeof require !== 'undefined') {
  var dineroModulo = require('./dinero.js');
  var esEnteroPositivo = dineroModulo.esEnteroPositivo;
}

function crearPago(datos) {
  if (!datos.id) {
    throw new Error('Falta el id del pago');
  }
  if (!datos.usuarioId) {
    throw new Error('Falta el usuario del pago');
  }
  if (!esEnteroPositivo(datos.valor)) {
    throw new Error('El valor del pago debe ser un entero positivo');
  }
  return {
    id: datos.id,
    usuarioId: datos.usuarioId,
    valor: datos.valor,
    fecha: datos.fecha,
    aplicadoA: (datos.aplicadoA || []).join(','),
    estado: 'pendiente',
    anuladoPor: '',
    anuladoFecha: '',
    anuladoMotivo: ''
  };
}

function esAbonoGeneral(pago) {
  return String(pago.aplicadoA || '').trim() === '';
}

if (typeof module !== 'undefined') {
  module.exports = { crearPago, esAbonoGeneral };
}
```

- [ ] **Step 4: Correr las pruebas para verificar que pasan**

Run: `npm test`
Expected: PASS — 79 pruebas.

- [ ] **Step 5: Agregar el endpoint en `src/app/api.js`**

Insertar despues de `apiAnularGastoCompartido`:

```javascript
function apiRegistrarPago(token, usuarioId, valor) {
  try {
    exigirAdmin(token);
    const libro = obtenerLibro();
    const usuarios = leerTodo(libro, 'Usuarios');
    let destino = null;
    for (let i = 0; i < usuarios.length; i++) {
      if (usuarios[i].id === usuarioId && usuarios[i].activo === true) {
        destino = usuarios[i];
        break;
      }
    }
    if (!destino) {
      return { ok: false, mensaje: 'No se encontro el usuario' };
    }
    const pago = crearPago({
      id: nuevoId(),
      usuarioId: destino.id,
      valor: Number(valor),
      aplicadoA: [],
      fecha: ahoraIso()
    });
    agregarFila(libro, 'Pagos', pago);
    return { ok: true, mensaje: 'Abono registrado a ' + destino.nombre };
  } catch (error) {
    return { ok: false, mensaje: error.message };
  }
}
```

- [ ] **Step 6: Agregar la tarjeta de abonos al panel admin**

En `src/web/admin.html`, insertar despues de la tarjeta de gastos compartidos:

```html
      <div class="tarjeta">
        <h2>Registrar abono</h2>
        <label for="usuarioPago">Comprador</label>
        <select id="usuarioPago"></select>
        <label for="valorPago">Valor abonado</label>
        <input id="valorPago" type="number" min="1" step="1">
        <button id="btnPago">Registrar abono</button>
        <div id="avisoPago"></div>
      </div>
```

En `cargarTodo`, agregar `usuarioPago` a la lista de selects:

```javascript
            ['usuarioDestino', 'usuarioPrestamo', 'participantesGasto', 'usuarioPago'].forEach(function (idSelect) {
```

Y el handler:

```javascript
      document.getElementById('btnPago').addEventListener('click', function () {
        var boton = this;
        boton.disabled = true;
        google.script.run.withSuccessHandler(function (respuesta) {
          boton.disabled = false;
          mostrarAviso('avisoPago', respuesta.mensaje, !respuesta.ok);
          if (respuesta.ok) { document.getElementById('valorPago').value = ''; }
        }).apiRegistrarPago(
          token,
          document.getElementById('usuarioPago').value,
          Number(document.getElementById('valorPago').value)
        );
      });
```

- [ ] **Step 7: Correr las pruebas**

Run: `npm test`
Expected: PASS — 79 pruebas.

- [ ] **Step 8: Commit**

```bash
git add src/dominio/pagos.js test/dominio/pagos.test.js src/app/api.js src/web/admin.html
git commit -m "feat: registro de abonos al saldo del comprador"
```

---

### Task 6: Saldo unificado del comprador

Hoy `calcularSaldoUsuario` solo mira transacciones. Ahora tiene que sumar prestamos y cuotas de gastos, y restar los abonos generales. Las firmas viejas cambian, asi que las pruebas de Fase 1 de `saldo.test.js` se actualizan en esta tarea.

**Files:**
- Modify: `src/dominio/saldo.js`
- Modify: `test/dominio/saldo.test.js`
- Modify: `src/app/api.js`
- Modify: `src/web/micuenta.html`

**Interfaces:**
- Consumes: `cuotasDeGasto` de Task 4; `esAbonoGeneral` de Task 5.
- Produces:
  - `calcularSaldoUsuario(movimientos, usuarioId) -> number` donde `movimientos` es `{ transacciones, prestamos, gastos, pagos }`.
  - `desglosarSaldoUsuario(movimientos, usuarioId) -> [{ id, fecha, tipo, concepto, cantidad, valorTotal }]` ordenado de mas reciente a mas antiguo. `tipo` es `fiado`, `prestamo`, `gasto` o `abono`.

- [ ] **Step 1: Reescribir las pruebas de saldo**

Reemplazar el contenido completo de `test/dominio/saldo.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert');
const { calcularSaldoUsuario, desglosarSaldoUsuario } = require('../../src/dominio/saldo.js');

const TRANSACCIONES = [
  { id: 't1', usuarioId: 'u1', productoNombre: 'Cafe', cantidad: 2, valorTotal: 3000, fecha: '2026-09-10T10:00:00.000Z', estado: 'pendiente' },
  { id: 't2', usuarioId: 'u1', productoNombre: 'Galletas', cantidad: 1, valorTotal: 2000, fecha: '2026-09-11T10:00:00.000Z', estado: 'pendiente' },
  { id: 't3', usuarioId: 'u1', productoNombre: 'Gaseosa', cantidad: 1, valorTotal: 2500, fecha: '2026-09-09T10:00:00.000Z', estado: 'pagado' },
  { id: 't4', usuarioId: 'u1', productoNombre: 'Chocolate', cantidad: 1, valorTotal: 1800, fecha: '2026-09-08T10:00:00.000Z', estado: 'anulado' },
  { id: 't5', usuarioId: 'u2', productoNombre: 'Cafe', cantidad: 1, valorTotal: 1500, fecha: '2026-09-11T11:00:00.000Z', estado: 'pendiente' }
];

const PRESTAMOS = [
  { id: 'pr1', usuarioId: 'u1', valor: 20000, fecha: '2026-09-12T10:00:00.000Z', estado: 'pendiente' },
  { id: 'pr2', usuarioId: 'u1', valor: 5000, fecha: '2026-09-07T10:00:00.000Z', estado: 'anulado' },
  { id: 'pr3', usuarioId: 'u2', valor: 9000, fecha: '2026-09-12T11:00:00.000Z', estado: 'pendiente' }
];

const GASTOS = [
  { id: 'g1', motivo: 'cumpleanos', descripcion: 'Torta de Ana', valorTotal: 30000, participantes: 'u1,u2,u3', fecha: '2026-09-13T10:00:00.000Z', estado: 'pendiente' },
  { id: 'g2', motivo: 'bienvenida', descripcion: 'Pedro', valorTotal: 12000, participantes: 'u1,u2', fecha: '2026-09-06T10:00:00.000Z', estado: 'anulado' }
];

const PAGOS = [
  { id: 'pg1', usuarioId: 'u1', valor: 4000, aplicadoA: '', fecha: '2026-09-13T12:00:00.000Z', estado: 'pendiente' },
  { id: 'pg2', usuarioId: 'u1', valor: 9999, aplicadoA: 't3', fecha: '2026-09-09T12:00:00.000Z', estado: 'pendiente' },
  { id: 'pg3', usuarioId: 'u1', valor: 1000, aplicadoA: '', fecha: '2026-09-05T12:00:00.000Z', estado: 'anulado' }
];

const MOVIMIENTOS = { transacciones: TRANSACCIONES, prestamos: PRESTAMOS, gastos: GASTOS, pagos: PAGOS };

test('calcularSaldoUsuario suma fiado, prestamos y cuotas, y resta abonos generales', () => {
  // fiado 3000 + 2000, prestamo 20000, cuota 10000, menos abono general 4000
  assert.strictEqual(calcularSaldoUsuario(MOVIMIENTOS, 'u1'), 31000);
});

test('calcularSaldoUsuario ignora anulados y pagos dirigidos', () => {
  // el prestamo pr2 y el gasto g2 estan anulados; pg2 es dirigido y pg3 anulado
  const soloAnulados = { transacciones: [], prestamos: [PRESTAMOS[1]], gastos: [GASTOS[1]], pagos: [PAGOS[1], PAGOS[2]] };
  assert.strictEqual(calcularSaldoUsuario(soloAnulados, 'u1'), 0);
});

test('calcularSaldoUsuario devuelve cero para un usuario sin movimientos', () => {
  assert.strictEqual(calcularSaldoUsuario(MOVIMIENTOS, 'u9'), 0);
});

test('calcularSaldoUsuario tolera colecciones ausentes', () => {
  assert.strictEqual(calcularSaldoUsuario({ transacciones: TRANSACCIONES }, 'u1'), 5000);
});

test('desglosarSaldoUsuario lista todo de mas reciente a mas antiguo', () => {
  // pg1 es del 13 a las 12:00 y g1 del 13 a las 10:00, asi que el abono va primero
  const desglose = desglosarSaldoUsuario(MOVIMIENTOS, 'u1');
  assert.deepStrictEqual(desglose.map(d => d.id), ['pg1', 'g1', 'pr1', 't2', 't1']);
});

test('desglosarSaldoUsuario marca el tipo de cada linea', () => {
  const porId = {};
  desglosarSaldoUsuario(MOVIMIENTOS, 'u1').forEach(d => { porId[d.id] = d; });
  assert.strictEqual(porId.t1.tipo, 'fiado');
  assert.strictEqual(porId.pr1.tipo, 'prestamo');
  assert.strictEqual(porId.g1.tipo, 'gasto');
  assert.strictEqual(porId.pg1.tipo, 'abono');
});

test('desglosarSaldoUsuario muestra el abono en negativo', () => {
  const abono = desglosarSaldoUsuario(MOVIMIENTOS, 'u1').find(d => d.tipo === 'abono');
  assert.strictEqual(abono.valorTotal, -4000);
});

test('desglosarSaldoUsuario describe la cuota del gasto', () => {
  const cuota = desglosarSaldoUsuario(MOVIMIENTOS, 'u1').find(d => d.tipo === 'gasto');
  assert.strictEqual(cuota.valorTotal, 10000);
  assert.strictEqual(cuota.concepto, 'Cumpleanos: Torta de Ana');
});
```

- [ ] **Step 2: Correr las pruebas para verificar que fallan**

Run: `npm test`
Expected: FAIL — `calcularSaldoUsuario` recibe hoy un arreglo, no un objeto, asi que devuelve `0` donde se espera `31000`.

- [ ] **Step 3: Reescribir `src/dominio/saldo.js`**

```javascript
if (typeof require !== 'undefined') {
  var gastosModulo = require('./gastosCompartidos.js');
  var cuotasDeGasto = gastosModulo.cuotasDeGasto;
  var pagosModulo = require('./pagos.js');
  var esAbonoGeneral = pagosModulo.esAbonoGeneral;
}

function estaPendiente(registro) {
  return registro.estado === 'pendiente';
}

function lineasDeUsuario(movimientos, usuarioId) {
  const transacciones = movimientos.transacciones || [];
  const prestamos = movimientos.prestamos || [];
  const gastos = movimientos.gastos || [];
  const pagos = movimientos.pagos || [];
  const lineas = [];

  transacciones.forEach(function (transaccion) {
    if (transaccion.usuarioId === usuarioId && estaPendiente(transaccion)) {
      lineas.push({
        id: transaccion.id,
        fecha: transaccion.fecha,
        tipo: 'fiado',
        concepto: transaccion.productoNombre,
        cantidad: transaccion.cantidad,
        valorTotal: transaccion.valorTotal
      });
    }
  });

  prestamos.forEach(function (prestamo) {
    if (prestamo.usuarioId === usuarioId && estaPendiente(prestamo)) {
      lineas.push({
        id: prestamo.id,
        fecha: prestamo.fecha,
        tipo: 'prestamo',
        concepto: 'Prestamo en efectivo',
        cantidad: 1,
        valorTotal: prestamo.valor
      });
    }
  });

  gastos.forEach(function (gasto) {
    cuotasDeGasto(gasto).forEach(function (cuota) {
      if (cuota.usuarioId === usuarioId) {
        const titulo = cuota.motivo.charAt(0).toUpperCase() + cuota.motivo.slice(1);
        lineas.push({
          id: gasto.id,
          fecha: cuota.fecha,
          tipo: 'gasto',
          concepto: cuota.descripcion ? titulo + ': ' + cuota.descripcion : titulo,
          cantidad: 1,
          valorTotal: cuota.valor
        });
      }
    });
  });

  pagos.forEach(function (pago) {
    if (pago.usuarioId === usuarioId && estaPendiente(pago) && esAbonoGeneral(pago)) {
      lineas.push({
        id: pago.id,
        fecha: pago.fecha,
        tipo: 'abono',
        concepto: 'Abono',
        cantidad: 1,
        valorTotal: -pago.valor
      });
    }
  });

  return lineas;
}

function calcularSaldoUsuario(movimientos, usuarioId) {
  return lineasDeUsuario(movimientos, usuarioId).reduce(function (total, linea) {
    return total + linea.valorTotal;
  }, 0);
}

function desglosarSaldoUsuario(movimientos, usuarioId) {
  return lineasDeUsuario(movimientos, usuarioId).sort(function (a, b) {
    return String(b.fecha).localeCompare(String(a.fecha));
  });
}

if (typeof module !== 'undefined') {
  module.exports = { calcularSaldoUsuario, desglosarSaldoUsuario };
}
```

- [ ] **Step 4: Correr las pruebas para verificar que pasan**

Run: `npm test`
Expected: PASS — 83 pruebas.

- [ ] **Step 5: Actualizar `estadoDeUsuario` en `src/app/api.js`**

Reemplazar la funcion completa:

```javascript
function leerMovimientos(libro) {
  return {
    transacciones: leerTodo(libro, 'Transacciones'),
    prestamos: leerTodo(libro, 'Prestamos'),
    gastos: leerTodo(libro, 'GastosCompartidos'),
    pagos: leerTodo(libro, 'Pagos')
  };
}

function estadoDeUsuario(usuario) {
  const movimientos = leerMovimientos(obtenerLibro());
  return {
    autenticado: true,
    nombre: usuario.nombre,
    rol: usuario.rol,
    saldo: calcularSaldoUsuario(movimientos, usuario.id),
    desglose: desglosarSaldoUsuario(movimientos, usuario.id),
    productos: productosVisibles(),
    mensaje: ''
  };
}
```

- [ ] **Step 6: Mostrar el tipo de movimiento en "Mi cuenta"**

En `src/web/micuenta.html`, cambiar el encabezado de la tabla para incluir la columna de tipo:

```html
            <tr><th>Fecha</th><th>Concepto</th><th class="valor">Cant.</th><th class="valor">Valor</th></tr>
```

Y reemplazar el bucle que pinta el desglose para que use `concepto` (que ya trae el texto correcto por tipo) y marque los abonos:

```javascript
        var cuerpo = document.getElementById('desglose');
        cuerpo.innerHTML = '';
        estado.desglose.forEach(function (linea) {
          var fila = document.createElement('tr');
          [fechaCorta(linea.fecha), linea.concepto, String(linea.cantidad), pesos(linea.valorTotal)].forEach(function (texto, indice) {
            var celda = document.createElement('td');
            if (indice >= 2) { celda.className = 'valor'; }
            celda.textContent = texto;
            fila.appendChild(celda);
          });
          cuerpo.appendChild(fila);
        });
```

- [ ] **Step 7: Correr las pruebas**

Run: `npm test`
Expected: PASS — 83 pruebas.

- [ ] **Step 8: Commit**

```bash
git add src/dominio/saldo.js test/dominio/saldo.test.js src/app/api.js src/web/micuenta.html
git commit -m "feat: saldo del comprador suma prestamos y cuotas y resta abonos"
```

---

### Task 7: Costo historico en la transaccion y reporte de ganancia

**Files:**
- Modify: `src/dominio/transacciones.js`
- Modify: `test/dominio/transacciones.test.js`
- Create: `src/dominio/reportes.js`
- Create: `test/dominio/reportes.test.js`
- Modify: `src/app/api.js`

**Interfaces:**
- Consumes: `ESQUEMA.Transacciones` con `costoUnitario` de Task 1.
- Produces:
  - `crearTransaccionFiado` agrega `costoUnitario` al objeto que devuelve.
  - `reporteGanancia(transacciones, productos, desde, hasta) -> { total, estimado, porProducto: [...] }`
  - `apiReporteGanancia(token, desde, hasta)`

- [ ] **Step 1: Agregar la prueba del costo historico**

Agregar al final de `test/dominio/transacciones.test.js`:

```javascript
test('crearTransaccionFiado guarda el costo del producto al momento de la venta', () => {
  const transaccion = crearTransaccionFiado({
    id: 't9', usuarioId: 'u1', producto: PRODUCTO, cantidad: 2,
    fecha: '2026-09-14T10:00:00.000Z', origen: 'autoregistro'
  });
  assert.strictEqual(transaccion.costoUnitario, PRODUCTO.costo);
});
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

Run: `npm test`
Expected: FAIL — `costoUnitario` es `undefined`.

- [ ] **Step 3: Agregar `costoUnitario` en `crearTransaccionFiado`**

En `src/dominio/transacciones.js`, agregar la propiedad al objeto que devuelve, despues de `anuladoMotivo`:

```javascript
    anuladoMotivo: '',
    costoUnitario: datos.producto.costo
```

- [ ] **Step 4: Correr las pruebas para verificar que pasan**

Run: `npm test`
Expected: PASS — 84 pruebas.

- [ ] **Step 5: Escribir las pruebas del reporte de ganancia**

Crear `test/dominio/reportes.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert');
const { reporteGanancia } = require('../../src/dominio/reportes.js');

const PRODUCTOS = [
  { id: 'p1', nombre: 'Cafe', costo: 900, precioVenta: 1500 },
  { id: 'p2', nombre: 'Galletas', costo: 1200, precioVenta: 2000 }
];

const TRANSACCIONES = [
  { id: 't1', productoId: 'p1', productoNombre: 'Cafe', cantidad: 2, valorUnitario: 1500, valorTotal: 3000, costoUnitario: 800, fecha: '2026-09-10T10:00:00.000Z', estado: 'pendiente' },
  { id: 't2', productoId: 'p2', productoNombre: 'Galletas', cantidad: 1, valorUnitario: 2000, valorTotal: 2000, costoUnitario: 1200, fecha: '2026-09-11T10:00:00.000Z', estado: 'pagado' },
  { id: 't3', productoId: 'p1', productoNombre: 'Cafe', cantidad: 5, valorUnitario: 1500, valorTotal: 7500, costoUnitario: 800, fecha: '2026-09-12T10:00:00.000Z', estado: 'anulado' },
  { id: 't4', productoId: 'p1', productoNombre: 'Cafe', cantidad: 1, valorUnitario: 1500, valorTotal: 1500, costoUnitario: '', fecha: '2026-09-13T10:00:00.000Z', estado: 'pendiente' }
];

test('reporteGanancia usa el costo guardado en la transaccion', () => {
  const reporte = reporteGanancia([TRANSACCIONES[0]], PRODUCTOS, '2026-09-01', '2026-09-30');
  assert.strictEqual(reporte.total, 1400);
  assert.strictEqual(reporte.estimado, false);
});

test('reporteGanancia ignora las anuladas', () => {
  const reporte = reporteGanancia(TRANSACCIONES, PRODUCTOS, '2026-09-12', '2026-09-12');
  assert.strictEqual(reporte.total, 0);
});

test('reporteGanancia cae al costo actual cuando la transaccion no lo guardo', () => {
  const reporte = reporteGanancia([TRANSACCIONES[3]], PRODUCTOS, '2026-09-01', '2026-09-30');
  assert.strictEqual(reporte.total, 600);
  assert.strictEqual(reporte.estimado, true);
});

test('reporteGanancia agrupa por producto', () => {
  const reporte = reporteGanancia(TRANSACCIONES, PRODUCTOS, '2026-09-01', '2026-09-30');
  assert.strictEqual(reporte.total, 2800);
  const cafe = reporte.porProducto.find(p => p.productoId === 'p1');
  assert.strictEqual(cafe.cantidad, 3);
  assert.strictEqual(cafe.ingresos, 4500);
  assert.strictEqual(cafe.ganancia, 2000);
});

test('reporteGanancia ordena de mayor a menor ganancia', () => {
  const reporte = reporteGanancia(TRANSACCIONES, PRODUCTOS, '2026-09-01', '2026-09-30');
  assert.deepStrictEqual(reporte.porProducto.map(p => p.productoId), ['p1', 'p2']);
});

test('reporteGanancia respeta el rango de fechas', () => {
  const reporte = reporteGanancia(TRANSACCIONES, PRODUCTOS, '2026-09-11', '2026-09-11');
  assert.strictEqual(reporte.total, 800);
});
```

- [ ] **Step 6: Correr las pruebas para verificar que fallan**

Run: `npm test`
Expected: FAIL con `Cannot find module '../../src/dominio/reportes.js'`

- [ ] **Step 7: Implementar `reporteGanancia` en `src/dominio/reportes.js`**

```javascript
function dentroDelRango(fecha, desde, hasta) {
  const dia = String(fecha || '').slice(0, 10);
  if (dia === '') {
    return false;
  }
  if (desde && dia < String(desde).slice(0, 10)) {
    return false;
  }
  if (hasta && dia > String(hasta).slice(0, 10)) {
    return false;
  }
  return true;
}

function noAnulado(registro) {
  return registro.estado !== 'anulado';
}

function reporteGanancia(transacciones, productos, desde, hasta) {
  const costoActualPorId = {};
  (productos || []).forEach(function (producto) {
    costoActualPorId[producto.id] = producto.costo;
  });

  const acumulado = {};
  let estimado = false;

  (transacciones || [])
    .filter(function (transaccion) {
      return noAnulado(transaccion) && dentroDelRango(transaccion.fecha, desde, hasta);
    })
    .forEach(function (transaccion) {
      let costo = Number(transaccion.costoUnitario);
      if (!costo) {
        costo = Number(costoActualPorId[transaccion.productoId]) || 0;
        estimado = true;
      }
      const clave = transaccion.productoId;
      if (!acumulado[clave]) {
        acumulado[clave] = {
          productoId: clave,
          nombre: transaccion.productoNombre,
          cantidad: 0,
          ingresos: 0,
          costos: 0,
          ganancia: 0
        };
      }
      const fila = acumulado[clave];
      fila.cantidad += transaccion.cantidad;
      fila.ingresos += transaccion.valorTotal;
      fila.costos += costo * transaccion.cantidad;
      fila.ganancia = fila.ingresos - fila.costos;
    });

  const porProducto = Object.keys(acumulado)
    .map(function (clave) { return acumulado[clave]; })
    .sort(function (a, b) { return b.ganancia - a.ganancia; });

  return {
    total: porProducto.reduce(function (suma, fila) { return suma + fila.ganancia; }, 0),
    estimado: estimado,
    porProducto: porProducto
  };
}

if (typeof module !== 'undefined') {
  module.exports = { reporteGanancia, dentroDelRango, noAnulado };
}
```

- [ ] **Step 8: Correr las pruebas para verificar que pasan**

Run: `npm test`
Expected: PASS — 90 pruebas.

- [ ] **Step 9: Commit**

El endpoint no se agrega aqui a proposito: Task 8 expone los cuatro reportes de una sola vez con `apiReportes`, asi que crear ahora un `apiReporteGanancia` que se borra en la tarea siguiente solo ensucia el historial. Esta tarea entrega el dominio del reporte y el costo historico.

```bash
git add src/dominio/transacciones.js test/dominio/transacciones.test.js src/dominio/reportes.js test/dominio/reportes.test.js
git commit -m "feat: costo historico en la transaccion y reporte de ganancia por producto"
```

---

### Task 8: Reportes de perdidas, cartera e historico de gastos

**Files:**
- Modify: `src/dominio/reportes.js`
- Modify: `test/dominio/reportes.test.js`
- Modify: `src/app/api.js`
- Modify: `src/web/admin.html`

**Interfaces:**
- Consumes: `dentroDelRango` y `noAnulado` de Task 7; `calcularSaldoUsuario` de Task 6; `cuotasDeGasto` de Task 4.
- Produces:
  - `reportePerdidas(perdidas, desde, hasta) -> { total, lineas }`
  - `reporteCartera(movimientos, usuarios) -> { total, porUsuario }`
  - `reporteGastosCompartidos(gastos) -> [{ motivo, cantidad, total, gastos: [...] }]`
  - `apiReportes(token, desde, hasta)` — devuelve los cuatro reportes de una.

- [ ] **Step 1: Escribir las pruebas que fallan**

Agregar al final de `test/dominio/reportes.test.js`:

```javascript
const { reportePerdidas, reporteCartera, reporteGastosCompartidos } = require('../../src/dominio/reportes.js');

const PERDIDAS = [
  { id: 'pe1', productoNombre: 'Cafe', cantidad: 2, motivo: 'se vencio', valor: 1600, fecha: '2026-09-10T10:00:00.000Z', estado: 'pendiente' },
  { id: 'pe2', productoNombre: 'Galletas', cantidad: 1, motivo: 'se daño', valor: 1200, fecha: '2026-09-11T10:00:00.000Z', estado: 'pendiente' },
  { id: 'pe3', productoNombre: 'Cafe', cantidad: 5, motivo: 'error', valor: 4000, fecha: '2026-09-11T10:00:00.000Z', estado: 'anulado' }
];

test('reportePerdidas suma solo las no anuladas del rango', () => {
  const reporte = reportePerdidas(PERDIDAS, '2026-09-01', '2026-09-30');
  assert.strictEqual(reporte.total, 2800);
  assert.strictEqual(reporte.lineas.length, 2);
});

test('reportePerdidas respeta el rango de fechas', () => {
  assert.strictEqual(reportePerdidas(PERDIDAS, '2026-09-10', '2026-09-10').total, 1600);
});

const USUARIOS = [
  { id: 'u1', nombre: 'Ana', activo: true },
  { id: 'u2', nombre: 'Beto', activo: true },
  { id: 'u3', nombre: 'Inactivo', activo: false },
  { id: 'u4', nombre: 'Perdidas', activo: true, esPseudoUsuario: true }
];

test('reporteCartera suma el saldo de cada usuario activo', () => {
  const movimientos = {
    transacciones: [
      { id: 't1', usuarioId: 'u1', productoNombre: 'Cafe', cantidad: 1, valorTotal: 3000, fecha: '2026-09-10T10:00:00.000Z', estado: 'pendiente' },
      { id: 't2', usuarioId: 'u2', productoNombre: 'Cafe', cantidad: 1, valorTotal: 1500, fecha: '2026-09-10T10:00:00.000Z', estado: 'pendiente' }
    ],
    prestamos: [], gastos: [], pagos: []
  };
  const reporte = reporteCartera(movimientos, USUARIOS);
  assert.strictEqual(reporte.total, 4500);
  assert.deepStrictEqual(reporte.porUsuario.map(u => u.nombre), ['Ana', 'Beto']);
  assert.strictEqual(reporte.porUsuario[0].saldo, 3000);
});

test('reporteCartera omite a quien no debe nada', () => {
  const movimientos = { transacciones: [], prestamos: [], gastos: [], pagos: [] };
  assert.deepStrictEqual(reporteCartera(movimientos, USUARIOS).porUsuario, []);
});

test('reporteCartera excluye a los pseudo-usuarios aunque tengan movimientos', () => {
  const movimientos = {
    transacciones: [
      { id: 't1', usuarioId: 'u4', productoNombre: 'Cafe', cantidad: 1, valorTotal: 3000, fecha: '2026-09-10T10:00:00.000Z', estado: 'pendiente' }
    ],
    prestamos: [], gastos: [], pagos: []
  };
  const reporte = reporteCartera(movimientos, USUARIOS);
  assert.deepStrictEqual(reporte.porUsuario, []);
  assert.strictEqual(reporte.total, 0);
});

const GASTOS_REPORTE = [
  { id: 'g1', motivo: 'cumpleanos', descripcion: 'Ana', valorTotal: 30000, participantes: 'u1,u2,u3', fecha: '2026-09-13T10:00:00.000Z', estado: 'pendiente' },
  { id: 'g2', motivo: 'cumpleanos', descripcion: 'Beto', valorTotal: 20000, participantes: 'u1,u2', fecha: '2026-09-01T10:00:00.000Z', estado: 'pendiente' },
  { id: 'g3', motivo: 'bienvenida', descripcion: 'Pedro', valorTotal: 12000, participantes: 'u1,u2', fecha: '2026-09-05T10:00:00.000Z', estado: 'pendiente' },
  { id: 'g4', motivo: 'otro', descripcion: 'Anulado', valorTotal: 5000, participantes: 'u1', fecha: '2026-09-06T10:00:00.000Z', estado: 'anulado' }
];

test('reporteGastosCompartidos agrupa por motivo', () => {
  const grupos = reporteGastosCompartidos(GASTOS_REPORTE);
  assert.deepStrictEqual(grupos.map(g => g.motivo), ['cumpleanos', 'bienvenida']);
  assert.strictEqual(grupos[0].cantidad, 2);
  assert.strictEqual(grupos[0].total, 50000);
});

test('reporteGastosCompartidos detalla el valor por persona', () => {
  const grupos = reporteGastosCompartidos(GASTOS_REPORTE);
  const cumple = grupos[0].gastos.find(g => g.id === 'g1');
  assert.strictEqual(cumple.participantes, 3);
  assert.strictEqual(cumple.valorPorPersona, 10000);
});
```

- [ ] **Step 2: Correr las pruebas para verificar que fallan**

Run: `npm test`
Expected: FAIL — `reportePerdidas is not a function`.

- [ ] **Step 3: Implementar los tres reportes en `src/dominio/reportes.js`**

Agregar el bloque de require al inicio del archivo (antes de `dentroDelRango`):

```javascript
if (typeof require !== 'undefined') {
  var saldoModulo = require('./saldo.js');
  var calcularSaldoUsuario = saldoModulo.calcularSaldoUsuario;
  var gastosModulo = require('./gastosCompartidos.js');
  var cuotasDeGasto = gastosModulo.cuotasDeGasto;
}
```

Y agregar las tres funciones antes del `module.exports`:

```javascript
function reportePerdidas(perdidas, desde, hasta) {
  const lineas = (perdidas || [])
    .filter(function (perdida) {
      return noAnulado(perdida) && dentroDelRango(perdida.fecha, desde, hasta);
    })
    .map(function (perdida) {
      return {
        id: perdida.id,
        fecha: perdida.fecha,
        producto: perdida.productoNombre,
        cantidad: perdida.cantidad,
        motivo: perdida.motivo,
        valor: perdida.valor
      };
    })
    .sort(function (a, b) { return String(b.fecha).localeCompare(String(a.fecha)); });

  return {
    total: lineas.reduce(function (suma, linea) { return suma + linea.valor; }, 0),
    lineas: lineas
  };
}

function reporteCartera(movimientos, usuarios) {
  const porUsuario = (usuarios || [])
    .filter(function (usuario) {
      // los pseudo-usuarios existen solo para agregar reportes, no tienen saldo propio
      return usuario.activo === true && usuario.esPseudoUsuario !== true;
    })
    .map(function (usuario) {
      return {
        usuarioId: usuario.id,
        nombre: usuario.nombre,
        saldo: calcularSaldoUsuario(movimientos, usuario.id)
      };
    })
    .filter(function (fila) { return fila.saldo !== 0; })
    .sort(function (a, b) { return b.saldo - a.saldo; });

  return {
    total: porUsuario.reduce(function (suma, fila) { return suma + fila.saldo; }, 0),
    porUsuario: porUsuario
  };
}

function reporteGastosCompartidos(gastos) {
  const grupos = {};
  const orden = [];

  (gastos || [])
    .filter(noAnulado)
    .sort(function (a, b) { return String(b.fecha).localeCompare(String(a.fecha)); })
    .forEach(function (gasto) {
      const cuotas = cuotasDeGasto(gasto);
      if (!grupos[gasto.motivo]) {
        grupos[gasto.motivo] = { motivo: gasto.motivo, cantidad: 0, total: 0, gastos: [] };
        orden.push(gasto.motivo);
      }
      const grupo = grupos[gasto.motivo];
      grupo.cantidad += 1;
      grupo.total += gasto.valorTotal;
      grupo.gastos.push({
        id: gasto.id,
        fecha: gasto.fecha,
        descripcion: gasto.descripcion,
        valorTotal: gasto.valorTotal,
        participantes: cuotas.length,
        valorPorPersona: cuotas.length > 0 ? cuotas[0].valor : 0
      });
    });

  return orden.map(function (motivo) { return grupos[motivo]; });
}
```

Actualizar el `module.exports`:

```javascript
if (typeof module !== 'undefined') {
  module.exports = {
    reporteGanancia,
    reportePerdidas,
    reporteCartera,
    reporteGastosCompartidos,
    dentroDelRango,
    noAnulado
  };
}
```

- [ ] **Step 4: Correr las pruebas para verificar que pasan**

Run: `npm test`
Expected: PASS — 97 pruebas.

- [ ] **Step 5: Agregar el endpoint agregador en `src/app/api.js`**

Reemplazar `apiReporteGanancia` por uno que devuelva los cuatro:

```javascript
function apiReportes(token, desde, hasta) {
  try {
    exigirAdmin(token);
    const libro = obtenerLibro();
    const movimientos = leerMovimientos(libro);
    const productos = leerTodo(libro, 'Productos');
    const usuarios = leerTodo(libro, 'Usuarios');
    const perdidas = leerTodo(libro, 'Perdidas');
    return {
      ok: true,
      mensaje: '',
      ganancia: reporteGanancia(movimientos.transacciones, productos, desde, hasta),
      perdidas: reportePerdidas(perdidas, desde, hasta),
      cartera: reporteCartera(movimientos, usuarios),
      gastos: reporteGastosCompartidos(movimientos.gastos)
    };
  } catch (error) {
    return {
      ok: false,
      mensaje: error.message,
      ganancia: { total: 0, estimado: false, porProducto: [] },
      perdidas: { total: 0, lineas: [] },
      cartera: { total: 0, porUsuario: [] },
      gastos: []
    };
  }
}
```

- [ ] **Step 6: Agregar la tarjeta de reportes al panel admin**

En `src/web/admin.html`, insertar antes de la tarjeta de "Ultimos movimientos":

```html
      <div class="tarjeta">
        <h2>Reportes</h2>
        <label for="desdeReporte">Desde</label>
        <input id="desdeReporte" type="date">
        <label for="hastaReporte">Hasta</label>
        <input id="hastaReporte" type="date">
        <button id="btnReportes">Ver reportes</button>
        <div id="avisoReportes"></div>
        <div id="resumenReportes"></div>
        <h3>Ganancia por producto</h3>
        <table>
          <thead>
            <tr><th>Producto</th><th class="valor">Cant.</th><th class="valor">Ingresos</th><th class="valor">Ganancia</th></tr>
          </thead>
          <tbody id="tablaGanancia"></tbody>
        </table>
        <h3>Cartera pendiente</h3>
        <table>
          <thead>
            <tr><th>Comprador</th><th class="valor">Saldo</th></tr>
          </thead>
          <tbody id="tablaCartera"></tbody>
        </table>
        <h3>Perdidas</h3>
        <table>
          <thead>
            <tr><th>Fecha</th><th>Producto</th><th>Motivo</th><th class="valor">Valor</th></tr>
          </thead>
          <tbody id="tablaPerdidas"></tbody>
        </table>
      </div>
```

Y el handler, que pinta las tres tablas:

```javascript
      function pintarFilas(idCuerpo, filas) {
        var cuerpo = document.getElementById(idCuerpo);
        cuerpo.innerHTML = '';
        filas.forEach(function (celdas) {
          var fila = document.createElement('tr');
          celdas.forEach(function (texto, indice) {
            var celda = document.createElement('td');
            if (indice > 0) { celda.className = 'valor'; }
            celda.textContent = texto;
            fila.appendChild(celda);
          });
          cuerpo.appendChild(fila);
        });
      }

      document.getElementById('btnReportes').addEventListener('click', function () {
        var boton = this;
        boton.disabled = true;
        google.script.run.withSuccessHandler(function (respuesta) {
          boton.disabled = false;
          if (!respuesta.ok) {
            mostrarAviso('avisoReportes', respuesta.mensaje, true);
            return;
          }
          mostrarAviso('avisoReportes', '', false);
          var resumen = 'Ganancia: ' + pesos(respuesta.ganancia.total) +
            ' · Perdidas: ' + pesos(respuesta.perdidas.total) +
            ' · Cartera: ' + pesos(respuesta.cartera.total);
          if (respuesta.ganancia.estimado) {
            resumen += ' (la ganancia incluye ventas sin costo historico, calculadas con el costo actual)';
          }
          document.getElementById('resumenReportes').textContent = resumen;

          pintarFilas('tablaGanancia', respuesta.ganancia.porProducto.map(function (fila) {
            return [fila.nombre, String(fila.cantidad), pesos(fila.ingresos), pesos(fila.ganancia)];
          }));
          pintarFilas('tablaCartera', respuesta.cartera.porUsuario.map(function (fila) {
            return [fila.nombre, pesos(fila.saldo)];
          }));
          pintarFilas('tablaPerdidas', respuesta.perdidas.lineas.map(function (fila) {
            return [fechaCorta(fila.fecha), fila.producto, fila.motivo, pesos(fila.valor)];
          }));
        }).apiReportes(
          token,
          document.getElementById('desdeReporte').value,
          document.getElementById('hastaReporte').value
        );
      });
```

- [ ] **Step 7: Correr las pruebas**

Run: `npm test`
Expected: PASS — 97 pruebas.

- [ ] **Step 8: Commit**

```bash
git add src/dominio/reportes.js test/dominio/reportes.test.js src/app/api.js src/web/admin.html
git commit -m "feat: reportes de perdidas, cartera pendiente e historico de gastos compartidos"
```

---

### Task 9: Anulacion de los movimientos nuevos desde el panel

Hueco detectado al terminar la Task 8: las Tasks 2-5 crean `apiAnularPrestamo`, `apiAnularPerdida` y `apiAnularGastoCompartido`, pero ningun HTML los llama, asi que el admin solo podia anular fiado. La seccion 3 del spec exige poder "anular cualquier movimiento con motivo", y el principio general de correccion dice que nada se borra a mano.

**Files:**
- Modify: `src/app/api.js`
- Modify: `src/web/admin.html`

**Interfaces:**
- Consumes: los cuatro `apiAnular*` de las Tasks 2-5.
- Produces:
  - `apiAnularPago(token, pagoId, motivo)` — faltaba; el esquema de Pagos ya tenia los campos de anulacion y `saldo.js` ya filtra por estado.
  - `apiListarMovimientosRecientes(token) -> { ok, mensaje, movimientos }` con los cinco tipos unificados en `{ id, tipo, fecha, quien, concepto, valor, estado }`, ordenados de mas reciente a mas antiguo, los ultimos 50.
  - `apiAnularMovimiento(token, tipo, movimientoId, motivo)` que enruta al `apiAnular*` correcto.
- Reemplaza: `apiListarTransaccionesRecientes` queda sin uso y se borra.

- [ ] **Step 1: Agregar `apiAnularPago`, `apiListarMovimientosRecientes` y `apiAnularMovimiento` en `src/app/api.js`**

El abono se lista con `valor` negativo para que se lea como lo que es: algo que baja el saldo. Las perdidas y los gastos van con `quien: '-'` porque no pertenecen a un comprador.

- [ ] **Step 2: Apuntar la tabla del panel al endpoint unificado**

En `src/web/admin.html`, `cargarMovimientos` pasa a consumir `respuesta.movimientos` (campos `quien`, `concepto`, `valor`) en vez de `respuesta.transacciones`, y el boton Anular llama `apiAnularMovimiento(token, movimiento.tipo, movimiento.id, motivo)`. El encabezado "Producto" pasa a "Concepto", porque ahora lista prestamos, abonos, perdidas y gastos ademas de productos.

- [ ] **Step 3: Borrar `apiListarTransaccionesRecientes`**

Quedo huerfana. Verificar primero con `grep -rn apiListarTransaccionesRecientes src/` que solo aparezca su definicion.

- [ ] **Step 4: Verificar**

```bash
node --check src/app/api.js
npm test
```
Expected: sintaxis OK y 97 pruebas en verde. Las pruebas no cubren `api.js` (depende de Apps Script), asi que ademas hay que cruzar los endpoints que llaman los HTML contra los definidos:

```bash
grep -oh "\.api[A-Za-z]*(" src/web/*.html | sed 's/^\.//; s/(//' | sort -u > /tmp/ll.txt
grep -oh "^function \(api[A-Za-z]*\)" src/app/api.js | sed 's/function //' | sort -u > /tmp/df.txt
comm -23 /tmp/ll.txt /tmp/df.txt
```
Expected: salida vacia — ningun HTML llama algo que no exista.

- [ ] **Step 5: Commit**

```bash
git add src/app/api.js src/web/admin.html
git commit -m "feat: anulacion de prestamos, abonos, perdidas y gastos desde el panel"
```

---

### Task 10: Despliegue y verificacion en produccion

Las 97 pruebas cubren la logica pura, pero nada de lo que corre dentro de Apps Script (I/O contra Sheets, bloqueos, la interfaz) se prueba localmente. Esta tarea la ejecuta Andres.

**Files:** ninguno — es despliegue y verificacion manual.

- [ ] **Step 1: Subir el codigo**

Run: `npm run push`
(Si el shell no reconoce `clasp`, usar `npx @google/clasp push`.)

- [ ] **Step 2: Crear las hojas nuevas**

En el editor de Apps Script (script.google.com), elegir `configurarInicial` en el desplegable de funciones y darle Ejecutar. Esto crea las hojas `Prestamos`, `Pagos`, `Perdidas` y `GastosCompartidos` con sus encabezados, y agrega la columna `costoUnitario` al final de `Transacciones`.

Verificar en la hoja de calculo que aparezcan las cuatro pestanas nuevas.

- [ ] **Step 3: Publicar la version nueva**

En el editor: Implementar → Gestionar implementaciones → editar la implementacion existente → Version: Nueva version → Implementar. Sin esto la web app sigue sirviendo el codigo viejo.

- [ ] **Step 4: Verificar el panel de administrador**

Abrir la URL de la web app y comprobar, una por una:
- Prestar efectivo a un comprador. Su saldo sube por ese valor.
- Registrar una perdida. El stock del producto baja y el saldo de los compradores no cambia.
- Repartir un gasto compartido entre tres personas. A cada una le aparece su cuota.
- Registrar un abono. El saldo de esa persona baja por el valor abonado.
- Ver reportes con un rango que incluya hoy. Ganancia, cartera y perdidas muestran numeros coherentes con lo anterior.
- En "Ultimos movimientos" deben aparecer los cinco tipos. Anular el prestamo de prueba y confirmar que el saldo de esa persona vuelve a bajar, y anular la perdida de prueba y confirmar que el stock se devuelve.

- [ ] **Step 5: Verificar la vista del comprador**

Entrar como un comprador (o pedirle a alguien que lo haga) y confirmar que "Lo que estoy debiendo" muestra las lineas de fiado, prestamo, cuota de gasto y el abono en negativo, ordenadas de mas reciente a mas antigua, y que el saldo de arriba coincide con la suma de esa tabla.

- [ ] **Step 6: Verificar el reparto con residuo**

Repartir un gasto de 10000 entre 3 personas. Las cuotas deben ser 3334, 3333 y 3333 — que suman exactamente 10000, sin peso perdido.

---

## Fuera de alcance de este plan

La seccion 4.2 del spec (ingreso de inventario por foto de factura con Gemini API) queda para un plan aparte: necesita una API key de Google AI Studio, manejo de imagenes y una pantalla de resumen editable, y no depende de nada de Fase 2.

Tampoco se implementa aqui el pago dirigido a movimientos especificos desde la interfaz (`aplicadoA` con ids). El modelo de datos ya lo soporta y `crearPago` lo acepta, pero el panel solo ofrece abono general, que es lo que resuelve el caso real de hoy. Cuando haga falta saldar un movimiento puntual, se agrega la pantalla sin tocar el dominio.
