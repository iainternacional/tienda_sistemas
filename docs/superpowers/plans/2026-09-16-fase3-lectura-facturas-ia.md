# Fase 3 — Lectura de facturas con IA

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completar la seccion 4.2 del spec original: el admin sube o toma una foto
de la factura del proveedor, Gemini API extrae las lineas (producto, cantidad,
costo unitario), el panel las muestra en un resumen editable, y solo al
confirmar se actualiza el inventario (stock y costo). Es la ultima pieza del
spec original — Fase 1 (inventario + fiado) y Fase 2 (prestamos, pagos,
perdidas, gastos compartidos, reportes, login corporativo) ya estan en
produccion.

**Architecture:** Misma arquitectura de Fase 1/2 — logica pura y testeable en
`src/dominio/` (sin dependencias de Apps Script, probada con `node --test`),
I/O de Sheets aislado en `src/datos/`, y `src/app/api.js` como unica capa que
toca ambos mundos. Una hoja nueva (`IngresosInventario`) con el mismo patron
de anulacion que las entidades de Fase 2. La llamada a Gemini (`UrlFetchApp`)
y el I/O de Sheets no se prueban localmente — la verificacion de esa parte es
manual en produccion, igual que en Fase 2.

**Tech Stack:** Google Apps Script, Google Sheets, HTML Service, Gemini API
(`gemini-2.0-flash`), `node --test` para las pruebas locales, `clasp` para el
despliegue.

**Spec:** `docs/superpowers/specs/2026-09-15-fase3-lectura-facturas-ia-design.md`

## Global Constraints

- **Idioma:** identificadores, mensajes de usuario, comentarios y mensajes de commit en espanol, sin tildes en los identificadores.
- **Modulos compatibles con Apps Script:** `src/dominio/facturas.js` abre con el bloque `if (typeof require !== 'undefined') { var ... = require(...); }` y cierra con `if (typeof module !== 'undefined') { module.exports = { ... }; }`. Usar `var` (no `const`) en esos requires.
- **Dinero en enteros:** `cantidad` y `costoUnitario` son siempre enteros positivos. Ninguna linea con decimales o negativos pasa el saneo.
- **Columnas nuevas van al final** de su arreglo en `ESQUEMA`, nunca en medio.
- **Nada se borra:** el ingreso se anula marcando `estado = 'anulado'` via `anularRegistro()`, igual que las entidades de Fase 2. El registro original se conserva.
- **Tras cambiar `ESQUEMA`:** hay que correr `npm run push` y volver a ejecutar `configurarInicial()` en el editor de Apps Script para que la hoja `IngresosInventario` aparezca con sus encabezados.
- **Nueva Script Property:** `GEMINI_API_KEY`, mismo patron que `ID_LIBRO`. Sin ella, `apiLeerFactura` falla con un mensaje claro en vez de lanzar una excepcion cruda.
- **Toda tarea de dominio termina con `npm test` en verde.** Fase 1 y 2 aportan 122 pruebas que no pueden romperse.

---

## Decisiones de diseño que fija este plan

**1. El `productoId` final se fija antes de guardar el ingreso, incluso para lineas nuevas.**
Cuando `apiConfirmarIngresoInventario` crea un producto nuevo (`esNuevo: true`),
genera su `id` con `nuevoId()` **antes** de armar la fila de `IngresosInventario`
y lo escribe en `linea.productoId`. Asi, `IngresosInventario.lineas` siempre
guarda un `productoId` valido para las dos clases de linea, y anular el
ingreso (`apiAnularIngresoInventario`) puede revertir el stock de todas las
lineas de la misma forma, sin distinguir si el producto ya existia.

**2. La validacion de forma (`validarLineasParaConfirmar`) es pura; la validacion contra Sheets vive en `api.js`.**
`src/dominio/facturas.js` no toca Apps Script, asi que solo puede validar la
forma de cada linea (nombre no vacio, enteros positivos, campos de producto
nuevo). Verificar que un `productoId` siga existiendo y activo, o que el
nombre de una linea nueva no choque con un producto ya creado, exige leer
`Productos` de la hoja real — eso lo hace `apiConfirmarIngresoInventario`
antes de escribir nada, para mantener el principio todo-o-nada.

**3. Un fallo de Gemini nunca lanza hacia el admin: `apiLeerFactura` siempre devuelve `{ ok, mensaje, lineas }`.**
HTTP fallido, JSON invalido, o `lineas` vacio tras el saneo son el mismo caso:
el resumen editable arranca vacio y el admin carga la factura a mano con
"+ agregar linea" — el mismo formulario sirve de respaldo manual.

**4. El emparejamiento solo mira productos activos**, igual criterio que el resto del sistema (`productosVisibles`, `registrarFiado`). Un producto desactivado se trata como inexistente y la linea sale `esNuevo: true`.

---

### Task 1: Esquema de `IngresosInventario` y saneo/emparejamiento de lineas

Sienta la base pura: la hoja nueva y las dos funciones que limpian y
emparejan lo que Gemini devuelve, antes de que exista ninguna llamada real a
Gemini.

**Files:**
- Create: `src/dominio/facturas.js`
- Create: `test/dominio/facturas.test.js`
- Modify: `src/datos/esquema.js`

**Interfaces:**
- Consumes: `normalizarNombre` de `src/dominio/productos.js`, `esEnteroPositivo` de `src/dominio/dinero.js`.
- Produces:
  - `ESQUEMA.IngresosInventario = ['id', 'fecha', 'admin', 'lineas', 'estado', 'anuladoPor', 'anuladoFecha', 'anuladoMotivo']`.
  - `sanearLineas(lineasCrudas) -> lineas` — descarta en silencio cualquier linea sin nombre o con `cantidad`/`costoUnitario` no enteros positivos.
  - `emparejarLineas(lineasSaneadas, productosActivos) -> lineas` — agrega `productoId` (o `''`) y `esNuevo` a cada linea, comparando `nombre` normalizado contra `nombre` y `alias` normalizados de cada producto.

- [ ] **Step 1: Escribir la prueba que falla**

Crear `test/dominio/facturas.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert');
const { sanearLineas, emparejarLineas } = require('../../src/dominio/facturas.js');

test('sanearLineas descarta lineas sin nombre, con cantidad o costo invalidos', () => {
  const crudas = [
    { nombre: 'Cafe', cantidad: 20, costoUnitario: 800 },
    { nombre: '  ', cantidad: 5, costoUnitario: 100 },
    { nombre: 'Te', cantidad: -1, costoUnitario: 100 },
    { nombre: 'Azucar', cantidad: 5, costoUnitario: 0 },
    { nombre: 'Sal', cantidad: 2.5, costoUnitario: 100 }
  ];
  const saneadas = sanearLineas(crudas);
  assert.strictEqual(saneadas.length, 1);
  assert.strictEqual(saneadas[0].nombre, 'Cafe');
  assert.strictEqual(saneadas[0].cantidad, 20);
  assert.strictEqual(saneadas[0].costoUnitario, 800);
});

test('sanearLineas recorta el nombre y devuelve arreglo vacio si no es arreglo', () => {
  assert.deepStrictEqual(sanearLineas('no es arreglo'), []);
  const saneadas = sanearLineas([{ nombre: '  Cafe  ', cantidad: 1, costoUnitario: 100 }]);
  assert.strictEqual(saneadas[0].nombre, 'Cafe');
});

const PRODUCTOS = [
  { id: 'p1', nombre: 'Cafe', alias: '', activo: true },
  { id: 'p2', nombre: 'Refresco', alias: 'gaseosa', activo: true }
];

test('emparejarLineas encuentra por nombre normalizado', () => {
  const [linea] = emparejarLineas([{ nombre: 'cafe', cantidad: 1, costoUnitario: 100 }], PRODUCTOS);
  assert.strictEqual(linea.productoId, 'p1');
  assert.strictEqual(linea.esNuevo, false);
});

test('emparejarLineas encuentra por alias normalizado', () => {
  const [linea] = emparejarLineas([{ nombre: 'Gaseosa', cantidad: 1, costoUnitario: 100 }], PRODUCTOS);
  assert.strictEqual(linea.productoId, 'p2');
  assert.strictEqual(linea.esNuevo, false);
});

test('emparejarLineas marca esNuevo cuando no hay coincidencia', () => {
  const [linea] = emparejarLineas([{ nombre: 'Chocolatina', cantidad: 1, costoUnitario: 100 }], PRODUCTOS);
  assert.strictEqual(linea.productoId, '');
  assert.strictEqual(linea.esNuevo, true);
});
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

Run: `npm test`
Expected: FAIL con `Cannot find module '../../src/dominio/facturas.js'`

- [ ] **Step 3: Agregar `IngresosInventario` a `ESQUEMA`**

En `src/datos/esquema.js`, agregar al final del objeto `ESQUEMA` (despues de `GastosCompartidos`):

```javascript
  IngresosInventario: [
    'id', 'fecha', 'admin', 'lineas', 'estado',
    'anuladoPor', 'anuladoFecha', 'anuladoMotivo'
  ]
```

- [ ] **Step 4: Implementar `src/dominio/facturas.js`**

```javascript
if (typeof require !== 'undefined') {
  var dineroModulo = require('./dinero.js');
  var esEnteroPositivo = dineroModulo.esEnteroPositivo;
  var productosModulo = require('./productos.js');
  var normalizarNombre = productosModulo.normalizarNombre;
}

function sanearLineas(lineasCrudas) {
  if (!Array.isArray(lineasCrudas)) {
    return [];
  }
  const saneadas = [];
  lineasCrudas.forEach(function (linea) {
    if (!linea || typeof linea !== 'object') {
      return;
    }
    const nombre = String(linea.nombre || '').trim();
    const cantidad = Number(linea.cantidad);
    const costoUnitario = Number(linea.costoUnitario);
    if (nombre === '' || !esEnteroPositivo(cantidad) || !esEnteroPositivo(costoUnitario)) {
      return;
    }
    saneadas.push({ nombre: nombre, cantidad: cantidad, costoUnitario: costoUnitario });
  });
  return saneadas;
}

function buscarPorNombreOAlias(productos, nombre) {
  const buscado = normalizarNombre(nombre);
  if (buscado === '') {
    return null;
  }
  for (let i = 0; i < productos.length; i++) {
    if (normalizarNombre(productos[i].nombre) === buscado || normalizarNombre(productos[i].alias) === buscado) {
      return productos[i];
    }
  }
  return null;
}

function emparejarLineas(lineasSaneadas, productosActivos) {
  return lineasSaneadas.map(function (linea) {
    const encontrado = buscarPorNombreOAlias(productosActivos, linea.nombre);
    return Object.assign({}, linea, {
      productoId: encontrado ? encontrado.id : '',
      esNuevo: !encontrado
    });
  });
}

if (typeof module !== 'undefined') {
  module.exports = { sanearLineas, emparejarLineas };
}
```

- [ ] **Step 5: Correr las pruebas**

Run: `npm test`
Expected: PASS — 127 pruebas.

- [ ] **Step 6: Commit**

```bash
git add src/dominio/facturas.js test/dominio/facturas.test.js src/datos/esquema.js
git commit -m "feat: esquema de ingresos de inventario y saneo/emparejamiento de facturas"
```

---

### Task 2: Parseo defensivo de Gemini, validacion todo-o-nada y armado del ingreso

Completa el modulo de dominio con lo que falta antes de tocar Apps Script:
interpretar la respuesta cruda de Gemini, validar una lista de lineas ya
editadas por el admin, y construir la fila que se va a guardar.

**Files:**
- Modify: `src/dominio/facturas.js`
- Modify: `test/dominio/facturas.test.js`

**Interfaces:**
- Consumes: `sanearLineas`, `emparejarLineas` (Task 1).
- Produces:
  - `parsearRespuestaGemini(texto) -> lineas crudas` — quita el envoltorio ` ```json ... ``` ` si aparece y hace `JSON.parse`; lanza si el texto no es JSON valido o si no trae un campo `lineas` que sea arreglo.
  - `validarLineasParaConfirmar(lineas)` — lanza en la primera linea invalida, senalando cual (todo-o-nada, mismo principio que `crearGastoCompartido`): nombre no vacio, `cantidad`/`costoUnitario` enteros positivos, y si `esNuevo` ademas `categoria` no vacia y `precioVenta` entero positivo.
  - `crearIngresoInventario(datos) -> registro` donde `datos = { id, admin, lineas, fecha }`. Llama a `validarLineasParaConfirmar` y exige al menos una linea; serializa `lineas` con `JSON.stringify` en el campo `lineas` del registro.

- [ ] **Step 1: Escribir la prueba que falla**

Agregar a `test/dominio/facturas.test.js`:

```javascript
const { parsearRespuestaGemini, validarLineasParaConfirmar, crearIngresoInventario } = require('../../src/dominio/facturas.js');

test('parsearRespuestaGemini interpreta JSON limpio', () => {
  const lineas = parsearRespuestaGemini('{"lineas": [{"nombre": "Cafe", "cantidad": 20, "costoUnitario": 800}]}');
  assert.strictEqual(lineas.length, 1);
  assert.strictEqual(lineas[0].nombre, 'Cafe');
});

test('parsearRespuestaGemini quita el envoltorio de bloque de codigo', () => {
  const lineas = parsearRespuestaGemini('```json\n{"lineas": []}\n```');
  assert.deepStrictEqual(lineas, []);
});

test('parsearRespuestaGemini lanza si el JSON es invalido', () => {
  assert.throws(() => parsearRespuestaGemini('esto no es json'), /interpretar/i);
});

test('parsearRespuestaGemini lanza si falta el campo lineas', () => {
  assert.throws(() => parsearRespuestaGemini('{"otraCosa": []}'), /lineas/i);
});

const LINEA_EXISTENTE = { nombre: 'Cafe', cantidad: 10, costoUnitario: 800, productoId: 'p1', esNuevo: false };
const LINEA_NUEVA_OK = { nombre: 'Chocolatina', cantidad: 5, costoUnitario: 500, productoId: '', esNuevo: true, categoria: 'Snacks', precioVenta: 900 };

test('validarLineasParaConfirmar acepta lineas existentes y nuevas completas', () => {
  assert.doesNotThrow(() => validarLineasParaConfirmar([LINEA_EXISTENTE, LINEA_NUEVA_OK]));
});

test('validarLineasParaConfirmar exige categoria y precio de venta en linea nueva', () => {
  const incompleta = Object.assign({}, LINEA_NUEVA_OK, { categoria: '' });
  assert.throws(() => validarLineasParaConfirmar([incompleta]), /categoria/i);
});

test('validarLineasParaConfirmar rechaza cantidad invalida senalando la linea', () => {
  const invalida = Object.assign({}, LINEA_EXISTENTE, { cantidad: 0 });
  assert.throws(() => validarLineasParaConfirmar([invalida]), /cantidad/i);
});

test('validarLineasParaConfirmar exige al menos una linea', () => {
  assert.throws(() => validarLineasParaConfirmar([]), /al menos una linea/i);
});

test('crearIngresoInventario arma el registro con las lineas serializadas', () => {
  const ingreso = crearIngresoInventario({ id: 'i1', admin: 'Andres', lineas: [LINEA_EXISTENTE], fecha: '2026-09-16T10:00:00.000Z' });
  assert.strictEqual(ingreso.id, 'i1');
  assert.strictEqual(ingreso.admin, 'Andres');
  assert.strictEqual(ingreso.estado, 'pendiente');
  assert.deepStrictEqual(JSON.parse(ingreso.lineas), [LINEA_EXISTENTE]);
});

test('crearIngresoInventario exige id', () => {
  assert.throws(() => crearIngresoInventario({ admin: 'Andres', lineas: [LINEA_EXISTENTE], fecha: '2026-09-16T10:00:00.000Z' }), /id/i);
});
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

Run: `npm test`
Expected: FAIL — `parsearRespuestaGemini is not a function`.

- [ ] **Step 3: Implementar las tres funciones en `src/dominio/facturas.js`**

Agregar antes del `module.exports`:

```javascript
function parsearRespuestaGemini(texto) {
  if (!texto || typeof texto !== 'string') {
    throw new Error('No se pudo interpretar la respuesta de Gemini: vacia');
  }
  const limpio = texto.trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
  let json;
  try {
    json = JSON.parse(limpio);
  } catch (error) {
    throw new Error('No se pudo interpretar la respuesta de Gemini');
  }
  if (!json || !Array.isArray(json.lineas)) {
    throw new Error('La respuesta de Gemini no trae lineas');
  }
  return json.lineas;
}

function validarLineasParaConfirmar(lineas) {
  if (!Array.isArray(lineas) || lineas.length === 0) {
    throw new Error('Debe haber al menos una linea para confirmar');
  }
  lineas.forEach(function (linea, indice) {
    const numero = indice + 1;
    const nombre = String((linea && linea.nombre) || '').trim();
    if (nombre === '') {
      throw new Error('Linea ' + numero + ': falta el nombre');
    }
    if (!esEnteroPositivo(Number(linea.cantidad))) {
      throw new Error('Linea ' + numero + ' (' + nombre + '): la cantidad debe ser un entero positivo');
    }
    if (!esEnteroPositivo(Number(linea.costoUnitario))) {
      throw new Error('Linea ' + numero + ' (' + nombre + '): el costo debe ser un entero positivo');
    }
    if (linea.esNuevo) {
      if (String(linea.categoria || '').trim() === '') {
        throw new Error('Linea ' + numero + ' (' + nombre + '): falta la categoria del producto nuevo');
      }
      if (!esEnteroPositivo(Number(linea.precioVenta))) {
        throw new Error('Linea ' + numero + ' (' + nombre + '): el precio de venta debe ser un entero positivo');
      }
    }
  });
}

function crearIngresoInventario(datos) {
  if (!datos.id) {
    throw new Error('Falta el id del ingreso');
  }
  validarLineasParaConfirmar(datos.lineas);
  return {
    id: datos.id,
    fecha: datos.fecha,
    admin: datos.admin,
    lineas: JSON.stringify(datos.lineas),
    estado: 'pendiente',
    anuladoPor: '',
    anuladoFecha: '',
    anuladoMotivo: ''
  };
}
```

Y actualizar el `module.exports` del final del archivo:

```javascript
if (typeof module !== 'undefined') {
  module.exports = {
    sanearLineas,
    emparejarLineas,
    parsearRespuestaGemini,
    validarLineasParaConfirmar,
    crearIngresoInventario
  };
}
```

- [ ] **Step 4: Correr las pruebas**

Run: `npm test`
Expected: PASS — 137 pruebas.

- [ ] **Step 5: Commit**

```bash
git add src/dominio/facturas.js test/dominio/facturas.test.js
git commit -m "feat: parseo de gemini, validacion todo-o-nada y armado del ingreso de factura"
```

---

### Task 3: Endpoint `apiLeerFactura` — integracion con Gemini API

Primera pieza que toca Apps Script: llama a Gemini con la imagen en base64 y
devuelve las lineas ya saneadas y emparejadas contra el inventario actual.
No tiene prueba automatizada (depende de `UrlFetchApp` y `PropertiesService`);
se verifica manualmente en la Task 6.

**Files:**
- Modify: `src/app/api.js`
- Modify: `src/appsscript.json`

**Interfaces:**
- Consumes: `parsearRespuestaGemini`, `sanearLineas`, `emparejarLineas` (Tasks 1-2); Script Property `GEMINI_API_KEY`.
- Produces: `apiLeerFactura(token, imagenBase64) -> { ok, mensaje, lineas }`.

- [ ] **Step 0: Agregar el permiso de llamadas HTTP externas al manifiesto**

`src/appsscript.json` declara `oauthScopes` explicitamente, asi que Apps Script
**no** agrega el permiso nuevo solo: sin este paso, `UrlFetchApp.fetch` falla en
produccion con "Los permisos especificados no son suficientes para llamar a
UrlFetchApp.fetch". Agregar al arreglo `oauthScopes`:

```json
    "https://www.googleapis.com/auth/script.external_request"
```

Cambiar los scopes obliga a **reautorizar** la app despues de publicar la
version nueva (ver Task 7, Step 5b).

- [ ] **Step 1: Agregar `apiLeerFactura` en `src/app/api.js`**

Agregar cerca de las demas funciones `apiRegistrar*`:

```javascript
function apiLeerFactura(token, imagenBase64) {
  try {
    exigirAdmin(token);
    if (!imagenBase64) {
      return { ok: false, mensaje: 'Falta la imagen de la factura', lineas: [] };
    }
    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) {
      return { ok: false, mensaje: 'Falta configurar GEMINI_API_KEY en el proyecto', lineas: [] };
    }
    const prompt = 'Lee esta factura de proveedor y devuelve SOLO un JSON, sin texto ' +
      'alrededor, con esta forma exacta: {"lineas": [{"nombre": "...", "cantidad": 0, ' +
      '"costoUnitario": 0}]}. cantidad y costoUnitario son numeros enteros. Si un dato ' +
      'no es legible, omite esa linea por completo.';
    const respuesta = UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey,
      {
        method: 'post',
        contentType: 'application/json',
        muteHttpExceptions: true,
        payload: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: 'image/jpeg', data: imagenBase64 } }
            ]
          }]
        })
      }
    );
    if (respuesta.getResponseCode() !== 200) {
      return { ok: false, mensaje: 'Gemini no pudo procesar la factura (HTTP ' + respuesta.getResponseCode() + ')', lineas: [] };
    }
    const texto = JSON.parse(respuesta.getContentText()).candidates[0].content.parts[0].text;
    const saneadas = sanearLineas(parsearRespuestaGemini(texto));
    if (saneadas.length === 0) {
      return { ok: false, mensaje: 'No se pudo leer ninguna linea de la factura', lineas: [] };
    }
    const productosActivos = leerTodo(obtenerLibro(), 'Productos').filter(function (p) { return p.activo === true; });
    return { ok: true, mensaje: '', lineas: emparejarLineas(saneadas, productosActivos) };
  } catch (error) {
    return { ok: false, mensaje: 'No se pudo leer la factura: ' + error.message, lineas: [] };
  }
}
```

- [ ] **Step 2: Verificar sintaxis**

Run: `node --check src/app/api.js`
Expected: sin salida (sintaxis OK).

- [ ] **Step 3: Commit**

```bash
git add src/app/api.js
git commit -m "feat: endpoint apiLeerFactura con integracion a Gemini API"
```

---

### Task 4: Confirmar y anular el ingreso de inventario

El paso que si mueve stock: crea productos nuevos, suma cantidad y reemplaza
costo en los existentes, y guarda la factura confirmada. Reusa el patron de
`LockService` de `apiRegistrarPerdida` porque toca stock.

**Files:**
- Modify: `src/app/api.js`

**Interfaces:**
- Consumes: `validarLineasParaConfirmar`, `crearIngresoInventario` (Task 2); `buscarProductoPorNombre` (ya existe en `productos.js`); `anularRegistro` (Fase 2).
- Produces:
  - `apiConfirmarIngresoInventario(token, lineas) -> { ok, mensaje, productos }`.
  - `apiAnularIngresoInventario(token, ingresoId, motivo) -> { ok, mensaje, productos }`.

- [ ] **Step 1: Agregar `apiConfirmarIngresoInventario`**

```javascript
function apiConfirmarIngresoInventario(token, lineas) {
  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(30000);
  try {
    const admin = exigirAdmin(token);
    validarLineasParaConfirmar(lineas);
    const libro = obtenerLibro();
    const productos = leerTodo(libro, 'Productos');
    lineas.forEach(function (linea) {
      if (linea.esNuevo && buscarProductoPorNombre(productos, linea.nombre)) {
        throw new Error('Ya existe un producto llamado "' + linea.nombre + '"');
      }
      if (!linea.esNuevo && !productos.some(function (p) { return p.id === linea.productoId && p.activo === true; })) {
        throw new Error('El producto de la linea "' + linea.nombre + '" ya no existe o esta inactivo');
      }
    });
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
    });
    const ingreso = crearIngresoInventario({ id: nuevoId(), admin: admin.nombre, lineas: lineas, fecha: ahoraIso() });
    agregarFila(libro, 'IngresosInventario', ingreso);
    return { ok: true, mensaje: 'Factura ingresada al inventario', productos: productosVisibles() };
  } catch (error) {
    return { ok: false, mensaje: error.message, productos: [] };
  } finally {
    bloqueo.releaseLock();
  }
}
```

Nota: `validarLineasParaConfirmar(lineas)` se llama primero y lanza antes de
leer o escribir nada en Sheets; el bucle de choques de nombre/existencia
tambien lanza antes de la primera escritura — todo-o-nada.

- [ ] **Step 2: Agregar `apiAnularIngresoInventario`**

```javascript
function apiAnularIngresoInventario(token, ingresoId, motivo) {
  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(30000);
  try {
    const admin = exigirAdmin(token);
    const libro = obtenerLibro();
    const ingresos = leerTodo(libro, 'IngresosInventario');
    let original = null;
    for (let i = 0; i < ingresos.length; i++) {
      if (ingresos[i].id === ingresoId) { original = ingresos[i]; break; }
    }
    if (!original) {
      return { ok: false, mensaje: 'No se encontro el ingreso', productos: [] };
    }
    const anulado = anularRegistro(original, {
      anuladoPor: admin.nombre, anuladoFecha: ahoraIso(), anuladoMotivo: motivo
    });
    actualizarPorId(libro, 'IngresosInventario', ingresoId, {
      estado: anulado.estado, anuladoPor: anulado.anuladoPor,
      anuladoFecha: anulado.anuladoFecha, anuladoMotivo: anulado.anuladoMotivo
    });
    const lineas = JSON.parse(original.lineas);
    const productos = leerTodo(libro, 'Productos');
    lineas.forEach(function (linea) {
      const producto = productos.filter(function (p) { return p.id === linea.productoId; })[0];
      if (producto) {
        actualizarPorId(libro, 'Productos', producto.id, { stockActual: producto.stockActual - Number(linea.cantidad) });
      }
    });
    return { ok: true, mensaje: 'Ingreso anulado', productos: productosVisibles() };
  } catch (error) {
    return { ok: false, mensaje: error.message, productos: [] };
  } finally {
    bloqueo.releaseLock();
  }
}
```

Como fija la Decision de diseno 2, no se revierte `costo` — solo `stockActual`.

- [ ] **Step 3: Verificar sintaxis**

Run: `node --check src/app/api.js`
Expected: sin salida.

- [ ] **Step 4: Commit**

```bash
git add src/app/api.js
git commit -m "feat: confirmar y anular ingresos de inventario por factura"
```

---

### Task 5: Integrar el ingreso de inventario en "Ultimos movimientos"

Igual hueco que detecto la Task 9 de Fase 2: si no se conecta aqui, el admin
no tiene forma de anular un ingreso desde el panel.

**Files:**
- Modify: `src/app/api.js`

**Interfaces:**
- Consumes: `apiAnularIngresoInventario` (Task 4).
- Produces: `apiListarMovimientosRecientes` y `apiAnularMovimiento` ahora incluyen el tipo `'ingreso'`.

- [ ] **Step 1: Agregar la rama de `IngresosInventario` en `apiListarMovimientosRecientes`**

Dentro de la funcion, junto a los demas `leerTodo(libro, ...).forEach(...)`:

```javascript
    leerTodo(libro, 'IngresosInventario').forEach(function (registro) {
      const lineas = JSON.parse(registro.lineas || '[]');
      movimientos.push({
        id: registro.id, tipo: 'ingreso', fecha: registro.fecha,
        quien: registro.admin || '-',
        concepto: 'Ingreso de factura: ' + lineas.length + ' producto(s)',
        valor: lineas.reduce(function (suma, l) { return suma + l.cantidad * l.costoUnitario; }, 0),
        estado: registro.estado
      });
    });
```

- [ ] **Step 2: Agregar la rama en `apiAnularMovimiento`**

```javascript
  if (tipo === 'ingreso') { return apiAnularIngresoInventario(token, movimientoId, motivo); }
```

- [ ] **Step 3: Verificar**

```bash
node --check src/app/api.js
npm test
```
Expected: sintaxis OK y 137 pruebas en verde.

- [ ] **Step 4: Commit**

```bash
git add src/app/api.js
git commit -m "feat: incluir ingresos de inventario en ultimos movimientos"
```

---

### Task 6: Panel de administrador — tarjeta "Ingresar factura"

La parte visible: subir/tomar foto, leer con Gemini, tabla editable, y
confirmar. Reusa el ayudante de porcentaje de aumento que ya existe en
"Nuevo producto".

**Files:**
- Modify: `src/web/admin.html`

**Interfaces:**
- Consumes: `apiLeerFactura`, `apiConfirmarIngresoInventario` (Tasks 3-4).

- [ ] **Step 1: Agregar la tarjeta HTML**

Despues de la tarjeta "Registrar perdida" (o donde tenga sentido en el flujo
de inventario), agregar:

```html
<div class="tarjeta">
  <h2>Ingresar factura</h2>
  <p class="sub">Sube o toma una foto de la factura del proveedor. Maximo 4MB.</p>
  <input id="fotoFactura" type="file" accept="image/*" capture="environment">
  <button id="btnLeerFactura">Leer factura</button>
  <div id="avisoFactura"></div>
  <table id="tablaFactura" hidden>
    <thead>
      <tr><th>Nombre</th><th>Cantidad</th><th>Costo</th><th>Categoria</th><th>Precio venta</th><th></th></tr>
    </thead>
    <tbody id="cuerpoTablaFactura"></tbody>
  </table>
  <button id="btnAgregarLineaFactura" hidden>+ agregar linea</button>
  <button id="btnConfirmarFactura" hidden>Confirmar ingreso</button>
</div>
```

- [ ] **Step 2: Agregar el JavaScript de la tarjeta**

En el bloque `<script>`, junto a las demas funciones del panel:

```javascript
let lineasFactura = [];

function pintarTablaFactura() {
  const cuerpo = document.getElementById('cuerpoTablaFactura');
  cuerpo.innerHTML = '';
  lineasFactura.forEach(function (linea, indice) {
    const fila = document.createElement('tr');
    fila.innerHTML =
      '<td><input type="text" data-campo="nombre" value="' + (linea.nombre || '') + '"></td>' +
      '<td><input type="number" min="1" step="1" data-campo="cantidad" value="' + (linea.cantidad || '') + '"></td>' +
      '<td><input type="number" min="1" step="1" data-campo="costoUnitario" value="' + (linea.costoUnitario || '') + '"></td>' +
      '<td><input type="text" data-campo="categoria" value="' + (linea.categoria || '') + '" ' + (linea.esNuevo ? '' : 'hidden') + '></td>' +
      '<td><input type="number" min="1" step="1" data-campo="precioVenta" value="' + (linea.precioVenta || '') + '" ' + (linea.esNuevo ? '' : 'hidden') + '></td>' +
      '<td><button data-quitar="' + indice + '">quitar</button></td>';
    fila.querySelectorAll('input').forEach(function (input) {
      input.addEventListener('input', function () {
        lineasFactura[indice][input.dataset.campo] = input.type === 'number' ? Number(input.value) : input.value;
      });
    });
    fila.querySelector('[data-quitar]').addEventListener('click', function () {
      lineasFactura.splice(indice, 1);
      pintarTablaFactura();
    });
    cuerpo.appendChild(fila);
  });
  document.getElementById('tablaFactura').hidden = false;
  document.getElementById('btnAgregarLineaFactura').hidden = false;
  document.getElementById('btnConfirmarFactura').hidden = false;
}

document.getElementById('btnAgregarLineaFactura').addEventListener('click', function () {
  lineasFactura.push({ nombre: '', cantidad: 1, costoUnitario: 0, productoId: '', esNuevo: true, categoria: '', precioVenta: 0 });
  pintarTablaFactura();
});

document.getElementById('btnLeerFactura').addEventListener('click', function () {
  const archivo = document.getElementById('fotoFactura').files[0];
  if (!archivo) { mostrarAviso('avisoFactura', 'Elija o tome una foto primero', true); return; }
  if (archivo.size > 4 * 1024 * 1024) { mostrarAviso('avisoFactura', 'La foto pesa mas de 4MB', true); return; }
  const lector = new FileReader();
  lector.onload = function () {
    const base64 = lector.result.split(',')[1];
    mostrarAviso('avisoFactura', 'Leyendo factura...', false);
    google.script.run
      .withSuccessHandler(function (respuesta) {
        mostrarAviso('avisoFactura', respuesta.mensaje || (respuesta.ok ? 'Factura leida' : ''), !respuesta.ok);
        lineasFactura = respuesta.lineas || [];
        pintarTablaFactura();
      })
      .withFailureHandler(function (error) { mostrarAviso('avisoFactura', error.message, true); })
      .apiLeerFactura(token, base64);
  };
  lector.readAsDataURL(archivo);
});

document.getElementById('btnConfirmarFactura').addEventListener('click', function () {
  google.script.run
    .withSuccessHandler(function (respuesta) {
      mostrarAviso('avisoFactura', respuesta.mensaje, !respuesta.ok);
      if (respuesta.ok) {
        lineasFactura = [];
        document.getElementById('tablaFactura').hidden = true;
        document.getElementById('btnAgregarLineaFactura').hidden = true;
        document.getElementById('btnConfirmarFactura').hidden = true;
        document.getElementById('fotoFactura').value = '';
      }
    })
    .withFailureHandler(function (error) { mostrarAviso('avisoFactura', error.message, true); })
    .apiConfirmarIngresoInventario(token, lineasFactura);
});
```

- [ ] **Step 3: Verificar que todos los endpoints llamados existen**

```bash
grep -oh "\.api[A-Za-z]*(" src/web/*.html | sed 's/^\.//; s/(//' | sort -u > /tmp/ll.txt
grep -oh "^function \(api[A-Za-z]*\)" src/app/api.js | sed 's/function //' | sort -u > /tmp/df.txt
comm -23 /tmp/ll.txt /tmp/df.txt
```
Expected: salida vacia.

- [ ] **Step 4: Commit**

```bash
git add src/web/admin.html
git commit -m "feat: panel para ingresar factura con lectura por IA"
```

---

### Task 7: Configuracion, despliegue y verificacion en produccion

Las pruebas cubren el saneo, el emparejamiento, el parseo de Gemini y la
validacion todo-o-nada, pero nada de lo que corre dentro de Apps Script
(Gemini API real, I/O contra Sheets, la interfaz) se prueba localmente. Esta
tarea la ejecuta Andres.

**Files:** ninguno — es configuracion, despliegue y verificacion manual.

- [ ] **Step 1: Conseguir la API key de Gemini**

Ir a Google AI Studio (con la cuenta corporativa), generar una API key de
nivel gratuito.

- [ ] **Step 2: Configurar la Script Property**

En el editor de Apps Script: Configuracion del proyecto → Propiedades del
script → Agregar propiedad: `GEMINI_API_KEY` = la key generada.

- [ ] **Step 3: Subir el codigo**

Run: `npm run push`

- [ ] **Step 4: Crear la hoja nueva**

En el editor de Apps Script, elegir `configurarInicial` en el desplegable de
funciones y darle Ejecutar. Esto crea la hoja `IngresosInventario` con sus
encabezados. Verificar en la hoja de calculo que aparezca la pestana nueva.

- [ ] **Step 5: Publicar la version nueva**

Implementar → Gestionar implementaciones → editar la implementacion
existente → Version: Nueva version → Implementar.

- [ ] **Step 5b: Reautorizar la app por el scope nuevo**

La Task 3 agrego `script.external_request` a `oauthScopes`. Un scope nuevo no
se concede solo: hay que volver a autorizar con la cuenta dueña del script.
Desde el editor de Apps Script, elegir cualquier funcion (por ejemplo
`configurarInicial`) y darle Ejecutar — Google muestra la pantalla de permisos
con el permiso nuevo ("Conectarse a un servicio externo") y hay que aceptarla.
Sin esto, `apiLeerFactura` falla con "Los permisos especificados no son
suficientes para llamar a UrlFetchApp.fetch".

- [ ] **Step 6: Verificar el flujo completo**

Abrir la URL de la web app como admin y comprobar:
- Subir una foto de una factura real (o una imagen de prueba con texto de
  productos y cantidades legibles). "Leer factura" debe llenar la tabla con
  al menos una linea.
- Editar una linea a mano y agregar una linea nueva con "+ agregar linea"
  para un producto que no existe (con categoria y precio de venta).
- "Confirmar ingreso": el stock de los productos existentes debe subir por
  la cantidad indicada y su costo debe quedar igual al de la factura; el
  producto nuevo debe aparecer en la lista de productos con el stock y costo
  cargados.
- En "Ultimos movimientos" debe aparecer el ingreso. Anularlo y confirmar que
  el stock de cada producto involucrado baja de vuelta por la cantidad de su
  linea, y que el costo **no** cambia.

- [ ] **Step 7: Verificar el caso de fallo de Gemini**

Subir una imagen que no sea una factura (por ejemplo, una foto cualquiera).
`apiLeerFactura` debe devolver `ok: false` con un mensaje claro y la tabla
debe arrancar vacia, permitiendo cargar la factura a mano con
"+ agregar linea".

---

## Fuera de alcance de este plan

Revertir el `costo` del producto al anular un ingreso — ver Decision de
diseno 2 del spec de Fase 3.

Emparejamiento aproximado o difuso (fuzzy matching): si el nombre leido no
coincide exacto con `nombre` o `alias` de ningun producto, la linea sale
`esNuevo` y el admin corrige el texto a mano.

Historial de precios de un producto a traves del tiempo: el ingreso queda
trazado en `IngresosInventario`, pero no hay un reporte de evolucion de costo
por producto.
