# Fiado multiproducto (admin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que "Registrar fiado a nombre de alguien" (panel admin) registre varios productos con su cantidad en una sola operación, en vez de un producto por envío.

**Architecture:** El bloque admin gana una tabla de líneas (producto + cantidad) que replica el patrón que ya existe para "Ingresar factura". El backend valida todas las líneas antes de escribir nada (todo o nada: producto existe/activo, stock suficiente sumando cantidades repetidas) y luego crea **una fila de Transaccion por línea**, reusando exactamente la lógica de consumo FIFO que ya usa el registro de un solo producto — solo se extrae esa lógica a una función sin bloqueo para poder llamarla en bucle dentro de un único `LockService` lock.

**Tech Stack:** Google Apps Script + Google Sheets, HTML Service (`admin.html`), `node --test` para la capa dominio.

**Spec:** No hay spec escrito — este es un cambio acotado (bounded) cuyo diseño se acordó directamente en el chat con Andrés (ver resumen de diseño en la conversación del 2026-09-29: reemplazar producto+cantidad únicos por una tabla de líneas en "Registrar fiado a nombre de alguien", siguiendo el patrón ya usado en "Ingresar factura").

## Global Constraints

- Dinero siempre entero (pesos colombianos) — no aplica cálculo nuevo aquí, pero `cantidad` y `costoUnitario` que ya fluyen por `crearTransaccionFiado` siguen enteros.
- Nada se elimina nunca: cada transacción creada sigue siendo anulable individualmente vía `anularTransaccion`/`apiAnularTransaccion`, sin cambios en ese camino.
- No se toca `ESQUEMA` (`src/datos/esquema.js`) — no hay columnas nuevas; cada línea sigue produciendo una fila de `Transacciones` con las mismas columnas de siempre.
- Identificadores, mensajes de error y de UI en español, sin tildes en identificadores.
- Patrón dual Apps Script/Node en todo archivo de `src/dominio/`: abre con `if (typeof require !== 'undefined') { var x = require(...) }` (siempre `var`, nunca `const`) y cierra con `if (typeof module !== 'undefined') { module.exports = {...} }`.
- `src/app/api.js` no tiene bloque `require` — corre solo en Apps Script con scope global compartido; todas las funciones de `dominio` y `datos` están disponibles sin importar.
- Nunca ejecutar `git commit`, `git push` ni crear PR por cuenta propia — Andrés los hace él mismo.
- Baseline verificado ahora mismo: `npm test` → **167 pruebas, todas en verde**. Al terminar este plan deben ser 167 + los tests nuevos de `validarLineasFiado` (Tarea 1 agrega 6 tests → total esperado 173).

## Review Focus

- **Producto repetido en dos líneas de la misma tabla** — un comprador podría (sin querer, o a propósito) elegir el mismo producto dos veces con distinta cantidad; el sistema debe sumar esas cantidades al validar stock (no validar cada línea aislada) para no aprobar una venta que individualmente cabe pero en conjunto no. Cubierto en Tarea 2 (`registrarFiadoMultiple` prevalida sumando por `productoId`).
- **Una línea sin stock suficiente en medio del lote** — si la línea 3 de 5 no tiene stock, no deben quedar 2 transacciones ya escritas y 3 faltantes. Cubierto en Tarea 2 (prevalidación completa antes de cualquier escritura) y verificado manualmente en Tarea 5.
- **Línea con producto vacío o cantidad no entera/negativa** — la fila de la tabla nueva podría enviarse con un `<select>` sin elegir (`productoId: ''`) o una cantidad en 0/decimal si el usuario edita el input a mano. Cubierto en Tarea 1 (`validarLineasFiado` rechaza antes de que `apiRegistrarFiadoComoAdmin` intente nada).
- **Arreglo de líneas vacío** — si el usuario borra todas las filas con "quitar" y pulsa "Registrar" sin ninguna línea. Cubierto en Tarea 1 (`validarLineasFiado` exige arreglo no vacío) y en Tarea 4 (UI no debe permitir quedar en cero filas, ver Paso de UI).
- **`apiRegistrarFiado` (autoregistro del comprador en "Mi cuenta")** — no debe cambiar de comportamiento; sigue siendo un producto a la vez. Cubierto en Tarea 2 (se preserva `registrarFiado` como wrapper delgado sobre el mismo núcleo, sin tocar su firma ni sus llamadores).

---

### Task 1: Validación de líneas de fiado en el dominio

**Files:**
- Modify: `src/dominio/transacciones.js`
- Test: `test/dominio/transacciones.test.js`

**Interfaces:**
- Consumes: nada nuevo — usa `esEnteroPositivo` de `src/dominio/dinero.js`, ya importado en `transacciones.js` como `dineroModulo.esEnteroPositivo` (ver línea 3 del archivo).
- Produces: `validarLineasFiado(lineas)` — función pura, no devuelve nada si es válido, lanza `Error` con mensaje en español si no. Forma esperada de cada línea: `{ productoId: string, cantidad: number }`. La usará `apiRegistrarFiadoComoAdmin` en la Tarea 3.

Referencia de estilo a seguir (ya existe en el repo, no se toca): `validarLineasParaConfirmar` en `src/dominio/facturas.js:68-93` — mismo patrón de "arreglo no vacío, recorrer con índice, lanzar `Linea N: mensaje`".

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `test/dominio/transacciones.test.js` (después del último test existente, `crearTransaccionFiado exige el consumo de lotes`):

```javascript
const { validarLineasFiado } = require('../../src/dominio/transacciones.js');

test('validarLineasFiado rechaza un arreglo vacio', () => {
  assert.throws(() => validarLineasFiado([]), /al menos una linea/i);
});

test('validarLineasFiado rechaza si no es un arreglo', () => {
  assert.throws(() => validarLineasFiado(null), /al menos una linea/i);
});

test('validarLineasFiado exige productoId en cada linea', () => {
  assert.throws(
    () => validarLineasFiado([{ productoId: '', cantidad: 2 }]),
    /Linea 1.*producto/i
  );
});

test('validarLineasFiado exige cantidad entera positiva', () => {
  assert.throws(
    () => validarLineasFiado([{ productoId: 'p1', cantidad: 0 }]),
    /Linea 1.*cantidad/i
  );
  assert.throws(
    () => validarLineasFiado([{ productoId: 'p1', cantidad: 1.5 }]),
    /Linea 1.*cantidad/i
  );
});

test('validarLineasFiado acepta un arreglo valido con varias lineas', () => {
  assert.doesNotThrow(() => validarLineasFiado([
    { productoId: 'p1', cantidad: 2 },
    { productoId: 'p2', cantidad: 1 }
  ]));
});

test('validarLineasFiado numera el error por la linea que falla, no por el indice 0', () => {
  assert.throws(
    () => validarLineasFiado([
      { productoId: 'p1', cantidad: 2 },
      { productoId: '', cantidad: 1 }
    ]),
    /Linea 2/
  );
});
```

La línea `const { validarLineasFiado } = require(...)` que aparece en el bloque de tests de arriba es solo para mostrar qué nombre hace falta — **bórrala** del final del archivo. En su lugar, edita el `require` real que ya existe en la línea 3 del archivo:

```javascript
const { crearTransaccionFiado, anularTransaccion, esActiva } = require('../../src/dominio/transacciones.js');
```

Cámbialo a:

```javascript
const { crearTransaccionFiado, anularTransaccion, esActiva, validarLineasFiado } = require('../../src/dominio/transacciones.js');
```

- [ ] **Step 2: Correr los tests para confirmar que fallan**

Run: `npm test`
Expected: FAIL — `validarLineasFiado is not a function` (o `undefined is not a function`), porque todavía no existe en `src/dominio/transacciones.js`.

- [ ] **Step 3: Implementar `validarLineasFiado`**

En `src/dominio/transacciones.js`, agregar la función después de `crearTransaccionFiado` (antes de `esActiva`):

```javascript
function validarLineasFiado(lineas) {
  if (!Array.isArray(lineas) || lineas.length === 0) {
    throw new Error('Debe haber al menos una linea para registrar');
  }
  lineas.forEach(function (linea, indice) {
    const numero = indice + 1;
    const productoId = String((linea && linea.productoId) || '').trim();
    if (productoId === '') {
      throw new Error('Linea ' + numero + ': falta el producto');
    }
    if (!esEnteroPositivo(Number(linea.cantidad))) {
      throw new Error('Linea ' + numero + ': la cantidad debe ser un entero positivo');
    }
  });
}
```

Actualizar el `module.exports` al final del archivo (hoy dice `module.exports = { crearTransaccionFiado, anularTransaccion, esActiva };`):

```javascript
if (typeof module !== 'undefined') {
  module.exports = { crearTransaccionFiado, anularTransaccion, esActiva, validarLineasFiado };
}
```

- [ ] **Step 4: Correr los tests para confirmar que pasan**

Run: `npm test`
Expected: PASS — 167 + 6 = 173 pruebas en verde (los 6 tests nuevos del Step 1).

- [ ] **Step 5: Avisar a Andrés**

No hacer commit. Dejar los cambios listos para que Andrés revise y commitee él mismo cuando lo decida.

---

### Task 2: Núcleo sin bloqueo + registro múltiple en el backend

**Files:**
- Modify: `src/app/api.js` (función `registrarFiado`, líneas 111-147 hoy)

**Interfaces:**
- Consumes: `validarLineasFiado(lineas)` de la Tarea 1 (lanza `Error` si inválido); `hayStockSuficiente(producto, cantidad)` y `crearTransaccionFiado` (dominio, ya disponibles globalmente); `consumirDeLotes`, `descontarStock`, `leerTodo`, `agregarFila`, `actualizarPorId`, `obtenerLibro`, `nuevoId`, `ahoraIso` — todos ya usados hoy en `registrarFiado`, sin cambios de firma.
- Produces:
  - `registrarFiadoSinBloqueo(libro, usuario, productoId, cantidad, origen)` → devuelve el objeto transacción creado (mismo shape que hoy devuelve `registrarFiado`). La usará `registrarFiado` (sin cambios de firma para sus llamadores) y `registrarFiadoMultiple` en este mismo archivo.
  - `registrarFiadoMultiple(usuario, lineas, origen)` → devuelve un arreglo de transacciones creadas (una por línea, mismo orden que `lineas`). La usará `apiRegistrarFiadoComoAdmin` en la Tarea 3.

No hay test automatizado para esta tarea (`api.js` es capa `app`, fuera del alcance de `npm test` según CLAUDE.md — solo `dominio` está cubierto). La verificación es manual, en la Tarea 5.

- [ ] **Step 1: Extraer el núcleo sin bloqueo**

Localizar en `src/app/api.js` la función actual (líneas 111-147):

```javascript
function registrarFiado(usuario, productoId, cantidad, origen) {
  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(30000);
  try {
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
  } finally {
    bloqueo.releaseLock();
  }
}
```

Reemplazarla por estas dos funciones (mismo bloque de código, dividido en núcleo + wrapper con lock):

```javascript
function registrarFiadoSinBloqueo(libro, usuario, productoId, cantidad, origen) {
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
}

function registrarFiado(usuario, productoId, cantidad, origen) {
  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(30000);
  try {
    const libro = obtenerLibro();
    return registrarFiadoSinBloqueo(libro, usuario, productoId, cantidad, origen);
  } finally {
    bloqueo.releaseLock();
  }
}
```

Esto no cambia el comportamiento de `apiRegistrarFiado` (autoregistro, api.js:149-156) ni de la llamada a `registrarFiado` dentro de `apiRegistrarFiadoComoAdmin` que se reemplazará en el Step 2 — su firma sigue igual.

- [ ] **Step 2: Agregar `registrarFiadoMultiple`**

Justo después de `registrarFiado` (la función que quedó del Step 1), agregar:

```javascript
function registrarFiadoMultiple(usuario, lineas, origen) {
  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(30000);
  try {
    const libro = obtenerLibro();
    const productos = leerTodo(libro, 'Productos');
    const cantidadesPorProducto = {};
    lineas.forEach(function (linea) {
      const productoId = linea.productoId;
      cantidadesPorProducto[productoId] = (cantidadesPorProducto[productoId] || 0) + Number(linea.cantidad);
    });
    Object.keys(cantidadesPorProducto).forEach(function (productoId) {
      const producto = productos.filter(function (p) { return p.id === productoId; })[0];
      if (!producto || producto.activo !== true) {
        throw new Error('El producto no existe o esta inactivo');
      }
      if (!hayStockSuficiente(producto, cantidadesPorProducto[productoId])) {
        throw new Error('Stock insuficiente para ' + producto.nombre);
      }
    });
    return lineas.map(function (linea) {
      return registrarFiadoSinBloqueo(libro, usuario, linea.productoId, Number(linea.cantidad), origen);
    });
  } finally {
    bloqueo.releaseLock();
  }
}
```

Nota sobre el orden de validación: la prevalidación (sumar cantidades por producto, chequear existencia/activo/stock) corre **completa antes** de escribir la primera fila. Si una línea falla, la función lanza `Error` y `bloqueo.releaseLock()` corre igual por el `finally` — no queda ninguna `Transaccion` escrita a medias.

- [ ] **Step 3: Verificar que el archivo sigue siendo válido JS**

Run: `node -e "require('C:/Users/sistem04/Documents/Tienda/src/app/api.js')" 2>&1 | head -5`
Expected: Apps Script globals como `LockService` no existen bajo Node, así que fallará con algo como `LockService is not defined` **al ejecutar**, no al parsear — eso confirma que no hay error de sintaxis (si hubiera un error de sintaxis, el mensaje sería `SyntaxError` en vez de `is not defined`). Si ves `SyntaxError`, revisa las llaves del Step 1/2.

- [ ] **Step 4: Correr la suite de dominio para confirmar que nada se rompió**

Run: `npm test`
Expected: PASS — sigue en 173 (api.js no está cubierto por `npm test`, así que el conteo no cambia respecto al final de la Tarea 1).

- [ ] **Step 5: Avisar a Andrés**

No hacer commit. Dejar los cambios listos.

---

### Task 3: Nueva firma de `apiRegistrarFiadoComoAdmin`

**Files:**
- Modify: `src/app/api.js` (función `apiRegistrarFiadoComoAdmin`, líneas 314-333 hoy)

**Interfaces:**
- Consumes: `validarLineasFiado` (Tarea 1), `registrarFiadoMultiple` (Tarea 2), `exigirAdmin`, `leerTodo`, `obtenerLibro` (ya existentes, sin cambios).
- Produces: `apiRegistrarFiadoComoAdmin(token, usuarioId, lineas)` — `lineas` es ahora un arreglo `[{productoId, cantidad}, ...]` (antes era `productoId, cantidad` sueltos). Devuelve `{ ok: true, mensaje: string }` o `{ ok: false, mensaje: string }`. La usará `admin.html` en la Tarea 4.

- [ ] **Step 1: Reemplazar la función**

Localizar en `src/app/api.js` (líneas 314-333):

```javascript
function apiRegistrarFiadoComoAdmin(token, usuarioId, productoId, cantidad) {
  try {
    exigirAdmin(token);
    const usuarios = leerTodo(obtenerLibro(), 'Usuarios');
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
    const transaccion = registrarFiado(destino, productoId, Number(cantidad), 'admin');
    return { ok: true, mensaje: 'Registrado a ' + destino.nombre + ': ' + transaccion.cantidad + ' x ' + transaccion.productoNombre };
  } catch (error) {
    return { ok: false, mensaje: error.message };
  }
}
```

Reemplazarla por:

```javascript
function apiRegistrarFiadoComoAdmin(token, usuarioId, lineas) {
  try {
    exigirAdmin(token);
    validarLineasFiado(lineas);
    const usuarios = leerTodo(obtenerLibro(), 'Usuarios');
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
    const transacciones = registrarFiadoMultiple(destino, lineas, 'admin');
    const totalUnidades = transacciones.reduce(function (suma, t) { return suma + t.cantidad; }, 0);
    return {
      ok: true,
      mensaje: 'Registrado a ' + destino.nombre + ': ' + transacciones.length + ' producto(s), ' + totalUnidades + ' unidad(es)'
    };
  } catch (error) {
    return { ok: false, mensaje: error.message };
  }
}
```

- [ ] **Step 2: Verificar que no quedan otras llamadas con la firma vieja**

Run: `grep -rn "apiRegistrarFiadoComoAdmin" "C:\Users\sistem04\Documents\Tienda\src"`
Expected: dos resultados — la definición en `api.js` (recién editada) y la llamada en `admin.html` (línea ~625), que se actualizará en la Tarea 4. Ningún otro archivo de `src/` debe referenciarla.

- [ ] **Step 3: Correr la suite de dominio**

Run: `npm test`
Expected: PASS — sigue en 173 (sin cambios, `api.js` no está cubierto).

- [ ] **Step 4: Avisar a Andrés**

No hacer commit. Dejar los cambios listos.

---

### Task 4: Tabla de líneas en "Registrar fiado a nombre de alguien" (admin.html)

**Files:**
- Modify: `src/web/admin.html` (bloque HTML líneas 162-180, y bloque `<script>` cerca de líneas 401-428 y 618-631)

**Interfaces:**
- Consumes: `apiRegistrarFiadoComoAdmin(token, usuarioId, lineas)` de la Tarea 3 — `lineas` debe ser `[{productoId, cantidad}, ...]`; `llenarSelectProductos(select, productos)` ya existente (admin.html:401-410); `productosCache` (variable global ya existente, admin.html:341) y `pintarProductos(productos)` (admin.html:421-428).
- Produces: nada que otro archivo consuma — es la capa `web`, la hoja final.

- [ ] **Step 1: Reemplazar el HTML del bloque**

Localizar en `src/web/admin.html` (líneas 162-180):

```html
          <div class="bloque">
            <h3>Registrar fiado a nombre de alguien</h3>
            <div class="rejilla">
              <div class="campo">
                <label for="usuarioDestino">Comprador</label>
                <select id="usuarioDestino"></select>
              </div>
              <div class="campo">
                <label for="productoAdmin">Producto</label>
                <select id="productoAdmin"></select>
              </div>
              <div class="campo">
                <label for="cantidadAdmin">Cantidad</label>
                <input id="cantidadAdmin" type="number" min="1" step="1" value="1">
              </div>
              <button id="btnFiadoAdmin" class="campo-ancho">Registrar</button>
              <div id="avisoFiadoAdmin" class="campo-ancho"></div>
            </div>
          </div>
```

Reemplazarlo por:

```html
          <div class="bloque">
            <h3>Registrar fiado a nombre de alguien</h3>
            <div class="rejilla">
              <div class="campo">
                <label for="usuarioDestino">Comprador</label>
                <select id="usuarioDestino"></select>
              </div>
            </div>
            <table>
              <thead>
                <tr><th>Producto</th><th class="valor">Cantidad</th><th></th></tr>
              </thead>
              <tbody id="cuerpoTablaFiadoAdmin"></tbody>
            </table>
            <button id="btnAgregarLineaFiadoAdmin">Agregar linea</button>
            <div class="rejilla">
              <button id="btnFiadoAdmin" class="campo-ancho">Registrar</button>
              <div id="avisoFiadoAdmin" class="campo-ancho"></div>
            </div>
          </div>
```

- [ ] **Step 2: Agregar el estado y el pintado de la tabla**

En el bloque `<script>`, localizar `pintarProductos` (admin.html:421-428):

```javascript
      function pintarProductos(productos) {
        productosCache = productos;
        llenarSelectProductos(document.getElementById('productoAjuste'), productos);
        llenarSelectProductos(document.getElementById('productoAdmin'), productos);
        llenarSelectProductos(document.getElementById('productoPerdida'), productos);
        llenarDatalist(document.getElementById('listaNombresProducto'), productos.map(function (p) { return p.nombre; }));
        llenarDatalist(document.getElementById('listaAliasProducto'), productos.map(function (p) { return p.alias; }).filter(function (a) { return a; }));
      }
```

Reemplazarlo por (quita la línea de `productoAdmin`, que ya no existe, y agrega la llamada a la nueva función de pintado):

```javascript
      function pintarProductos(productos) {
        productosCache = productos;
        llenarSelectProductos(document.getElementById('productoAjuste'), productos);
        llenarSelectProductos(document.getElementById('productoPerdida'), productos);
        llenarDatalist(document.getElementById('listaNombresProducto'), productos.map(function (p) { return p.nombre; }));
        llenarDatalist(document.getElementById('listaAliasProducto'), productos.map(function (p) { return p.alias; }).filter(function (a) { return a; }));
        pintarTablaFiadoAdmin();
      }

      var lineasFiadoAdmin = [{ productoId: '', cantidad: 1 }];

      function pintarTablaFiadoAdmin() {
        var cuerpo = document.getElementById('cuerpoTablaFiadoAdmin');
        cuerpo.innerHTML = '';
        lineasFiadoAdmin.forEach(function (linea, indice) {
          var fila = document.createElement('tr');
          var celdaProducto = document.createElement('td');
          var select = document.createElement('select');
          llenarSelectProductos(select, productosCache);
          select.value = linea.productoId;
          select.addEventListener('change', function () {
            lineasFiadoAdmin[indice].productoId = select.value;
          });
          celdaProducto.appendChild(select);

          var celdaCantidad = document.createElement('td');
          var inputCantidad = document.createElement('input');
          inputCantidad.type = 'number';
          inputCantidad.min = '1';
          inputCantidad.step = '1';
          inputCantidad.value = linea.cantidad;
          inputCantidad.addEventListener('input', function () {
            lineasFiadoAdmin[indice].cantidad = Number(inputCantidad.value);
          });
          celdaCantidad.appendChild(inputCantidad);

          var celdaQuitar = document.createElement('td');
          var botonQuitar = document.createElement('button');
          botonQuitar.textContent = 'quitar';
          botonQuitar.addEventListener('click', function () {
            if (lineasFiadoAdmin.length > 1) {
              lineasFiadoAdmin.splice(indice, 1);
              pintarTablaFiadoAdmin();
            }
          });
          celdaQuitar.appendChild(botonQuitar);

          fila.appendChild(celdaProducto);
          fila.appendChild(celdaCantidad);
          fila.appendChild(celdaQuitar);
          cuerpo.appendChild(fila);
        });
      }
```

Notas de diseño de este paso:
- `select.value = linea.productoId` deja el select en blanco si ese producto ya no está en `productosCache` (por ejemplo, se desactivó) — eso es intencional, obliga a re-elegir.
- El botón "quitar" no borra la última línea (`if (lineasFiadoAdmin.length > 1)`), así la tabla nunca queda en cero filas — cubre el caso "arreglo vacío" del Review Focus sin depender de la validación del backend.
- `pintarTablaFiadoAdmin()` se llama desde `pintarProductos()`, que ya se invoca al cargar la página y tras cada operación exitosa — así el select de cada fila siempre refleja el stock actual.

- [ ] **Step 3: Agregar el handler de "Agregar linea"**

Justo después de la función `pintarTablaFiadoAdmin` (o en cualquier punto del `<script>` después de que ambas funciones existan), agregar:

```javascript
      document.getElementById('btnAgregarLineaFiadoAdmin').addEventListener('click', function () {
        lineasFiadoAdmin.push({ productoId: '', cantidad: 1 });
        pintarTablaFiadoAdmin();
      });
```

- [ ] **Step 4: Actualizar el handler de "Registrar"**

Localizar (admin.html:618-631):

```javascript
      document.getElementById('btnFiadoAdmin').addEventListener('click', function () {
        var boton = this;
        boton.disabled = true;
        google.script.run.withSuccessHandler(function (respuesta) {
          boton.disabled = false;
          mostrarAviso('avisoFiadoAdmin', respuesta.mensaje, !respuesta.ok);
          if (respuesta.ok) { cargarTodo(); }
        }).apiRegistrarFiadoComoAdmin(
          token,
          document.getElementById('usuarioDestino').value,
          document.getElementById('productoAdmin').value,
          Number(document.getElementById('cantidadAdmin').value)
        );
      });
```

Reemplazarlo por:

```javascript
      document.getElementById('btnFiadoAdmin').addEventListener('click', function () {
        var boton = this;
        boton.disabled = true;
        google.script.run.withSuccessHandler(function (respuesta) {
          boton.disabled = false;
          mostrarAviso('avisoFiadoAdmin', respuesta.mensaje, !respuesta.ok);
          if (respuesta.ok) {
            lineasFiadoAdmin = [{ productoId: '', cantidad: 1 }];
            pintarTablaFiadoAdmin();
            cargarTodo();
          }
        }).apiRegistrarFiadoComoAdmin(
          token,
          document.getElementById('usuarioDestino').value,
          lineasFiadoAdmin
        );
      });
```

- [ ] **Step 5: Verificar que el HTML sigue balanceado**

Run: `node -e "const fs=require('fs'); const t=fs.readFileSync('C:/Users/sistem04/Documents/Tienda/src/web/admin.html','utf8'); const open=(t.match(/<div/g)||[]).length; const close=(t.match(/<\/div>/g)||[]).length; console.log('div abre:', open, 'div cierra:', close);"`
Expected: los dos números deben ser iguales (mismo chequeo que se usó en cambios previos de este archivo, ver resumen de la conversación).

- [ ] **Step 6: Correr la suite de dominio**

Run: `npm test`
Expected: PASS — sigue en 173 (`admin.html` no está cubierto por `npm test`).

- [ ] **Step 7: Avisar a Andrés**

No hacer commit. Dejar los cambios listos.

---

### Task 5: Verificación manual end-to-end

**Files:** ninguno (solo pruebas manuales sobre la Web App desplegada).

**Interfaces:**
- Consumes: todo lo construido en las Tareas 1-4.
- Produces: confirmación de que el flujo completo funciona antes de que Andrés lo despliegue de verdad.

- [ ] **Step 1: Desplegar en el editor de Apps Script (paso manual, no automatizable)**

Avisar a Andrés que debe correr `npm run push` y luego, en el editor de Apps Script: **Implementar → Gestionar implementaciones → editar la implementación existente → Nueva versión → Implementar**. Sin este paso manual, los cambios de código no llegan a la Web App en vivo aunque `clasp push` haya subido los archivos.

- [ ] **Step 2: Probar el caso feliz — varias líneas, un comprador**

En el panel admin, abrir "Registrar fiado a nombre de alguien", elegir un comprador, dejar la línea inicial con un producto A y cantidad 2, pulsar "Agregar linea", elegir un producto B distinto con cantidad 1, pulsar "Registrar".
Expected: aviso de éxito tipo "Registrado a NOMBRE: 2 producto(s), 3 unidad(es)"; en "Ultimos movimientos" aparecen **dos filas nuevas** (una por producto), cada una anulable por separado; el stock de A bajó en 2 y el de B bajó en 1.

- [ ] **Step 3: Probar el caso "todo o nada" — stock insuficiente en una línea**

Con un producto C que tenga poco stock (por ejemplo 1 unidad), armar dos líneas: producto D (con stock de sobra) cantidad 1, y producto C cantidad 5 (más de lo que hay). Pulsar "Registrar".
Expected: aviso de error "Stock insuficiente para C"; **ninguna** transacción nueva aparece en "Ultimos movimientos" (ni siquiera la de D); el stock de D no cambió.

- [ ] **Step 4: Probar el mismo producto repetido en dos líneas**

Con un producto E que tenga stock de 3, armar dos líneas ambas con producto E: una con cantidad 2 y otra con cantidad 2 (total 4, más de lo que hay). Pulsar "Registrar".
Expected: aviso de error "Stock insuficiente para E" (la suma 4 > 3 se detecta), sin ninguna transacción escrita.

- [ ] **Step 5: Confirmar que "Mi cuenta" (autoregistro) no cambió**

Entrar como comprador a la vista de autoregistro, registrar un fiado de un solo producto como siempre.
Expected: funciona exactamente igual que antes de este cambio (un producto, una cantidad, sin tabla de líneas — esa pantalla no se tocó).

- [ ] **Step 6: Avisar a Andrés que el flujo quedó verificado**

Resumen de lo probado y cualquier hallazgo, para que decida cuándo commitear.

---

## Despliegue

Después de la Tarea 5: `npm run push`, luego en el editor de Apps Script **Implementar → Gestionar implementaciones → editar la implementación existente → Nueva versión → Implementar**. No hace falta re-ejecutar `configurarInicial()` — este plan no toca `ESQUEMA`.
