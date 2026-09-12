# Fase 1: Inventario y Fiado con Auto-registro — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el fiado en papel y los Google Forms por una web app donde el comprador registra él mismo lo que se lleva y ve su saldo, y el admin gestiona productos y corrige errores.

**Architecture:** Google Sheets como base de datos, Google Apps Script como backend y HTML Service como frontend. La lógica de negocio vive en funciones puras (`src/dominio/`) que se prueban localmente con el runner de Node; los adaptadores de I/O (`src/datos/`, `src/app/`) son capas delgadas que se verifican manualmente. El código se sube a Apps Script con `clasp`.

**Tech Stack:** Google Apps Script (runtime V8), Google Sheets, `clasp` 2.4.x, Node.js 24 con `node --test` (sin dependencias de testing externas), HTML/CSS/JS vanilla en el frontend.

**Verificado:** el código de las Tareas 1-6 de este plan se extrajo y se ejecutó antes de publicarlo — las 48 pruebas pasan. El comando es `node --test` **sin argumento de ruta**: pasarle `test/` falla en Windows porque Node intenta resolverlo como módulo.

**Spec:** `docs/superpowers/specs/2026-09-12-tienda-sistema-design.md`

## Global Constraints

- **Idioma del código y la interfaz**: español. Identificadores, mensajes de error y textos de UI en español, sin tildes en los identificadores.
- **Dinero**: pesos colombianos como enteros. Nunca decimales, nunca floats para valores monetarios.
- **Compatibilidad Node + Apps Script**: cada archivo de `src/` termina exportando con el patrón `if (typeof module !== 'undefined') { module.exports = { ... }; }`. Apps Script ignora ese bloque porque `module` no existe ahí. Las dependencias entre módulos de `src/` se importan con el patrón `if (typeof require !== 'undefined') { var x = require('./y.js'); }` usando **`var`** (nunca `const`/`let`): en Apps Script todos los archivos comparten un único scope global, y una redeclaración `var` de un nombre ya existente es un no-op que no lo sobrescribe.
- **Borrado**: ningún registro se borra físicamente. Las correcciones se hacen anulando (`estado: 'anulado'`) con motivo, autor y fecha.
- **Fechas**: se guardan como texto ISO 8601 (`new Date().toISOString()`).
- **Zona horaria del proyecto**: `America/Bogota`.
- **Estados de transacción**: exactamente `pendiente` | `pagado` | `anulado`.
- **Origen de transacción**: exactamente `autoregistro` | `admin`.
- **Roles**: exactamente `admin` | `comprador`.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `package.json` | Scripts de test y push, dependencia de clasp |
| `.gitignore` | Excluye `node_modules/` y credenciales de clasp |
| `src/appsscript.json` | Manifiesto de Apps Script (scopes, config de web app) |
| `src/dominio/dinero.js` | Validación numérica y cálculo de totales |
| `src/dominio/productos.js` | Validación de productos, búsqueda por nombre, control de stock |
| `src/dominio/transacciones.js` | Creación y anulación de fiados |
| `src/dominio/saldo.js` | Cálculo y desglose del saldo de un comprador |
| `src/dominio/auth.js` | Hash de claves y resolución de usuario/rol |
| `src/datos/esquema.js` | Definición de columnas por hoja y conversión fila↔objeto |
| `src/datos/hoja.js` | Adaptador de lectura/escritura sobre Google Sheets |
| `src/datos/libro.js` | Obtención del Spreadsheet configurado |
| `src/app/api.js` | Funciones expuestas al frontend (orquestación, bloqueos, sesión) |
| `src/app/router.js` | `doGet` y selección de vista |
| `src/web/estilos.html` | CSS compartido |
| `src/web/micuenta.html` | Vista del comprador |
| `src/web/admin.html` | Vista del administrador |
| `test/ayudas/libroFalso.js` | Doble de prueba del Spreadsheet |
| `test/dominio/*.test.js` | Pruebas de la lógica de negocio |
| `test/datos/*.test.js` | Pruebas del adaptador de hojas |

---

### Task 1: Andamiaje del proyecto y primer módulo de dominio

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `src/appsscript.json`
- Create: `src/dominio/dinero.js`
- Test: `test/dominio/dinero.test.js`

**Interfaces:**
- Consumes: nada (primera tarea)
- Produces: `esEnteroPositivo(valor) -> boolean`, `calcularValorTotal(cantidad, valorUnitario) -> number`. Ambas usadas por `productos.js` y `transacciones.js`.

- [ ] **Step 1: Crear `package.json`**

```json
{
  "name": "tienda-sistemas",
  "version": "1.0.0",
  "private": true,
  "description": "Sistema de tienda interna del area de sistemas",
  "scripts": {
    "test": "node --test",
    "push": "clasp push"
  },
  "devDependencies": {
    "@google/clasp": "2.4.2"
  }
}
```

- [ ] **Step 2: Crear `.gitignore`**

```
node_modules/
.clasprc.json
*.log
```

- [ ] **Step 3: Crear `src/appsscript.json`**

```json
{
  "timeZone": "America/Bogota",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "ANYONE"
  },
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/userinfo.email"
  ]
}
```

Nota sobre `executeAs: USER_DEPLOYING` + `access: ANYONE`: el script corre con los permisos del admin (así puede escribir en su hoja sin compartirla con todos), y entra cualquiera con cuenta de Google. Para usuarios del mismo dominio del admin, `Session.getActiveUser().getEmail()` devuelve su correo, lo que da el login corporativo automático; para los demás devuelve cadena vacía y se muestra el formulario de usuario/clave.

- [ ] **Step 4: Instalar dependencias y verificar clasp**

```bash
npm install
npx clasp --version
```

Esperado: imprime una versión `2.4.x`.

- [ ] **Step 5: Escribir la prueba que falla**

Crear `test/dominio/dinero.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert');
const { esEnteroPositivo, calcularValorTotal } = require('../../src/dominio/dinero.js');

test('esEnteroPositivo acepta enteros mayores a cero', () => {
  assert.strictEqual(esEnteroPositivo(1), true);
  assert.strictEqual(esEnteroPositivo(1500), true);
});

test('esEnteroPositivo rechaza cero, negativos, decimales y no numeros', () => {
  assert.strictEqual(esEnteroPositivo(0), false);
  assert.strictEqual(esEnteroPositivo(-5), false);
  assert.strictEqual(esEnteroPositivo(1.5), false);
  assert.strictEqual(esEnteroPositivo('1500'), false);
  assert.strictEqual(esEnteroPositivo(null), false);
  assert.strictEqual(esEnteroPositivo(undefined), false);
});

test('calcularValorTotal multiplica cantidad por valor unitario', () => {
  assert.strictEqual(calcularValorTotal(3, 1500), 4500);
});

test('calcularValorTotal rechaza cantidad invalida', () => {
  assert.throws(() => calcularValorTotal(0, 1500), /cantidad/i);
});

test('calcularValorTotal rechaza valor unitario invalido', () => {
  assert.throws(() => calcularValorTotal(2, 0), /valor unitario/i);
});
```

- [ ] **Step 6: Correr la prueba para verificar que falla**

Run: `npm test`
Expected: FAIL — no encuentra el módulo `src/dominio/dinero.js`.

- [ ] **Step 7: Implementar `src/dominio/dinero.js`**

```javascript
function esEnteroPositivo(valor) {
  return typeof valor === 'number' && Number.isInteger(valor) && valor > 0;
}

function calcularValorTotal(cantidad, valorUnitario) {
  if (!esEnteroPositivo(cantidad)) {
    throw new Error('La cantidad debe ser un entero positivo');
  }
  if (!esEnteroPositivo(valorUnitario)) {
    throw new Error('El valor unitario debe ser un entero positivo');
  }
  return cantidad * valorUnitario;
}

if (typeof module !== 'undefined') {
  module.exports = { esEnteroPositivo, calcularValorTotal };
}
```

- [ ] **Step 8: Correr la prueba para verificar que pasa**

Run: `npm test`
Expected: PASS — 5 pruebas en verde.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json .gitignore src/appsscript.json src/dominio/dinero.js test/dominio/dinero.test.js
git commit -m "feat: andamiaje del proyecto y modulo de dinero"
```

---

### Task 2: Esquema de hojas y adaptador de acceso a datos

**Files:**
- Create: `src/datos/esquema.js`
- Create: `src/datos/hoja.js`
- Create: `test/ayudas/libroFalso.js`
- Test: `test/datos/hoja.test.js`

**Interfaces:**
- Consumes: nada del dominio.
- Produces:
  - `ESQUEMA` — objeto `{ Usuarios: string[], Productos: string[], Transacciones: string[] }` con los nombres de columna en orden.
  - `filaAObjeto(columnas, fila) -> objeto`
  - `objetoAFila(columnas, objeto) -> array`
  - `inicializarLibro(libro) -> void`
  - `leerTodo(libro, nombreHoja) -> objeto[]`
  - `agregarFila(libro, nombreHoja, objeto) -> void`
  - `actualizarPorId(libro, nombreHoja, id, cambios) -> boolean`
  - `crearLibroFalso(datosIniciales) -> libro` (solo para pruebas)

- [ ] **Step 1: Escribir el doble de prueba del Spreadsheet**

Crear `test/ayudas/libroFalso.js`. Imita la parte de la API de `SpreadsheetApp` que usa el adaptador: `getSheetByName`, `insertSheet`, `getLastRow`, `appendRow`, `getRange().getValues()`, `getRange().setValues()`.

```javascript
function crearHojaFalsa(nombre, filasIniciales) {
  const contenido = (filasIniciales || []).map(fila => fila.slice());
  return {
    nombre: nombre,
    contenido: contenido,
    getLastRow() {
      return contenido.length;
    },
    appendRow(fila) {
      contenido.push(fila.slice());
    },
    getRange(filaInicio, columnaInicio, numFilas, numColumnas) {
      return {
        getValues() {
          const resultado = [];
          for (let f = 0; f < numFilas; f++) {
            const filaExistente = contenido[filaInicio - 1 + f] || [];
            const fila = [];
            for (let c = 0; c < numColumnas; c++) {
              const valor = filaExistente[columnaInicio - 1 + c];
              fila.push(valor === undefined ? '' : valor);
            }
            resultado.push(fila);
          }
          return resultado;
        },
        setValues(valores) {
          valores.forEach((fila, f) => {
            const indice = filaInicio - 1 + f;
            if (!contenido[indice]) {
              contenido[indice] = [];
            }
            fila.forEach((valor, c) => {
              contenido[indice][columnaInicio - 1 + c] = valor;
            });
          });
        }
      };
    }
  };
}

function crearLibroFalso(datosIniciales) {
  const hojas = {};
  Object.keys(datosIniciales || {}).forEach(nombre => {
    hojas[nombre] = crearHojaFalsa(nombre, datosIniciales[nombre]);
  });
  return {
    hojas: hojas,
    getSheetByName(nombre) {
      return hojas[nombre] || null;
    },
    insertSheet(nombre) {
      hojas[nombre] = crearHojaFalsa(nombre, []);
      return hojas[nombre];
    }
  };
}

module.exports = { crearLibroFalso };
```

- [ ] **Step 2: Escribir las pruebas que fallan**

Crear `test/datos/hoja.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert');
const { ESQUEMA, filaAObjeto, objetoAFila } = require('../../src/datos/esquema.js');
const { inicializarLibro, leerTodo, agregarFila, actualizarPorId } = require('../../src/datos/hoja.js');
const { crearLibroFalso } = require('../ayudas/libroFalso.js');

test('el esquema define las tres hojas de la fase 1', () => {
  assert.deepStrictEqual(Object.keys(ESQUEMA).sort(), ['Productos', 'Transacciones', 'Usuarios']);
  assert.strictEqual(ESQUEMA.Productos[0], 'id');
});

test('filaAObjeto convierte una fila usando los nombres de columna', () => {
  const objeto = filaAObjeto(['id', 'nombre'], ['p1', 'Cafe']);
  assert.deepStrictEqual(objeto, { id: 'p1', nombre: 'Cafe' });
});

test('objetoAFila respeta el orden de columnas y rellena faltantes con cadena vacia', () => {
  const fila = objetoAFila(['id', 'nombre', 'categoria'], { nombre: 'Cafe', id: 'p1' });
  assert.deepStrictEqual(fila, ['p1', 'Cafe', '']);
});

test('inicializarLibro crea las hojas faltantes con sus encabezados', () => {
  const libro = crearLibroFalso({});
  inicializarLibro(libro);
  assert.deepStrictEqual(libro.hojas.Productos.contenido[0], ESQUEMA.Productos);
  assert.deepStrictEqual(libro.hojas.Usuarios.contenido[0], ESQUEMA.Usuarios);
});

test('leerTodo devuelve lista vacia cuando la hoja solo tiene encabezados', () => {
  const libro = crearLibroFalso({ Productos: [ESQUEMA.Productos] });
  assert.deepStrictEqual(leerTodo(libro, 'Productos'), []);
});

test('agregarFila y leerTodo hacen ida y vuelta del objeto', () => {
  const libro = crearLibroFalso({ Productos: [ESQUEMA.Productos] });
  agregarFila(libro, 'Productos', {
    id: 'p1',
    nombre: 'Cafe',
    categoria: 'Bebidas',
    costo: 800,
    precioVenta: 1500,
    stockActual: 10,
    activo: true
  });
  const productos = leerTodo(libro, 'Productos');
  assert.strictEqual(productos.length, 1);
  assert.strictEqual(productos[0].nombre, 'Cafe');
  assert.strictEqual(productos[0].precioVenta, 1500);
});

test('actualizarPorId modifica solo las columnas indicadas', () => {
  const libro = crearLibroFalso({ Productos: [ESQUEMA.Productos] });
  agregarFila(libro, 'Productos', {
    id: 'p1', nombre: 'Cafe', categoria: 'Bebidas',
    costo: 800, precioVenta: 1500, stockActual: 10, activo: true
  });
  const resultado = actualizarPorId(libro, 'Productos', 'p1', { stockActual: 7 });
  assert.strictEqual(resultado, true);
  const productos = leerTodo(libro, 'Productos');
  assert.strictEqual(productos[0].stockActual, 7);
  assert.strictEqual(productos[0].nombre, 'Cafe');
});

test('actualizarPorId devuelve false cuando el id no existe', () => {
  const libro = crearLibroFalso({ Productos: [ESQUEMA.Productos] });
  assert.strictEqual(actualizarPorId(libro, 'Productos', 'inexistente', { stockActual: 1 }), false);
});
```

- [ ] **Step 3: Correr las pruebas para verificar que fallan**

Run: `npm test`
Expected: FAIL — no encuentra `src/datos/esquema.js` ni `src/datos/hoja.js`.

- [ ] **Step 4: Implementar `src/datos/esquema.js`**

Importante: `ESQUEMA` se declara con **`var`**, no con `const`. En Apps Script los archivos comparten el scope global; `hoja.js` vuelve a declarar `var ESQUEMA` dentro de su bloque de `require` para Node, y una redeclaración `var` sobre un `const` global sería un `SyntaxError` que rompería todo el proyecto.

```javascript
var ESQUEMA = {
  Usuarios: [
    'id', 'nombre', 'area', 'rol', 'tipoLogin', 'emailCorporativo',
    'usuario', 'salt', 'claveHash', 'esPseudoUsuario', 'activo'
  ],
  Productos: [
    'id', 'nombre', 'categoria', 'costo', 'precioVenta', 'stockActual', 'activo'
  ],
  Transacciones: [
    'id', 'usuarioId', 'productoId', 'productoNombre', 'cantidad',
    'valorUnitario', 'valorTotal', 'fecha', 'origen', 'estado',
    'anuladoPor', 'anuladoFecha', 'anuladoMotivo'
  ]
};

function filaAObjeto(columnas, fila) {
  const objeto = {};
  columnas.forEach((columna, indice) => {
    objeto[columna] = fila[indice];
  });
  return objeto;
}

function objetoAFila(columnas, objeto) {
  return columnas.map(columna => {
    const valor = objeto[columna];
    return valor === undefined || valor === null ? '' : valor;
  });
}

if (typeof module !== 'undefined') {
  module.exports = { ESQUEMA, filaAObjeto, objetoAFila };
}
```

`productoNombre` se guarda dentro de la transacción a propósito: el desglose del comprador debe seguir mostrando el nombre que tenía el producto cuando se lo llevó, aunque después se renombre en el catálogo.

- [ ] **Step 5: Implementar `src/datos/hoja.js`**

```javascript
if (typeof require !== 'undefined') {
  // var (no const): en Apps Script todos los archivos comparten scope global
  // y una redeclaracion var de un nombre existente es un no-op.
  var esquemaModulo = require('./esquema.js');
  var ESQUEMA = esquemaModulo.ESQUEMA;
  var filaAObjeto = esquemaModulo.filaAObjeto;
  var objetoAFila = esquemaModulo.objetoAFila;
}

function inicializarLibro(libro) {
  Object.keys(ESQUEMA).forEach(nombreHoja => {
    let hoja = libro.getSheetByName(nombreHoja);
    if (!hoja) {
      hoja = libro.insertSheet(nombreHoja);
    }
    const columnas = ESQUEMA[nombreHoja];
    hoja.getRange(1, 1, 1, columnas.length).setValues([columnas]);
  });
}

function leerTodo(libro, nombreHoja) {
  const columnas = ESQUEMA[nombreHoja];
  const hoja = libro.getSheetByName(nombreHoja);
  if (!hoja) {
    throw new Error('No existe la hoja ' + nombreHoja);
  }
  const ultimaFila = hoja.getLastRow();
  if (ultimaFila < 2) {
    return [];
  }
  const filas = hoja.getRange(2, 1, ultimaFila - 1, columnas.length).getValues();
  return filas.map(fila => filaAObjeto(columnas, fila));
}

function agregarFila(libro, nombreHoja, objeto) {
  const columnas = ESQUEMA[nombreHoja];
  const hoja = libro.getSheetByName(nombreHoja);
  if (!hoja) {
    throw new Error('No existe la hoja ' + nombreHoja);
  }
  hoja.appendRow(objetoAFila(columnas, objeto));
}

function actualizarPorId(libro, nombreHoja, id, cambios) {
  const columnas = ESQUEMA[nombreHoja];
  const hoja = libro.getSheetByName(nombreHoja);
  if (!hoja) {
    throw new Error('No existe la hoja ' + nombreHoja);
  }
  const ultimaFila = hoja.getLastRow();
  if (ultimaFila < 2) {
    return false;
  }
  const filas = hoja.getRange(2, 1, ultimaFila - 1, columnas.length).getValues();
  for (let i = 0; i < filas.length; i++) {
    const objeto = filaAObjeto(columnas, filas[i]);
    if (objeto.id === id) {
      const actualizado = Object.assign({}, objeto, cambios);
      hoja.getRange(i + 2, 1, 1, columnas.length).setValues([objetoAFila(columnas, actualizado)]);
      return true;
    }
  }
  return false;
}

if (typeof module !== 'undefined') {
  module.exports = { inicializarLibro, leerTodo, agregarFila, actualizarPorId };
}
```

- [ ] **Step 6: Correr las pruebas para verificar que pasan**

Run: `npm test`
Expected: PASS — las 8 pruebas nuevas más las 5 de la Tarea 1.

- [ ] **Step 7: Commit**

```bash
git add src/datos/esquema.js src/datos/hoja.js test/ayudas/libroFalso.js test/datos/hoja.test.js
git commit -m "feat: esquema de hojas y adaptador de acceso a datos"
```

---

### Task 3: Dominio de productos e inventario

**Files:**
- Create: `src/dominio/productos.js`
- Test: `test/dominio/productos.test.js`

**Interfaces:**
- Consumes: `esEnteroPositivo` de `src/dominio/dinero.js`.
- Produces:
  - `normalizarNombre(nombre) -> string`
  - `validarProductoNuevo(datos) -> { valido: boolean, errores: string[] }` donde `datos` es `{ nombre, categoria, costo, precioVenta, stockActual }`
  - `buscarProductoPorNombre(productos, nombre) -> producto|null`
  - `hayStockSuficiente(producto, cantidad) -> boolean`
  - `descontarStock(producto, cantidad) -> producto` (copia con `stockActual` reducido)

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `test/dominio/productos.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert');
const {
  normalizarNombre,
  validarProductoNuevo,
  buscarProductoPorNombre,
  hayStockSuficiente,
  descontarStock
} = require('../../src/dominio/productos.js');

function productoDePrueba(cambios) {
  return Object.assign({
    id: 'p1',
    nombre: 'Cafe',
    categoria: 'Bebidas',
    costo: 800,
    precioVenta: 1500,
    stockActual: 10,
    activo: true
  }, cambios || {});
}

test('normalizarNombre quita tildes, espacios sobrantes y mayusculas', () => {
  assert.strictEqual(normalizarNombre('  Café  con   Leche '), 'cafe con leche');
});

test('validarProductoNuevo acepta un producto completo', () => {
  const resultado = validarProductoNuevo({
    nombre: 'Cafe', categoria: 'Bebidas', costo: 800, precioVenta: 1500, stockActual: 10
  });
  assert.deepStrictEqual(resultado, { valido: true, errores: [] });
});

test('validarProductoNuevo acepta stock inicial en cero', () => {
  const resultado = validarProductoNuevo({
    nombre: 'Cafe', categoria: 'Bebidas', costo: 800, precioVenta: 1500, stockActual: 0
  });
  assert.strictEqual(resultado.valido, true);
});

test('validarProductoNuevo reporta cada campo invalido', () => {
  const resultado = validarProductoNuevo({
    nombre: '   ', categoria: 'Bebidas', costo: 0, precioVenta: -1, stockActual: -5
  });
  assert.strictEqual(resultado.valido, false);
  assert.strictEqual(resultado.errores.length, 4);
});

test('buscarProductoPorNombre encuentra ignorando tildes y mayusculas', () => {
  const productos = [productoDePrueba({ id: 'p1', nombre: 'Café' })];
  assert.strictEqual(buscarProductoPorNombre(productos, 'CAFE').id, 'p1');
});

test('buscarProductoPorNombre devuelve null cuando no hay coincidencia', () => {
  assert.strictEqual(buscarProductoPorNombre([productoDePrueba()], 'Galletas'), null);
});

test('hayStockSuficiente compara contra el stock actual', () => {
  assert.strictEqual(hayStockSuficiente(productoDePrueba({ stockActual: 3 }), 3), true);
  assert.strictEqual(hayStockSuficiente(productoDePrueba({ stockActual: 3 }), 4), false);
});

test('descontarStock devuelve una copia con el stock reducido sin mutar el original', () => {
  const original = productoDePrueba({ stockActual: 10 });
  const resultado = descontarStock(original, 3);
  assert.strictEqual(resultado.stockActual, 7);
  assert.strictEqual(original.stockActual, 10);
});

test('descontarStock rechaza cantidades mayores al stock', () => {
  assert.throws(() => descontarStock(productoDePrueba({ stockActual: 2 }), 3), /stock insuficiente/i);
});

test('descontarStock rechaza cantidades invalidas', () => {
  assert.throws(() => descontarStock(productoDePrueba(), 0), /cantidad/i);
});
```

- [ ] **Step 2: Correr las pruebas para verificar que fallan**

Run: `npm test`
Expected: FAIL — no encuentra `src/dominio/productos.js`.

- [ ] **Step 3: Implementar `src/dominio/productos.js`**

```javascript
if (typeof require !== 'undefined') {
  var dineroModulo = require('./dinero.js');
  var esEnteroPositivo = dineroModulo.esEnteroPositivo;
}

function normalizarNombre(nombre) {
  return String(nombre === undefined || nombre === null ? '' : nombre)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function validarProductoNuevo(datos) {
  const errores = [];
  if (normalizarNombre(datos.nombre) === '') {
    errores.push('El nombre es obligatorio');
  }
  if (!esEnteroPositivo(datos.costo)) {
    errores.push('El costo debe ser un entero positivo');
  }
  if (!esEnteroPositivo(datos.precioVenta)) {
    errores.push('El precio de venta debe ser un entero positivo');
  }
  if (!Number.isInteger(datos.stockActual) || datos.stockActual < 0) {
    errores.push('El stock debe ser un entero mayor o igual a cero');
  }
  return { valido: errores.length === 0, errores: errores };
}

function buscarProductoPorNombre(productos, nombre) {
  const buscado = normalizarNombre(nombre);
  if (buscado === '') {
    return null;
  }
  for (let i = 0; i < productos.length; i++) {
    if (normalizarNombre(productos[i].nombre) === buscado) {
      return productos[i];
    }
  }
  return null;
}

function hayStockSuficiente(producto, cantidad) {
  return producto.stockActual >= cantidad;
}

function descontarStock(producto, cantidad) {
  if (!esEnteroPositivo(cantidad)) {
    throw new Error('La cantidad debe ser un entero positivo');
  }
  if (!hayStockSuficiente(producto, cantidad)) {
    throw new Error('Stock insuficiente para ' + producto.nombre);
  }
  return Object.assign({}, producto, { stockActual: producto.stockActual - cantidad });
}

if (typeof module !== 'undefined') {
  module.exports = {
    normalizarNombre,
    validarProductoNuevo,
    buscarProductoPorNombre,
    hayStockSuficiente,
    descontarStock
  };
}
```

- [ ] **Step 4: Correr las pruebas para verificar que pasan**

Run: `npm test`
Expected: PASS — 10 pruebas nuevas en verde.

- [ ] **Step 5: Commit**

```bash
git add src/dominio/productos.js test/dominio/productos.test.js
git commit -m "feat: dominio de productos e inventario"
```

---

### Task 4: Dominio de transacciones (fiado)

**Files:**
- Create: `src/dominio/transacciones.js`
- Test: `test/dominio/transacciones.test.js`

**Interfaces:**
- Consumes: `esEnteroPositivo`, `calcularValorTotal` de `dinero.js`; `hayStockSuficiente` de `productos.js`.
- Produces:
  - `crearTransaccionFiado({ id, usuarioId, producto, cantidad, fecha, origen }) -> transaccion`
  - `anularTransaccion(transaccion, { anuladoPor, anuladoFecha, anuladoMotivo }) -> transaccion`
  - `esActiva(transaccion) -> boolean`

  La forma del objeto `transaccion` es exactamente la lista de columnas de `ESQUEMA.Transacciones`.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `test/dominio/transacciones.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert');
const { crearTransaccionFiado, anularTransaccion, esActiva } = require('../../src/dominio/transacciones.js');

const PRODUCTO = {
  id: 'p1', nombre: 'Cafe', categoria: 'Bebidas',
  costo: 800, precioVenta: 1500, stockActual: 10, activo: true
};

function datosBase(cambios) {
  return Object.assign({
    id: 't1',
    usuarioId: 'u1',
    producto: PRODUCTO,
    cantidad: 2,
    fecha: '2026-09-12T10:00:00.000Z',
    origen: 'autoregistro'
  }, cambios || {});
}

test('crearTransaccionFiado arma la transaccion con el precio de venta del producto', () => {
  const transaccion = crearTransaccionFiado(datosBase());
  assert.strictEqual(transaccion.id, 't1');
  assert.strictEqual(transaccion.usuarioId, 'u1');
  assert.strictEqual(transaccion.productoId, 'p1');
  assert.strictEqual(transaccion.productoNombre, 'Cafe');
  assert.strictEqual(transaccion.cantidad, 2);
  assert.strictEqual(transaccion.valorUnitario, 1500);
  assert.strictEqual(transaccion.valorTotal, 3000);
  assert.strictEqual(transaccion.estado, 'pendiente');
  assert.strictEqual(transaccion.origen, 'autoregistro');
});

test('crearTransaccionFiado acepta origen admin', () => {
  assert.strictEqual(crearTransaccionFiado(datosBase({ origen: 'admin' })).origen, 'admin');
});

test('crearTransaccionFiado rechaza un origen desconocido', () => {
  assert.throws(() => crearTransaccionFiado(datosBase({ origen: 'otro' })), /origen/i);
});

test('crearTransaccionFiado rechaza cantidad invalida antes de mirar el stock', () => {
  assert.throws(() => crearTransaccionFiado(datosBase({ cantidad: 0 })), /cantidad/i);
});

test('crearTransaccionFiado rechaza cuando no alcanza el stock', () => {
  const producto = Object.assign({}, PRODUCTO, { stockActual: 1 });
  assert.throws(() => crearTransaccionFiado(datosBase({ producto: producto, cantidad: 2 })), /stock insuficiente/i);
});

test('crearTransaccionFiado exige usuario', () => {
  assert.throws(() => crearTransaccionFiado(datosBase({ usuarioId: '' })), /usuario/i);
});

test('esActiva distingue las anuladas', () => {
  assert.strictEqual(esActiva({ estado: 'pendiente' }), true);
  assert.strictEqual(esActiva({ estado: 'pagado' }), true);
  assert.strictEqual(esActiva({ estado: 'anulado' }), false);
});

test('anularTransaccion marca el registro conservando el original', () => {
  const original = crearTransaccionFiado(datosBase());
  const anulada = anularTransaccion(original, {
    anuladoPor: 'admin@ipuc.org.co',
    anuladoFecha: '2026-09-13T08:00:00.000Z',
    anuladoMotivo: 'Se lo cargue a la persona equivocada'
  });
  assert.strictEqual(anulada.estado, 'anulado');
  assert.strictEqual(anulada.anuladoPor, 'admin@ipuc.org.co');
  assert.strictEqual(anulada.anuladoMotivo, 'Se lo cargue a la persona equivocada');
  assert.strictEqual(anulada.valorTotal, 3000);
  assert.strictEqual(original.estado, 'pendiente');
});

test('anularTransaccion exige motivo', () => {
  const original = crearTransaccionFiado(datosBase());
  assert.throws(() => anularTransaccion(original, {
    anuladoPor: 'admin@ipuc.org.co', anuladoFecha: '2026-09-13T08:00:00.000Z', anuladoMotivo: '  '
  }), /motivo/i);
});

test('anularTransaccion rechaza anular dos veces', () => {
  const anulada = anularTransaccion(crearTransaccionFiado(datosBase()), {
    anuladoPor: 'admin@ipuc.org.co', anuladoFecha: '2026-09-13T08:00:00.000Z', anuladoMotivo: 'error'
  });
  assert.throws(() => anularTransaccion(anulada, {
    anuladoPor: 'admin@ipuc.org.co', anuladoFecha: '2026-09-14T08:00:00.000Z', anuladoMotivo: 'otra vez'
  }), /ya esta anulada/i);
});
```

- [ ] **Step 2: Correr las pruebas para verificar que fallan**

Run: `npm test`
Expected: FAIL — no encuentra `src/dominio/transacciones.js`.

- [ ] **Step 3: Implementar `src/dominio/transacciones.js`**

```javascript
if (typeof require !== 'undefined') {
  var dineroModulo = require('./dinero.js');
  var esEnteroPositivo = dineroModulo.esEnteroPositivo;
  var calcularValorTotal = dineroModulo.calcularValorTotal;
  var productosModulo = require('./productos.js');
  var hayStockSuficiente = productosModulo.hayStockSuficiente;
}

const ORIGENES_VALIDOS = ['autoregistro', 'admin'];

function crearTransaccionFiado(datos) {
  if (!datos.id) {
    throw new Error('Falta el id de la transaccion');
  }
  if (!datos.usuarioId) {
    throw new Error('Falta el usuario de la transaccion');
  }
  if (!datos.producto) {
    throw new Error('Falta el producto de la transaccion');
  }
  if (ORIGENES_VALIDOS.indexOf(datos.origen) === -1) {
    throw new Error('Origen invalido: ' + datos.origen);
  }
  if (!esEnteroPositivo(datos.cantidad)) {
    throw new Error('La cantidad debe ser un entero positivo');
  }
  if (!hayStockSuficiente(datos.producto, datos.cantidad)) {
    throw new Error('Stock insuficiente para ' + datos.producto.nombre);
  }
  const valorUnitario = datos.producto.precioVenta;
  return {
    id: datos.id,
    usuarioId: datos.usuarioId,
    productoId: datos.producto.id,
    productoNombre: datos.producto.nombre,
    cantidad: datos.cantidad,
    valorUnitario: valorUnitario,
    valorTotal: calcularValorTotal(datos.cantidad, valorUnitario),
    fecha: datos.fecha,
    origen: datos.origen,
    estado: 'pendiente',
    anuladoPor: '',
    anuladoFecha: '',
    anuladoMotivo: ''
  };
}

function esActiva(transaccion) {
  return transaccion.estado === 'pendiente' || transaccion.estado === 'pagado';
}

function anularTransaccion(transaccion, datos) {
  if (transaccion.estado === 'anulado') {
    throw new Error('La transaccion ya esta anulada');
  }
  if (!datos.anuladoMotivo || String(datos.anuladoMotivo).trim() === '') {
    throw new Error('Debe indicar el motivo de la anulacion');
  }
  return Object.assign({}, transaccion, {
    estado: 'anulado',
    anuladoPor: datos.anuladoPor,
    anuladoFecha: datos.anuladoFecha,
    anuladoMotivo: String(datos.anuladoMotivo).trim()
  });
}

if (typeof module !== 'undefined') {
  module.exports = { crearTransaccionFiado, anularTransaccion, esActiva };
}
```

- [ ] **Step 4: Correr las pruebas para verificar que pasan**

Run: `npm test`
Expected: PASS — 10 pruebas nuevas en verde.

- [ ] **Step 5: Commit**

```bash
git add src/dominio/transacciones.js test/dominio/transacciones.test.js
git commit -m "feat: dominio de transacciones de fiado"
```

---

### Task 5: Dominio de saldo del comprador

**Files:**
- Create: `src/dominio/saldo.js`
- Test: `test/dominio/saldo.test.js`

**Interfaces:**
- Consumes: nada (opera sobre objetos transacción ya construidos).
- Produces:
  - `calcularSaldoUsuario(transacciones, usuarioId) -> number`
  - `desglosarSaldoUsuario(transacciones, usuarioId) -> Array<{ id, fecha, concepto, cantidad, valorTotal }>` ordenado de más reciente a más antiguo.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `test/dominio/saldo.test.js`:

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

test('calcularSaldoUsuario suma solo las pendientes del usuario', () => {
  assert.strictEqual(calcularSaldoUsuario(TRANSACCIONES, 'u1'), 5000);
});

test('calcularSaldoUsuario ignora pagadas y anuladas', () => {
  const soloCerradas = TRANSACCIONES.filter(t => t.estado !== 'pendiente');
  assert.strictEqual(calcularSaldoUsuario(soloCerradas, 'u1'), 0);
});

test('calcularSaldoUsuario devuelve cero para un usuario sin movimientos', () => {
  assert.strictEqual(calcularSaldoUsuario(TRANSACCIONES, 'u9'), 0);
});

test('desglosarSaldoUsuario lista las pendientes de mas reciente a mas antigua', () => {
  const desglose = desglosarSaldoUsuario(TRANSACCIONES, 'u1');
  assert.deepStrictEqual(desglose.map(d => d.id), ['t2', 't1']);
  assert.deepStrictEqual(desglose[0], {
    id: 't2', fecha: '2026-09-11T10:00:00.000Z', concepto: 'Galletas', cantidad: 1, valorTotal: 2000
  });
});
```

- [ ] **Step 2: Correr las pruebas para verificar que fallan**

Run: `npm test`
Expected: FAIL — no encuentra `src/dominio/saldo.js`.

- [ ] **Step 3: Implementar `src/dominio/saldo.js`**

```javascript
function pendientesDe(transacciones, usuarioId) {
  return transacciones.filter(function (transaccion) {
    return transaccion.usuarioId === usuarioId && transaccion.estado === 'pendiente';
  });
}

function calcularSaldoUsuario(transacciones, usuarioId) {
  return pendientesDe(transacciones, usuarioId).reduce(function (total, transaccion) {
    return total + transaccion.valorTotal;
  }, 0);
}

function desglosarSaldoUsuario(transacciones, usuarioId) {
  return pendientesDe(transacciones, usuarioId)
    .map(function (transaccion) {
      return {
        id: transaccion.id,
        fecha: transaccion.fecha,
        concepto: transaccion.productoNombre,
        cantidad: transaccion.cantidad,
        valorTotal: transaccion.valorTotal
      };
    })
    .sort(function (a, b) {
      return String(b.fecha).localeCompare(String(a.fecha));
    });
}

if (typeof module !== 'undefined') {
  module.exports = { calcularSaldoUsuario, desglosarSaldoUsuario };
}
```

- [ ] **Step 4: Correr las pruebas para verificar que pasan**

Run: `npm test`
Expected: PASS — 4 pruebas nuevas en verde.

- [ ] **Step 5: Commit**

```bash
git add src/dominio/saldo.js test/dominio/saldo.test.js
git commit -m "feat: calculo de saldo y desglose del comprador"
```

---

### Task 6: Autenticación y resolución de usuario

**Files:**
- Create: `src/dominio/auth.js`
- Test: `test/dominio/auth.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `hashClave(clave, salt, funcionHash) -> string`
  - `verificarClave(clave, salt, hashEsperado, funcionHash) -> boolean`
  - `resolverUsuarioPorEmail(usuarios, email) -> usuario|null`
  - `resolverUsuarioPorClave(usuarios, usuario, clave, funcionHash) -> usuario|null`
  - `esAdmin(usuario) -> boolean`

  `funcionHash` es una función `(texto) -> string` inyectada por el llamador: en Apps Script se implementa con `Utilities.computeDigest`, en las pruebas con `node:crypto`. Se inyecta porque `Utilities` no existe fuera de Apps Script.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `test/dominio/auth.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const {
  hashClave, verificarClave, resolverUsuarioPorEmail, resolverUsuarioPorClave, esAdmin
} = require('../../src/dominio/auth.js');

function hashDePrueba(texto) {
  return crypto.createHash('sha256').update(texto, 'utf8').digest('hex');
}

const USUARIOS = [
  {
    id: 'u1', nombre: 'Andres', area: 'Sistemas', rol: 'admin',
    tipoLogin: 'google_corporativo', emailCorporativo: 'andres.puerta@ipuc.org.co',
    usuario: '', salt: '', claveHash: '', esPseudoUsuario: false, activo: true
  },
  {
    id: 'u2', nombre: 'Maria', area: 'Sistemas', rol: 'comprador',
    tipoLogin: 'usuario_clave', emailCorporativo: '',
    usuario: 'maria', salt: 'sal123', claveHash: hashDePrueba('sal123:secreta'),
    esPseudoUsuario: false, activo: true
  },
  {
    id: 'u3', nombre: 'Pedro', area: 'Sistemas', rol: 'comprador',
    tipoLogin: 'google_corporativo', emailCorporativo: 'pedro@ipuc.org.co',
    usuario: '', salt: '', claveHash: '', esPseudoUsuario: false, activo: false
  },
  {
    id: 'u4', nombre: 'Perdidas', area: 'Sistemas', rol: 'comprador',
    tipoLogin: '', emailCorporativo: '', usuario: '', salt: '', claveHash: '',
    esPseudoUsuario: true, activo: true
  }
];

test('hashClave combina salt y clave de forma estable', () => {
  assert.strictEqual(hashClave('secreta', 'sal123', hashDePrueba), hashDePrueba('sal123:secreta'));
});

test('hashClave cambia si cambia el salt', () => {
  assert.notStrictEqual(hashClave('secreta', 'sal123', hashDePrueba), hashClave('secreta', 'otra', hashDePrueba));
});

test('verificarClave acepta la clave correcta y rechaza la incorrecta', () => {
  const hash = hashClave('secreta', 'sal123', hashDePrueba);
  assert.strictEqual(verificarClave('secreta', 'sal123', hash, hashDePrueba), true);
  assert.strictEqual(verificarClave('otra', 'sal123', hash, hashDePrueba), false);
});

test('resolverUsuarioPorEmail encuentra ignorando mayusculas y espacios', () => {
  assert.strictEqual(resolverUsuarioPorEmail(USUARIOS, '  ANDRES.PUERTA@ipuc.org.co ').id, 'u1');
});

test('resolverUsuarioPorEmail devuelve null si el email viene vacio', () => {
  assert.strictEqual(resolverUsuarioPorEmail(USUARIOS, ''), null);
});

test('resolverUsuarioPorEmail ignora usuarios inactivos', () => {
  assert.strictEqual(resolverUsuarioPorEmail(USUARIOS, 'pedro@ipuc.org.co'), null);
});

test('resolverUsuarioPorEmail ignora pseudo usuarios', () => {
  const conPseudoEmail = USUARIOS.map(u => u.id === 'u4' ? Object.assign({}, u, { emailCorporativo: 'perdidas@ipuc.org.co' }) : u);
  assert.strictEqual(resolverUsuarioPorEmail(conPseudoEmail, 'perdidas@ipuc.org.co'), null);
});

test('resolverUsuarioPorClave devuelve el usuario con la clave correcta', () => {
  assert.strictEqual(resolverUsuarioPorClave(USUARIOS, 'maria', 'secreta', hashDePrueba).id, 'u2');
});

test('resolverUsuarioPorClave devuelve null con clave incorrecta', () => {
  assert.strictEqual(resolverUsuarioPorClave(USUARIOS, 'maria', 'incorrecta', hashDePrueba), null);
});

test('resolverUsuarioPorClave devuelve null con usuario inexistente', () => {
  assert.strictEqual(resolverUsuarioPorClave(USUARIOS, 'nadie', 'secreta', hashDePrueba), null);
});

test('esAdmin solo es cierto para el rol admin', () => {
  assert.strictEqual(esAdmin(USUARIOS[0]), true);
  assert.strictEqual(esAdmin(USUARIOS[1]), false);
  assert.strictEqual(esAdmin(null), false);
});
```

- [ ] **Step 2: Correr las pruebas para verificar que fallan**

Run: `npm test`
Expected: FAIL — no encuentra `src/dominio/auth.js`.

- [ ] **Step 3: Implementar `src/dominio/auth.js`**

```javascript
function hashClave(clave, salt, funcionHash) {
  return funcionHash(String(salt) + ':' + String(clave));
}

function verificarClave(clave, salt, hashEsperado, funcionHash) {
  if (!hashEsperado) {
    return false;
  }
  return hashClave(clave, salt, funcionHash) === hashEsperado;
}

function esUsuarioUtilizable(usuario) {
  return usuario.activo === true && usuario.esPseudoUsuario !== true;
}

function textoComparable(valor) {
  return String(valor === undefined || valor === null ? '' : valor).trim().toLowerCase();
}

function resolverUsuarioPorEmail(usuarios, email) {
  const buscado = textoComparable(email);
  if (buscado === '') {
    return null;
  }
  for (let i = 0; i < usuarios.length; i++) {
    const usuario = usuarios[i];
    if (esUsuarioUtilizable(usuario) && textoComparable(usuario.emailCorporativo) === buscado) {
      return usuario;
    }
  }
  return null;
}

function resolverUsuarioPorClave(usuarios, usuario, clave, funcionHash) {
  const buscado = textoComparable(usuario);
  if (buscado === '') {
    return null;
  }
  for (let i = 0; i < usuarios.length; i++) {
    const candidato = usuarios[i];
    if (esUsuarioUtilizable(candidato) && textoComparable(candidato.usuario) === buscado) {
      if (verificarClave(clave, candidato.salt, candidato.claveHash, funcionHash)) {
        return candidato;
      }
      return null;
    }
  }
  return null;
}

function esAdmin(usuario) {
  return !!usuario && usuario.rol === 'admin';
}

if (typeof module !== 'undefined') {
  module.exports = { hashClave, verificarClave, resolverUsuarioPorEmail, resolverUsuarioPorClave, esAdmin };
}
```

- [ ] **Step 4: Correr las pruebas para verificar que pasan**

Run: `npm test`
Expected: PASS — 11 pruebas nuevas en verde.

- [ ] **Step 5: Commit**

```bash
git add src/dominio/auth.js test/dominio/auth.test.js
git commit -m "feat: autenticacion y resolucion de usuario"
```

---

### Task 7: Capa de aplicación — API del servidor

**Files:**
- Create: `src/datos/libro.js`
- Create: `src/app/api.js`

**Interfaces:**
- Consumes: todo lo anterior (`ESQUEMA`, `leerTodo`, `agregarFila`, `actualizarPorId`, dominio completo).
- Produces (funciones llamadas desde el frontend con `google.script.run`):
  - `apiIniciarSesion(usuario, clave) -> { ok: boolean, token: string, mensaje: string }`
  - `apiObtenerEstado(token) -> { autenticado, nombre, rol, saldo, desglose, productos, mensaje }`
  - `apiRegistrarFiado(token, productoId, cantidad) -> { ok, mensaje, saldo, desglose, productos }`
  - `apiCrearProducto(token, datos) -> { ok, mensaje, productos }`
  - `apiActualizarProducto(token, productoId, cambios) -> { ok, mensaje, productos }`
  - `apiListarTransaccionesRecientes(token) -> { ok, mensaje, transacciones }`
  - `apiRegistrarFiadoComoAdmin(token, usuarioId, productoId, cantidad) -> { ok, mensaje }`
  - `apiAnularTransaccion(token, transaccionId, motivo) -> { ok, mensaje }`
  - `apiListarUsuarios(token) -> { ok, mensaje, usuarios }`
  - `configurarInicial() -> string` (se ejecuta a mano una vez desde el editor de Apps Script)

  Esta capa es I/O puro sobre Sheets: se verifica manualmente en la Tarea 10, no con pruebas unitarias.

- [ ] **Step 1: Implementar `src/datos/libro.js`**

```javascript
function obtenerLibro() {
  const id = PropertiesService.getScriptProperties().getProperty('ID_LIBRO');
  if (!id) {
    throw new Error('Falta configurar la propiedad de script ID_LIBRO');
  }
  return SpreadsheetApp.openById(id);
}

function hashConUtilities(texto) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto, Utilities.Charset.UTF_8);
  return bytes.map(function (byte) {
    return ((byte & 0xff) + 0x100).toString(16).slice(1);
  }).join('');
}

function nuevoId() {
  return Utilities.getUuid();
}

function ahoraIso() {
  return new Date().toISOString();
}
```

Este archivo no exporta con `module.exports` porque solo corre dentro de Apps Script.

- [ ] **Step 2: Implementar `src/app/api.js`**

La sesión de los usuarios sin correo corporativo se maneja con un token aleatorio guardado en `CacheService` por 6 horas. El navegador lo guarda en `localStorage` y lo manda en cada llamada. Los usuarios del dominio no usan token: se identifican con `Session.getActiveUser()`.

Todas las escrituras que tocan stock se envuelven en `LockService.getScriptLock()` para que dos compradores registrando el último producto al mismo tiempo no dejen el stock negativo.

```javascript
const DURACION_SESION_SEGUNDOS = 21600;

function usuarioDeToken(token) {
  if (!token) {
    return null;
  }
  const usuarioId = CacheService.getScriptCache().get('sesion_' + token);
  if (!usuarioId) {
    return null;
  }
  const usuarios = leerTodo(obtenerLibro(), 'Usuarios');
  for (let i = 0; i < usuarios.length; i++) {
    if (usuarios[i].id === usuarioId && usuarios[i].activo === true) {
      return usuarios[i];
    }
  }
  return null;
}

function usuarioDeSesion(token) {
  let email = '';
  try {
    email = Session.getActiveUser().getEmail();
  } catch (error) {
    email = '';
  }
  if (email) {
    const usuario = resolverUsuarioPorEmail(leerTodo(obtenerLibro(), 'Usuarios'), email);
    if (usuario) {
      return usuario;
    }
  }
  return usuarioDeToken(token);
}

function exigirUsuario(token) {
  const usuario = usuarioDeSesion(token);
  if (!usuario) {
    throw new Error('Sesion no valida. Vuelva a iniciar sesion.');
  }
  return usuario;
}

function exigirAdmin(token) {
  const usuario = exigirUsuario(token);
  if (!esAdmin(usuario)) {
    throw new Error('Esta accion es solo para el administrador');
  }
  return usuario;
}

function productosVisibles() {
  return leerTodo(obtenerLibro(), 'Productos')
    .filter(function (producto) { return producto.activo === true; })
    .map(function (producto) {
      return {
        id: producto.id,
        nombre: producto.nombre,
        categoria: producto.categoria,
        precioVenta: producto.precioVenta,
        stockActual: producto.stockActual
      };
    });
}

function estadoDeUsuario(usuario) {
  const transacciones = leerTodo(obtenerLibro(), 'Transacciones');
  return {
    autenticado: true,
    nombre: usuario.nombre,
    rol: usuario.rol,
    saldo: calcularSaldoUsuario(transacciones, usuario.id),
    desglose: desglosarSaldoUsuario(transacciones, usuario.id),
    productos: productosVisibles(),
    mensaje: ''
  };
}

function apiIniciarSesion(usuario, clave) {
  const usuarios = leerTodo(obtenerLibro(), 'Usuarios');
  const encontrado = resolverUsuarioPorClave(usuarios, usuario, clave, hashConUtilities);
  if (!encontrado) {
    return { ok: false, token: '', mensaje: 'Usuario o clave incorrectos' };
  }
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put('sesion_' + token, encontrado.id, DURACION_SESION_SEGUNDOS);
  return { ok: true, token: token, mensaje: '' };
}

function apiObtenerEstado(token) {
  const usuario = usuarioDeSesion(token);
  if (!usuario) {
    return {
      autenticado: false, nombre: '', rol: '', saldo: 0,
      desglose: [], productos: [], mensaje: 'Inicie sesion para continuar'
    };
  }
  return estadoDeUsuario(usuario);
}

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
    const transaccion = crearTransaccionFiado({
      id: nuevoId(),
      usuarioId: usuario.id,
      producto: producto,
      cantidad: cantidad,
      fecha: ahoraIso(),
      origen: origen
    });
    const actualizado = descontarStock(producto, cantidad);
    agregarFila(libro, 'Transacciones', transaccion);
    actualizarPorId(libro, 'Productos', producto.id, { stockActual: actualizado.stockActual });
    return transaccion;
  } finally {
    bloqueo.releaseLock();
  }
}

function apiRegistrarFiado(token, productoId, cantidad) {
  try {
    const usuario = exigirUsuario(token);
    const transaccion = registrarFiado(usuario, productoId, Number(cantidad), 'autoregistro');
    const estado = estadoDeUsuario(usuario);
    estado.ok = true;
    estado.mensaje = 'Registrado: ' + transaccion.cantidad + ' x ' + transaccion.productoNombre;
    return estado;
  } catch (error) {
    return { ok: false, mensaje: error.message, saldo: 0, desglose: [], productos: [] };
  }
}

function apiCrearProducto(token, datos) {
  try {
    exigirAdmin(token);
    const normalizados = {
      nombre: String(datos.nombre || '').trim(),
      categoria: String(datos.categoria || '').trim(),
      costo: Number(datos.costo),
      precioVenta: Number(datos.precioVenta),
      stockActual: Number(datos.stockActual)
    };
    const validacion = validarProductoNuevo(normalizados);
    if (!validacion.valido) {
      return { ok: false, mensaje: validacion.errores.join('. '), productos: [] };
    }
    const libro = obtenerLibro();
    if (buscarProductoPorNombre(leerTodo(libro, 'Productos'), normalizados.nombre)) {
      return { ok: false, mensaje: 'Ya existe un producto con ese nombre', productos: [] };
    }
    agregarFila(libro, 'Productos', {
      id: nuevoId(),
      nombre: normalizados.nombre,
      categoria: normalizados.categoria,
      costo: normalizados.costo,
      precioVenta: normalizados.precioVenta,
      stockActual: normalizados.stockActual,
      activo: true
    });
    return { ok: true, mensaje: 'Producto creado', productos: productosVisibles() };
  } catch (error) {
    return { ok: false, mensaje: error.message, productos: [] };
  }
}

function apiActualizarProducto(token, productoId, cambios) {
  try {
    exigirAdmin(token);
    const permitidos = {};
    ['nombre', 'categoria', 'costo', 'precioVenta', 'stockActual', 'activo'].forEach(function (campo) {
      if (cambios[campo] !== undefined && cambios[campo] !== null && cambios[campo] !== '') {
        permitidos[campo] = campo === 'nombre' || campo === 'categoria'
          ? String(cambios[campo]).trim()
          : (campo === 'activo' ? cambios[campo] === true : Number(cambios[campo]));
      }
    });
    const encontrado = actualizarPorId(obtenerLibro(), 'Productos', productoId, permitidos);
    if (!encontrado) {
      return { ok: false, mensaje: 'No se encontro el producto', productos: [] };
    }
    return { ok: true, mensaje: 'Producto actualizado', productos: productosVisibles() };
  } catch (error) {
    return { ok: false, mensaje: error.message, productos: [] };
  }
}

function apiListarUsuarios(token) {
  try {
    exigirAdmin(token);
    const usuarios = leerTodo(obtenerLibro(), 'Usuarios')
      .filter(function (usuario) { return usuario.activo === true; })
      .map(function (usuario) {
        return { id: usuario.id, nombre: usuario.nombre, esPseudoUsuario: usuario.esPseudoUsuario === true };
      });
    return { ok: true, mensaje: '', usuarios: usuarios };
  } catch (error) {
    return { ok: false, mensaje: error.message, usuarios: [] };
  }
}

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

function apiListarTransaccionesRecientes(token) {
  try {
    exigirAdmin(token);
    const usuarios = leerTodo(obtenerLibro(), 'Usuarios');
    const nombrePorId = {};
    usuarios.forEach(function (usuario) { nombrePorId[usuario.id] = usuario.nombre; });
    const transacciones = leerTodo(obtenerLibro(), 'Transacciones')
      .sort(function (a, b) { return String(b.fecha).localeCompare(String(a.fecha)); })
      .slice(0, 50)
      .map(function (transaccion) {
        return {
          id: transaccion.id,
          fecha: transaccion.fecha,
          usuario: nombrePorId[transaccion.usuarioId] || transaccion.usuarioId,
          concepto: transaccion.productoNombre,
          cantidad: transaccion.cantidad,
          valorTotal: transaccion.valorTotal,
          origen: transaccion.origen,
          estado: transaccion.estado
        };
      });
    return { ok: true, mensaje: '', transacciones: transacciones };
  } catch (error) {
    return { ok: false, mensaje: error.message, transacciones: [] };
  }
}

function apiAnularTransaccion(token, transaccionId, motivo) {
  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(30000);
  try {
    const admin = exigirAdmin(token);
    const libro = obtenerLibro();
    const transacciones = leerTodo(libro, 'Transacciones');
    let original = null;
    for (let i = 0; i < transacciones.length; i++) {
      if (transacciones[i].id === transaccionId) {
        original = transacciones[i];
        break;
      }
    }
    if (!original) {
      return { ok: false, mensaje: 'No se encontro la transaccion' };
    }
    const anulada = anularTransaccion(original, {
      anuladoPor: admin.nombre,
      anuladoFecha: ahoraIso(),
      anuladoMotivo: motivo
    });
    actualizarPorId(libro, 'Transacciones', transaccionId, {
      estado: anulada.estado,
      anuladoPor: anulada.anuladoPor,
      anuladoFecha: anulada.anuladoFecha,
      anuladoMotivo: anulada.anuladoMotivo
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
    return { ok: true, mensaje: 'Movimiento anulado y stock devuelto' };
  } catch (error) {
    return { ok: false, mensaje: error.message };
  } finally {
    bloqueo.releaseLock();
  }
}

function configurarInicial() {
  const libro = obtenerLibro();
  inicializarLibro(libro);
  const email = Session.getEffectiveUser().getEmail();
  const usuarios = leerTodo(libro, 'Usuarios');
  if (resolverUsuarioPorEmail(usuarios, email)) {
    return 'El libro ya estaba inicializado y el admin ya existe: ' + email;
  }
  agregarFila(libro, 'Usuarios', {
    id: nuevoId(),
    nombre: 'Administrador',
    area: 'Sistemas',
    rol: 'admin',
    tipoLogin: 'google_corporativo',
    emailCorporativo: email,
    usuario: '',
    salt: '',
    claveHash: '',
    esPseudoUsuario: false,
    activo: true
  });
  return 'Libro inicializado y admin creado para ' + email;
}
```

- [ ] **Step 3: Verificar que las pruebas existentes siguen pasando**

Run: `npm test`
Expected: PASS — los archivos nuevos no tienen pruebas propias, pero no deben romper nada.

- [ ] **Step 4: Commit**

```bash
git add src/datos/libro.js src/app/api.js
git commit -m "feat: capa de aplicacion con sesiones, bloqueos y API del servidor"
```

---

### Task 8: Router y vista "Mi cuenta"

**Files:**
- Create: `src/app/router.js`
- Create: `src/web/estilos.html`
- Create: `src/web/micuenta.html`

**Interfaces:**
- Consumes: `apiObtenerEstado`, `apiIniciarSesion`, `apiRegistrarFiado` de `api.js`.
- Produces: `doGet(e) -> HtmlOutput`. Con `?vista=admin` sirve `admin.html`, en cualquier otro caso `micuenta.html`.

- [ ] **Step 1: Implementar `src/app/router.js`**

```javascript
function doGet(e) {
  const vista = e && e.parameter && e.parameter.vista === 'admin' ? 'admin' : 'micuenta';
  const plantilla = HtmlService.createTemplateFromFile('web/' + vista);
  return plantilla.evaluate()
    .setTitle('Tienda Sistemas')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function incluir(nombreArchivo) {
  return HtmlService.createHtmlOutputFromFile(nombreArchivo).getContent();
}
```

- [ ] **Step 2: Implementar `src/web/estilos.html`**

```html
<style>
  :root {
    --fondo: #f5f6f8;
    --tarjeta: #ffffff;
    --texto: #1c1d20;
    --suave: #6b7280;
    --borde: #e2e4e9;
    --acento: #1f6feb;
    --error: #b42318;
    --ok: #12703a;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 16px;
    background: var(--fondo);
    color: var(--texto);
    font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
    font-size: 16px;
  }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 0 0 12px; }
  .sub { color: var(--suave); font-size: 14px; margin: 0 0 16px; }
  .tarjeta {
    background: var(--tarjeta);
    border: 1px solid var(--borde);
    border-radius: 10px;
    padding: 16px;
    margin-bottom: 16px;
  }
  .saldo { font-size: 32px; font-weight: 600; margin: 4px 0 0; }
  label { display: block; font-size: 14px; margin: 12px 0 4px; }
  select, input, button, textarea {
    width: 100%;
    padding: 10px;
    font-size: 16px;
    border: 1px solid var(--borde);
    border-radius: 8px;
    font-family: inherit;
  }
  button {
    background: var(--acento);
    color: #fff;
    border: none;
    font-weight: 600;
    margin-top: 14px;
    cursor: pointer;
  }
  button:disabled { opacity: 0.6; cursor: default; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 8px 4px; border-bottom: 1px solid var(--borde); }
  th { color: var(--suave); font-weight: 500; }
  td.valor, th.valor { text-align: right; white-space: nowrap; }
  .aviso { padding: 10px; border-radius: 8px; font-size: 14px; margin-top: 12px; }
  .aviso.error { background: #fdeceb; color: var(--error); }
  .aviso.ok { background: #e7f4ec; color: var(--ok); }
  .vacio { color: var(--suave); font-size: 14px; }
  @media (min-width: 720px) {
    body { max-width: 720px; margin: 0 auto; }
  }
</style>
```

- [ ] **Step 3: Implementar `src/web/micuenta.html`**

```html
<!DOCTYPE html>
<html lang="es">
  <head>
    <base target="_top">
    <?!= incluir('web/estilos') ?>
  </head>
  <body>
    <div id="cargando" class="tarjeta">Cargando...</div>

    <div id="login" class="tarjeta" hidden>
      <h1>Tienda Sistemas</h1>
      <p class="sub">Ingrese con el usuario que le asigno el administrador.</p>
      <label for="usuario">Usuario</label>
      <input id="usuario" type="text" autocomplete="username">
      <label for="clave">Clave</label>
      <input id="clave" type="password" autocomplete="current-password">
      <button id="btnEntrar">Entrar</button>
      <div id="avisoLogin"></div>
    </div>

    <div id="cuenta" hidden>
      <div class="tarjeta">
        <h1 id="saludo"></h1>
        <p class="sub">Saldo pendiente</p>
        <p class="saldo" id="saldo"></p>
      </div>

      <div class="tarjeta">
        <h2>Registrar lo que me llevo</h2>
        <label for="producto">Producto</label>
        <select id="producto"></select>
        <label for="cantidad">Cantidad</label>
        <input id="cantidad" type="number" min="1" step="1" value="1">
        <button id="btnRegistrar">Registrar</button>
        <div id="avisoRegistro"></div>
      </div>

      <div class="tarjeta">
        <h2>Lo que estoy debiendo</h2>
        <table>
          <thead>
            <tr><th>Fecha</th><th>Producto</th><th class="valor">Cant.</th><th class="valor">Valor</th></tr>
          </thead>
          <tbody id="desglose"></tbody>
        </table>
        <p id="sinDeuda" class="vacio" hidden>No tiene nada pendiente.</p>
      </div>
    </div>

    <script>
      var token = '';
      try { token = localStorage.getItem('tokenTienda') || ''; } catch (e) { token = ''; }

      function pesos(valor) {
        return '$' + Number(valor || 0).toLocaleString('es-CO');
      }

      function fechaCorta(iso) {
        var fecha = new Date(iso);
        if (isNaN(fecha.getTime())) { return String(iso); }
        return fecha.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
      }

      function mostrarAviso(idContenedor, texto, esError) {
        var contenedor = document.getElementById(idContenedor);
        if (!texto) { contenedor.innerHTML = ''; return; }
        contenedor.innerHTML = '<div class="aviso ' + (esError ? 'error' : 'ok') + '"></div>';
        contenedor.firstChild.textContent = texto;
      }

      function pintarEstado(estado) {
        document.getElementById('cargando').hidden = true;
        if (!estado.autenticado) {
          document.getElementById('cuenta').hidden = true;
          document.getElementById('login').hidden = false;
          return;
        }
        document.getElementById('login').hidden = true;
        document.getElementById('cuenta').hidden = false;
        document.getElementById('saludo').textContent = 'Hola, ' + estado.nombre;
        document.getElementById('saldo').textContent = pesos(estado.saldo);

        var select = document.getElementById('producto');
        select.innerHTML = '';
        estado.productos.forEach(function (producto) {
          var opcion = document.createElement('option');
          opcion.value = producto.id;
          opcion.textContent = producto.nombre + ' - ' + pesos(producto.precioVenta) + ' (quedan ' + producto.stockActual + ')';
          opcion.disabled = producto.stockActual <= 0;
          select.appendChild(opcion);
        });

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
        document.getElementById('sinDeuda').hidden = estado.desglose.length > 0;
      }

      function cargarEstado() {
        google.script.run.withSuccessHandler(pintarEstado).apiObtenerEstado(token);
      }

      document.getElementById('btnEntrar').addEventListener('click', function () {
        var boton = this;
        boton.disabled = true;
        mostrarAviso('avisoLogin', '', false);
        google.script.run.withSuccessHandler(function (respuesta) {
          boton.disabled = false;
          if (!respuesta.ok) {
            mostrarAviso('avisoLogin', respuesta.mensaje, true);
            return;
          }
          token = respuesta.token;
          try { localStorage.setItem('tokenTienda', token); } catch (e) {}
          cargarEstado();
        }).apiIniciarSesion(
          document.getElementById('usuario').value,
          document.getElementById('clave').value
        );
      });

      document.getElementById('btnRegistrar').addEventListener('click', function () {
        var boton = this;
        boton.disabled = true;
        mostrarAviso('avisoRegistro', '', false);
        google.script.run.withSuccessHandler(function (respuesta) {
          boton.disabled = false;
          mostrarAviso('avisoRegistro', respuesta.mensaje, !respuesta.ok);
          if (respuesta.ok) {
            respuesta.autenticado = true;
            pintarEstado(respuesta);
            document.getElementById('cantidad').value = '1';
          }
        }).apiRegistrarFiado(
          token,
          document.getElementById('producto').value,
          Number(document.getElementById('cantidad').value)
        );
      });

      cargarEstado();
    </script>
  </body>
</html>
```

Nota: `apiRegistrarFiado` devuelve el estado completo (saldo, desglose, productos) más `ok` y `mensaje`, por eso se reutiliza `pintarEstado` tras registrar. Se le fija `autenticado = true` porque esa respuesta no trae ese campo.

- [ ] **Step 4: Verificar que las pruebas siguen pasando**

Run: `npm test`
Expected: PASS — sin cambios en el dominio.

- [ ] **Step 5: Commit**

```bash
git add src/app/router.js src/web/estilos.html src/web/micuenta.html
git commit -m "feat: router y vista Mi cuenta del comprador"
```

---

### Task 9: Vista de administrador

**Files:**
- Create: `src/web/admin.html`

**Interfaces:**
- Consumes: `apiObtenerEstado`, `apiCrearProducto`, `apiActualizarProducto`, `apiListarUsuarios`, `apiRegistrarFiadoComoAdmin`, `apiListarTransaccionesRecientes`, `apiAnularTransaccion`.
- Produces: nada que otras tareas consuman.

- [ ] **Step 1: Implementar `src/web/admin.html`**

```html
<!DOCTYPE html>
<html lang="es">
  <head>
    <base target="_top">
    <?!= incluir('web/estilos') ?>
  </head>
  <body>
    <div id="cargando" class="tarjeta">Cargando...</div>
    <div id="sinPermiso" class="tarjeta" hidden>
      <h1>Solo para el administrador</h1>
      <p class="sub">Esta vista requiere iniciar sesion como administrador.</p>
    </div>

    <div id="panel" hidden>
      <div class="tarjeta">
        <h1>Panel de administracion</h1>
        <p class="sub" id="quien"></p>
      </div>

      <div class="tarjeta">
        <h2>Nuevo producto</h2>
        <label for="nombre">Nombre</label>
        <input id="nombre" type="text">
        <label for="categoria">Categoria</label>
        <input id="categoria" type="text">
        <label for="costo">Costo (lo que me costo)</label>
        <input id="costo" type="number" min="1" step="1">
        <label for="precioVenta">Precio de venta</label>
        <input id="precioVenta" type="number" min="1" step="1">
        <label for="stockInicial">Stock inicial</label>
        <input id="stockInicial" type="number" min="0" step="1" value="0">
        <button id="btnCrearProducto">Crear producto</button>
        <div id="avisoProducto"></div>
      </div>

      <div class="tarjeta">
        <h2>Ajustar stock</h2>
        <label for="productoAjuste">Producto</label>
        <select id="productoAjuste"></select>
        <label for="stockNuevo">Nuevo stock</label>
        <input id="stockNuevo" type="number" min="0" step="1">
        <button id="btnAjustarStock">Guardar stock</button>
        <div id="avisoStock"></div>
      </div>

      <div class="tarjeta">
        <h2>Registrar fiado a nombre de alguien</h2>
        <label for="usuarioDestino">Comprador</label>
        <select id="usuarioDestino"></select>
        <label for="productoAdmin">Producto</label>
        <select id="productoAdmin"></select>
        <label for="cantidadAdmin">Cantidad</label>
        <input id="cantidadAdmin" type="number" min="1" step="1" value="1">
        <button id="btnFiadoAdmin">Registrar</button>
        <div id="avisoFiadoAdmin"></div>
      </div>

      <div class="tarjeta">
        <h2>Ultimos movimientos</h2>
        <table>
          <thead>
            <tr><th>Fecha</th><th>Quien</th><th>Producto</th><th class="valor">Valor</th><th></th></tr>
          </thead>
          <tbody id="movimientos"></tbody>
        </table>
        <div id="avisoAnulacion"></div>
      </div>
    </div>

    <script>
      var token = '';
      try { token = localStorage.getItem('tokenTienda') || ''; } catch (e) { token = ''; }
      var productosCache = [];

      function pesos(valor) {
        return '$' + Number(valor || 0).toLocaleString('es-CO');
      }

      function fechaCorta(iso) {
        var fecha = new Date(iso);
        if (isNaN(fecha.getTime())) { return String(iso); }
        return fecha.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
      }

      function mostrarAviso(idContenedor, texto, esError) {
        var contenedor = document.getElementById(idContenedor);
        if (!texto) { contenedor.innerHTML = ''; return; }
        contenedor.innerHTML = '<div class="aviso ' + (esError ? 'error' : 'ok') + '"></div>';
        contenedor.firstChild.textContent = texto;
      }

      function llenarSelectProductos(select, productos) {
        select.innerHTML = '';
        productos.forEach(function (producto) {
          var opcion = document.createElement('option');
          opcion.value = producto.id;
          opcion.textContent = producto.nombre + ' (' + producto.stockActual + ')';
          select.appendChild(opcion);
        });
      }

      function pintarProductos(productos) {
        productosCache = productos;
        llenarSelectProductos(document.getElementById('productoAjuste'), productos);
        llenarSelectProductos(document.getElementById('productoAdmin'), productos);
      }

      function cargarMovimientos() {
        google.script.run.withSuccessHandler(function (respuesta) {
          var cuerpo = document.getElementById('movimientos');
          cuerpo.innerHTML = '';
          respuesta.transacciones.forEach(function (movimiento) {
            var fila = document.createElement('tr');
            [fechaCorta(movimiento.fecha), movimiento.usuario, movimiento.concepto + ' x' + movimiento.cantidad, pesos(movimiento.valorTotal)]
              .forEach(function (texto, indice) {
                var celda = document.createElement('td');
                if (indice === 3) { celda.className = 'valor'; }
                celda.textContent = texto;
                fila.appendChild(celda);
              });
            var celdaAccion = document.createElement('td');
            celdaAccion.className = 'valor';
            if (movimiento.estado === 'anulado') {
              celdaAccion.textContent = 'anulado';
            } else {
              var boton = document.createElement('button');
              boton.textContent = 'Anular';
              boton.style.margin = '0';
              boton.style.width = 'auto';
              boton.style.padding = '4px 10px';
              boton.style.fontSize = '13px';
              boton.addEventListener('click', function () {
                var motivo = prompt('Motivo de la anulacion:');
                if (!motivo) { return; }
                boton.disabled = true;
                google.script.run.withSuccessHandler(function (resultado) {
                  mostrarAviso('avisoAnulacion', resultado.mensaje, !resultado.ok);
                  cargarTodo();
                }).apiAnularTransaccion(token, movimiento.id, motivo);
              });
              celdaAccion.appendChild(boton);
            }
            fila.appendChild(celdaAccion);
            cuerpo.appendChild(fila);
          });
        }).apiListarTransaccionesRecientes(token);
      }

      function cargarTodo() {
        google.script.run.withSuccessHandler(function (estado) {
          document.getElementById('cargando').hidden = true;
          if (!estado.autenticado || estado.rol !== 'admin') {
            document.getElementById('sinPermiso').hidden = false;
            return;
          }
          document.getElementById('panel').hidden = false;
          document.getElementById('quien').textContent = 'Conectado como ' + estado.nombre;
          pintarProductos(estado.productos);
          google.script.run.withSuccessHandler(function (respuesta) {
            var select = document.getElementById('usuarioDestino');
            select.innerHTML = '';
            respuesta.usuarios.forEach(function (usuario) {
              var opcion = document.createElement('option');
              opcion.value = usuario.id;
              opcion.textContent = usuario.nombre;
              select.appendChild(opcion);
            });
          }).apiListarUsuarios(token);
          cargarMovimientos();
        }).apiObtenerEstado(token);
      }

      document.getElementById('btnCrearProducto').addEventListener('click', function () {
        var boton = this;
        boton.disabled = true;
        google.script.run.withSuccessHandler(function (respuesta) {
          boton.disabled = false;
          mostrarAviso('avisoProducto', respuesta.mensaje, !respuesta.ok);
          if (respuesta.ok) {
            pintarProductos(respuesta.productos);
            ['nombre', 'categoria', 'costo', 'precioVenta'].forEach(function (id) {
              document.getElementById(id).value = '';
            });
            document.getElementById('stockInicial').value = '0';
          }
        }).apiCrearProducto(token, {
          nombre: document.getElementById('nombre').value,
          categoria: document.getElementById('categoria').value,
          costo: Number(document.getElementById('costo').value),
          precioVenta: Number(document.getElementById('precioVenta').value),
          stockActual: Number(document.getElementById('stockInicial').value)
        });
      });

      document.getElementById('btnAjustarStock').addEventListener('click', function () {
        var boton = this;
        boton.disabled = true;
        google.script.run.withSuccessHandler(function (respuesta) {
          boton.disabled = false;
          mostrarAviso('avisoStock', respuesta.mensaje, !respuesta.ok);
          if (respuesta.ok) { pintarProductos(respuesta.productos); }
        }).apiActualizarProducto(
          token,
          document.getElementById('productoAjuste').value,
          { stockActual: Number(document.getElementById('stockNuevo').value) }
        );
      });

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

      cargarTodo();
    </script>
  </body>
</html>
```

Nota: `apiActualizarProducto` solo aplica los campos que vengan con valor, por eso mandar `{ stockActual }` no borra el resto del producto. La comparación es estricta (`!== ''`), así que un `stockActual` de `0` sí se aplica — dejar un producto en cero funciona.

- [ ] **Step 2: Verificar que las pruebas siguen pasando**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/web/admin.html
git commit -m "feat: vista de administracion de productos y movimientos"
```

---

### Task 10: Despliegue y verificación end-to-end

**Files:**
- Create: `.clasp.json` (generado por clasp)
- Create: `README.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: una web app desplegada y funcionando.

- [ ] **Step 1: Autenticar clasp**

```bash
npx clasp login
```

Se abre el navegador — iniciar sesión con la cuenta de Google del admin y autorizar.

- [ ] **Step 2: Crear la hoja de cálculo y el proyecto de Apps Script**

1. Crear una hoja de cálculo nueva en Google Drive llamada `Tienda Sistemas - Datos`.
2. Copiar su ID de la URL (`https://docs.google.com/spreadsheets/d/<ID>/edit`).
3. Crear el proyecto de script:

```bash
npx clasp create --type standalone --title "Tienda Sistemas" --rootDir ./src
```

Esto genera `.clasp.json`. Si clasp lo crea con `rootDir` incorrecto, editarlo para que quede `"rootDir": "src"`.

- [ ] **Step 3: Subir el código**

```bash
npm run push
```

Expected: lista los archivos subidos, incluyendo `appsscript.json`, los `.js` de `dominio/`, `datos/`, `app/` y los `.html` de `web/`.

- [ ] **Step 4: Configurar la propiedad del libro**

En el editor de Apps Script (`npx clasp open`): Configuración del proyecto → Propiedades del script → agregar `ID_LIBRO` con el ID de la hoja del paso 2.

- [ ] **Step 5: Inicializar el libro y el usuario admin**

En el editor de Apps Script, seleccionar la función `configurarInicial` y ejecutarla. Autorizar los permisos cuando lo pida.

Expected: el registro de ejecución imprime `Libro inicializado y admin creado para <tu correo>`, y la hoja de cálculo queda con las pestañas `Usuarios`, `Productos` y `Transacciones` con sus encabezados, y una fila de usuario admin.

- [ ] **Step 6: Desplegar la web app**

En el editor: Implementar → Nueva implementación → tipo "Aplicación web", ejecutar como "Yo", acceso "Cualquier usuario con cuenta de Google". Copiar la URL.

- [ ] **Step 7: Verificar el flujo del administrador**

Abrir `<URL>?vista=admin` y comprobar, en orden:

1. Aparece el panel con "Conectado como Administrador" (esto confirma que el login corporativo automático funciona).
2. Crear un producto: nombre `Cafe`, categoria `Bebidas`, costo `800`, precio de venta `1500`, stock `10`. Debe decir "Producto creado".
3. Verificar en la hoja `Productos` que quedó la fila con esos valores.

- [ ] **Step 8: Verificar el flujo del comprador**

Abrir la URL sin parámetros (`<URL>`) y comprobar:

1. Aparece "Hola, Administrador" con saldo `$0`.
2. Registrar 2 unidades de `Cafe`. Debe aparecer "Registrado: 2 x Cafe".
3. El saldo pasa a `$3.000` y el desglose muestra la línea.
4. En la hoja `Productos`, el stock de `Cafe` bajó a `8`.
5. En la hoja `Transacciones` quedó la fila con `origen = autoregistro` y `estado = pendiente`.

- [ ] **Step 9: Verificar la anulación**

Volver a `<URL>?vista=admin`, anular el movimiento del paso anterior con motivo "prueba".

Expected: mensaje "Movimiento anulado y stock devuelto", el stock de `Cafe` vuelve a `10`, la transacción queda con `estado = anulado` y el saldo del comprador vuelve a `$0`.

- [ ] **Step 10: Verificar el login de un usuario sin correo corporativo**

1. En la hoja `Usuarios`, agregar una fila manual: `id` = `u-prueba`, `nombre` = `Prueba`, `area` = `Sistemas`, `rol` = `comprador`, `tipoLogin` = `usuario_clave`, `emailCorporativo` vacío, `usuario` = `prueba`, `salt` = `sal123`, `esPseudoUsuario` = `FALSE`, `activo` = `TRUE`.
2. Para generar el `claveHash`, ejecutar en el editor de Apps Script una función temporal:

```javascript
function generarHashDePrueba() {
  Logger.log(hashClave('clave123', 'sal123', hashConUtilities));
}
```

3. Copiar el valor del log a la columna `claveHash`.
4. Abrir la URL desde una ventana de incógnito con una cuenta de Google que **no** sea del dominio, iniciar sesión con `prueba` / `clave123` y verificar que entra y ve su saldo en `$0`.
5. Borrar la función temporal `generarHashDePrueba` y volver a hacer `npm run push`.

Si el paso 4 no se puede probar por falta de una cuenta externa, documentarlo como pendiente de verificación en el README en vez de darlo por bueno.

- [ ] **Step 11: Escribir el README**

Crear `README.md` con este contenido exacto (los bloques de comandos van con triple backtick y la etiqueta `bash`):

    # Tienda Sistemas

    Sistema de la tienda interna del area de sistemas: inventario, fiado con
    auto-registro del comprador y consulta de saldo.

    ## Estructura

    - `src/dominio/` — logica de negocio pura, probada con `npm test`
    - `src/datos/` — acceso a Google Sheets
    - `src/app/` — API del servidor y router de vistas
    - `src/web/` — interfaz HTML
    - `test/` — pruebas automatizadas
    - `docs/superpowers/` — spec y planes

    ## Desarrollo

    ```bash
    npm install      # instalar dependencias
    npm test         # correr las pruebas
    npm run push     # subir el codigo a Apps Script
    ```

    ## Configuracion

    El script necesita la propiedad de script `ID_LIBRO` con el ID de la hoja de
    calculo de datos. La funcion `configurarInicial()` crea las hojas y el usuario
    administrador la primera vez.

    ## URLs

    - Vista del comprador: `<URL de la web app>`
    - Vista del administrador: `<URL de la web app>?vista=admin`

- [ ] **Step 12: Commit final**

```bash
git add .clasp.json README.md
git commit -m "docs: configuracion de despliegue y README del proyecto"
```

---

## Limitaciones conocidas de la Fase 1

Documentadas a propósito, se resuelven en fases posteriores o quedan aceptadas:

1. **No hay pagos**: el saldo solo crece. Registrar abonos y marcar transacciones como pagadas es Fase 2.
2. **No hay forma de desactivar un producto desde la interfaz**: `apiActualizarProducto` acepta el campo `activo`, pero la vista de admin no expone el control. Mientras tanto se desactiva editando la columna `activo` en la hoja.
3. **Hash de claves con SHA-256 + salt**: Apps Script no ofrece bcrypt/scrypt. Es adecuado para una tienda interna con pocos usuarios y sin datos sensibles, pero no es un esquema de contraseñas de grado bancario.
4. **Alta de usuarios a mano**: los compradores se agregan editando la hoja `Usuarios` directamente. Una pantalla de gestión de usuarios queda para Fase 2.
5. **El comprador no puede corregir su propio registro**: debe pedirle al admin que lo anule. Es intencional.
