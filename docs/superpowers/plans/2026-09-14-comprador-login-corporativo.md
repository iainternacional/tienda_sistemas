# Login de comprador con correo corporativo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El admin crea un comprador dando su nombre, área y correo corporativo (@ipuc.org.co); el comprador entra a "Mi cuenta" con esa cuenta de Google sin usuario ni clave.

**Architecture:** El backend ya resuelve la sesión por `Session.getActiveUser().getEmail()` antes de mirar el token de usuario/clave (`usuarioDeSesion` en `src/app/api.js:20`), y ya existe el tipo de usuario `tipoLogin: 'google_corporativo'` que se busca por `emailCorporativo` (`resolverUsuarioPorEmail` en `src/dominio/auth.js:20`) — así funciona hoy el admin. Este plan añade el mismo camino para compradores: nuevas funciones de dominio (`validarUsuarioCorporativoNuevo`, `crearUsuarioCorporativo`, `buscarUsuarioPorEmailCorporativo`), un endpoint (`apiCrearUsuarioCorporativo`) y un formulario reemplazado en el panel admin. El flujo de usuario/clave (`crearUsuarioComprador`, `apiCrearUsuarioComprador`) **se deja intacto** en el dominio y el API — solo se retira del formulario del admin, que pasa a usar el nuevo endpoint.

**Tech Stack:** Google Apps Script (JavaScript ES5-ish), Google Sheets como base de datos, `node --test` para las pruebas de dominio (sin mocks de Apps Script — el dominio es JS puro).

**Spec:** No hay spec formal para este cambio; es una iteración post-despliegue de Fase 2 sobre `docs/superpowers/specs/2026-09-12-tienda-sistema-design.md`. Contexto de decisiones en memoria del proyecto (`tienda-decisiones.md`, `tienda-urls.md`).

## Global Constraints

- Todo el código, identificadores y mensajes de usuario van en español, sin tildes en identificadores (sigue el estilo ya usado en `src/dominio/auth.js`).
- No modificar `ESQUEMA.Usuarios` (`src/datos/esquema.js:2-5`) — ya tiene las columnas `emailCorporativo`, `usuario`, `salt`, `claveHash` necesarias para ambos tipos de login.
- No romper `crearUsuarioComprador` ni `apiCrearUsuarioComprador` (login usuario/clave) — sus pruebas existentes en `test/dominio/auth.test.js` deben seguir pasando sin cambios.
- Los mensajes de validación siguen el patrón `{ valido: boolean, errores: string[] }` ya usado por `validarUsuarioNuevo`.

---

### Task 1: Dominio — validar y crear usuario corporativo

**Files:**
- Modify: `src/dominio/auth.js` (agregar funciones al final, antes del bloque `module.exports`)
- Test: `test/dominio/auth.test.js` (agregar tests al final del archivo)

**Interfaces:**
- Consumes: `textoComparable(valor)` (ya definida en `src/dominio/auth.js:16`, normaliza a string recortado en minúsculas).
- Produces:
  - `validarUsuarioCorporativoNuevo(datos)` → `{ valido: boolean, errores: string[] }`. `datos` es `{ nombre, area, email }`.
  - `crearUsuarioCorporativo(datos)` → objeto usuario `{ id, nombre, area, rol: 'comprador', tipoLogin: 'google_corporativo', emailCorporativo, usuario: '', salt: '', claveHash: '', esPseudoUsuario: false, activo: true }`. Lanza `Error` si la validación falla, con el mensaje de errores unido por `'. '`.
  - `buscarUsuarioPorEmailCorporativo(usuarios, email)` → el usuario cuyo `emailCorporativo` coincide (ignorando mayúsculas/espacios), **incluso si está inactivo** (para no permitir recrear un login ya usado), o `null` si no existe o `email` viene vacío.

Estas tres funciones las usará el Task 2 (`apiCrearUsuarioCorporativo` en `src/app/api.js`), que debe recibir exactamente esos nombres y esa forma de retorno.

- [ ] **Step 1: Escribir las pruebas que fallan**

Abre `test/dominio/auth.test.js`. Al final del archivo (después de la línea 179, el último test existente), agrega:

```javascript
const DATOS_CORPORATIVOS_VALIDOS = {
  id: 'u10', nombre: 'Laura Gomez', area: 'Compras', email: 'laura.gomez@ipuc.org.co'
};

test('validarUsuarioCorporativoNuevo acepta datos completos', () => {
  assert.strictEqual(validarUsuarioCorporativoNuevo(DATOS_CORPORATIVOS_VALIDOS).valido, true);
});

test('validarUsuarioCorporativoNuevo exige el nombre', () => {
  const resultado = validarUsuarioCorporativoNuevo(Object.assign({}, DATOS_CORPORATIVOS_VALIDOS, { nombre: '   ' }));
  assert.strictEqual(resultado.valido, false);
  assert.match(resultado.errores.join('. '), /nombre/i);
});

test('validarUsuarioCorporativoNuevo exige el correo', () => {
  const resultado = validarUsuarioCorporativoNuevo(Object.assign({}, DATOS_CORPORATIVOS_VALIDOS, { email: '' }));
  assert.strictEqual(resultado.valido, false);
  assert.match(resultado.errores.join('. '), /correo/i);
});

test('validarUsuarioCorporativoNuevo rechaza un correo sin formato valido', () => {
  const resultado = validarUsuarioCorporativoNuevo(Object.assign({}, DATOS_CORPORATIVOS_VALIDOS, { email: 'laura.gomez' }));
  assert.strictEqual(resultado.valido, false);
  assert.match(resultado.errores.join('. '), /correo/i);
});

test('crearUsuarioCorporativo arma un comprador con login de google corporativo', () => {
  const creado = crearUsuarioCorporativo(DATOS_CORPORATIVOS_VALIDOS);
  assert.strictEqual(creado.id, 'u10');
  assert.strictEqual(creado.nombre, 'Laura Gomez');
  assert.strictEqual(creado.area, 'Compras');
  assert.strictEqual(creado.rol, 'comprador');
  assert.strictEqual(creado.tipoLogin, 'google_corporativo');
  assert.strictEqual(creado.emailCorporativo, 'laura.gomez@ipuc.org.co');
  assert.strictEqual(creado.usuario, '');
  assert.strictEqual(creado.claveHash, '');
  assert.strictEqual(creado.esPseudoUsuario, false);
  assert.strictEqual(creado.activo, true);
});

test('crearUsuarioCorporativo normaliza el correo y recorta el nombre', () => {
  const creado = crearUsuarioCorporativo(
    Object.assign({}, DATOS_CORPORATIVOS_VALIDOS, { email: '  LAURA.GOMEZ@ipuc.org.co ', nombre: '  Laura Gomez  ' })
  );
  assert.strictEqual(creado.emailCorporativo, 'laura.gomez@ipuc.org.co');
  assert.strictEqual(creado.nombre, 'Laura Gomez');
});

test('crearUsuarioCorporativo falla si los datos no son validos', () => {
  assert.throws(
    () => crearUsuarioCorporativo(Object.assign({}, DATOS_CORPORATIVOS_VALIDOS, { email: 'no-es-correo' })),
    /correo/i
  );
});

test('el comprador corporativo recien creado puede iniciar sesion por su correo', () => {
  const creado = crearUsuarioCorporativo(DATOS_CORPORATIVOS_VALIDOS);
  const padron = USUARIOS.concat([creado]);
  assert.strictEqual(resolverUsuarioPorEmail(padron, 'laura.gomez@ipuc.org.co').id, 'u10');
});

test('buscarUsuarioPorEmailCorporativo encuentra ignorando mayusculas y espacios', () => {
  const conCorporativo = USUARIOS.concat([
    { id: 'u11', nombre: 'Laura', usuario: '', emailCorporativo: 'laura@ipuc.org.co', esPseudoUsuario: false, activo: true }
  ]);
  assert.strictEqual(buscarUsuarioPorEmailCorporativo(conCorporativo, '  LAURA@ipuc.org.co ').id, 'u11');
});

test('buscarUsuarioPorEmailCorporativo tambien encuentra inactivos para no reciclar logins', () => {
  const conInactivo = USUARIOS.concat([
    { id: 'u12', nombre: 'Ana', usuario: '', emailCorporativo: 'ana@ipuc.org.co', esPseudoUsuario: false, activo: false }
  ]);
  assert.strictEqual(buscarUsuarioPorEmailCorporativo(conInactivo, 'ana@ipuc.org.co').id, 'u12');
});

test('buscarUsuarioPorEmailCorporativo devuelve null si no existe o viene vacio', () => {
  assert.strictEqual(buscarUsuarioPorEmailCorporativo(USUARIOS, 'nadie@ipuc.org.co'), null);
  assert.strictEqual(buscarUsuarioPorEmailCorporativo(USUARIOS, ''), null);
});
```

Y actualiza el `require` del inicio del archivo (línea 4-7) para incluir las tres funciones nuevas:

```javascript
const {
  hashClave, verificarClave, resolverUsuarioPorEmail, resolverUsuarioPorClave, esAdmin,
  validarUsuarioNuevo, crearUsuarioComprador, buscarUsuarioPorNombreDeUsuario,
  validarUsuarioCorporativoNuevo, crearUsuarioCorporativo, buscarUsuarioPorEmailCorporativo
} = require('../../src/dominio/auth.js');
```

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `npm test`
Expected: FAIL — `validarUsuarioCorporativoNuevo is not a function` (o similar, porque `require` desestructura `undefined`).

- [ ] **Step 3: Implementar las funciones**

En `src/dominio/auth.js`, agrega esto **antes** del bloque `if (typeof module !== 'undefined') { ... }` (que hoy empieza en la línea 108):

```javascript
function validarUsuarioCorporativoNuevo(datos) {
  const errores = [];
  const email = textoComparable(datos.email);
  if (textoComparable(datos.nombre) === '') {
    errores.push('El nombre es obligatorio');
  }
  if (email === '') {
    errores.push('El correo es obligatorio');
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errores.push('El correo no tiene un formato valido');
  }
  return { valido: errores.length === 0, errores: errores };
}

function crearUsuarioCorporativo(datos) {
  const validacion = validarUsuarioCorporativoNuevo(datos);
  if (!validacion.valido) {
    throw new Error(validacion.errores.join('. '));
  }
  return {
    id: datos.id,
    nombre: String(datos.nombre).trim(),
    area: String(datos.area === undefined || datos.area === null ? '' : datos.area).trim(),
    rol: 'comprador',
    tipoLogin: 'google_corporativo',
    emailCorporativo: textoComparable(datos.email),
    usuario: '',
    salt: '',
    claveHash: '',
    esPseudoUsuario: false,
    activo: true
  };
}

function buscarUsuarioPorEmailCorporativo(usuarios, email) {
  const buscado = textoComparable(email);
  if (buscado === '') {
    return null;
  }
  for (let i = 0; i < usuarios.length; i++) {
    if (textoComparable(usuarios[i].emailCorporativo) === buscado) {
      return usuarios[i];
    }
  }
  return null;
}
```

Y actualiza el `module.exports` (línea 108-119 actual) para incluir las tres funciones nuevas:

```javascript
if (typeof module !== 'undefined') {
  module.exports = {
    hashClave,
    verificarClave,
    resolverUsuarioPorEmail,
    resolverUsuarioPorClave,
    esAdmin,
    buscarUsuarioPorNombreDeUsuario,
    validarUsuarioNuevo,
    crearUsuarioComprador,
    validarUsuarioCorporativoNuevo,
    crearUsuarioCorporativo,
    buscarUsuarioPorEmailCorporativo
  };
}
```

- [ ] **Step 4: Correr las pruebas y verificar que pasan**

Run: `npm test`
Expected: PASS — todas las pruebas de `test/dominio/auth.test.js`, incluidas las 84 (aprox.) del proyecto completo.

- [ ] **Step 5: Commit**

```bash
git add src/dominio/auth.js test/dominio/auth.test.js
git commit -m "feat: agregar creacion de comprador con login corporativo en el dominio

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: API — endpoint para crear el comprador corporativo

**Files:**
- Modify: `src/app/api.js` (agregar función nueva junto a `apiCrearUsuarioComprador`, alrededor de la línea 256)

**Interfaces:**
- Consumes: `exigirAdmin(token)` (`src/app/api.js:44`, lanza si no hay sesión admin, devuelve el usuario admin), `obtenerLibro()` y `leerTodo(libro, hoja)` / `agregarFila(libro, hoja, fila)` (definidas en `src/datos/*.js`, ya usadas por `apiCrearUsuarioComprador`), `nuevoId()` (genera id de fila), `usuariosVisibles()` (`src/app/api.js:215`), y las tres funciones del Task 1: `buscarUsuarioPorEmailCorporativo`, `crearUsuarioCorporativo`.
- Produces: `apiCrearUsuarioCorporativo(token, datos)` → `{ ok: boolean, mensaje: string, usuarios: Array<{id, nombre, esPseudoUsuario}> }`. `datos` es `{ nombre, area, email }`. Este es el nombre exacto que el Task 3 debe llamar desde `admin.html`.

Este archivo corre solo dentro de Google Apps Script (usa `CacheService`, `Utilities`, hojas de cálculo) — no tiene pruebas automatizadas en este proyecto (revisa `test/` con `Glob` si tienes dudas: no hay ningún `test/app/*.js`). La verificación de este task es de lectura/lint manual; la verificación funcional real ocurre al final del Task 3, probando en el navegador.

- [ ] **Step 1: Agregar el endpoint**

En `src/app/api.js`, justo después del cierre de `apiCrearUsuarioComprador` (después de la línea 256, antes de `function apiRegistrarFiadoComoAdmin`), agrega:

```javascript
function apiCrearUsuarioCorporativo(token, datos) {
  try {
    exigirAdmin(token);
    const libro = obtenerLibro();
    if (buscarUsuarioPorEmailCorporativo(leerTodo(libro, 'Usuarios'), datos.email)) {
      return { ok: false, mensaje: 'Ya existe un usuario con ese correo', usuarios: [] };
    }
    const nuevo = crearUsuarioCorporativo({
      id: nuevoId(),
      nombre: datos.nombre,
      area: datos.area,
      email: datos.email
    });
    agregarFila(libro, 'Usuarios', nuevo);
    return {
      ok: true,
      mensaje: nuevo.nombre + ' ya puede entrar a "Mi cuenta" con su correo ' + nuevo.emailCorporativo,
      usuarios: usuariosVisibles()
    };
  } catch (error) {
    return { ok: false, mensaje: error.message, usuarios: [] };
  }
}
```

- [ ] **Step 2: Verificar que las pruebas de dominio siguen pasando**

Run: `npm test`
Expected: PASS (este archivo no tiene pruebas propias, pero confirma que no rompiste nada al copiar nombres de función).

- [ ] **Step 3: Commit**

```bash
git add src/app/api.js
git commit -m "feat: agregar endpoint para crear comprador con correo corporativo

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: UI — reemplazar el formulario "Nuevo comprador" en el panel admin

**Files:**
- Modify: `src/web/admin.html` (tarjeta HTML en las líneas 50-63, handler JS en las líneas 316-334)

**Interfaces:**
- Consumes: `apiCrearUsuarioCorporativo(token, datos)` del Task 2, `pintarUsuarios(usuarios)` (ya existe en `admin.html`, pinta los 4 selects de usuario), `mostrarAviso(idContenedor, texto, esError)` (ya existe).
- Produces: nada que consuma otro task — es la última pieza del flujo.

Este archivo no tiene pruebas automatizadas (es HTML servido por Apps Script). La verificación es manual: desplegar y probar en el navegador.

- [ ] **Step 1: Reemplazar el HTML de la tarjeta**

En `src/web/admin.html`, reemplaza las líneas 50-63:

```html
      <div class="tarjeta">
        <h2>Nuevo comprador</h2>
        <p class="sub">Entregue el usuario y la clave a la persona para que entre a "Mi cuenta".</p>
        <label for="nombreComprador">Nombre</label>
        <input id="nombreComprador" type="text">
        <label for="areaComprador">Area</label>
        <input id="areaComprador" type="text">
        <label for="usuarioComprador">Usuario</label>
        <input id="usuarioComprador" type="text" autocomplete="off">
        <label for="claveComprador">Clave</label>
        <input id="claveComprador" type="text" autocomplete="off">
        <button id="btnCrearComprador">Crear comprador</button>
        <div id="avisoComprador"></div>
      </div>
```

por:

```html
      <div class="tarjeta">
        <h2>Nuevo comprador</h2>
        <p class="sub">Debe ser un correo corporativo. La persona entra a "Mi cuenta" con esa cuenta de Google, sin usuario ni clave.</p>
        <label for="nombreComprador">Nombre</label>
        <input id="nombreComprador" type="text">
        <label for="areaComprador">Area</label>
        <input id="areaComprador" type="text">
        <label for="emailComprador">Correo corporativo</label>
        <input id="emailComprador" type="email" autocomplete="off">
        <button id="btnCrearComprador">Crear comprador</button>
        <div id="avisoComprador"></div>
      </div>
```

- [ ] **Step 2: Reemplazar el handler del boton**

En el mismo archivo, reemplaza el bloque de las líneas 316-334:

```javascript
      document.getElementById('btnCrearComprador').addEventListener('click', function () {
        var boton = this;
        boton.disabled = true;
        google.script.run.withSuccessHandler(function (respuesta) {
          boton.disabled = false;
          mostrarAviso('avisoComprador', respuesta.mensaje, !respuesta.ok);
          if (respuesta.ok) {
            pintarUsuarios(respuesta.usuarios);
            ['nombreComprador', 'areaComprador', 'usuarioComprador', 'claveComprador'].forEach(function (id) {
              document.getElementById(id).value = '';
            });
          }
        }).apiCrearUsuarioComprador(token, {
          nombre: document.getElementById('nombreComprador').value,
          area: document.getElementById('areaComprador').value,
          usuario: document.getElementById('usuarioComprador').value,
          clave: document.getElementById('claveComprador').value
        });
      });
```

por:

```javascript
      document.getElementById('btnCrearComprador').addEventListener('click', function () {
        var boton = this;
        boton.disabled = true;
        google.script.run.withSuccessHandler(function (respuesta) {
          boton.disabled = false;
          mostrarAviso('avisoComprador', respuesta.mensaje, !respuesta.ok);
          if (respuesta.ok) {
            pintarUsuarios(respuesta.usuarios);
            ['nombreComprador', 'areaComprador', 'emailComprador'].forEach(function (id) {
              document.getElementById(id).value = '';
            });
          }
        }).apiCrearUsuarioCorporativo(token, {
          nombre: document.getElementById('nombreComprador').value,
          area: document.getElementById('areaComprador').value,
          email: document.getElementById('emailComprador').value
        });
      });
```

- [ ] **Step 3: Commit**

```bash
git add src/web/admin.html
git commit -m "feat: crear compradores con correo corporativo desde el panel admin

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Desplegar y verificar manualmente**

```bash
npm run push
```

Luego, en el editor de Apps Script: **Implementar → Administrar implementaciones → editar (lápiz) → Versión: Nueva versión → Implementar**. Esto conserva el mismo URL de `/exec` (ver `tienda-urls.md` en memoria del proyecto — no crear una implementación nueva, o el link cambia).

Verificación manual:
1. Abre `<url>/exec?vista=admin`, confirma que la tarjeta "Nuevo comprador" ahora pide "Correo corporativo" en vez de usuario/clave.
2. Crea un comprador de prueba con tu propio correo `@ipuc.org.co` (o el de otra persona de la organización que puedas usar para probar).
3. Abre `<url>/exec` (sin `?vista=admin`) en una ventana de incógnito, iniciando sesión de Google con esa cuenta de prueba.
4. Confirma que entra directo a "Mi cuenta" sin ver el formulario de usuario/clave — porque `Session.getActiveUser()` ya resuelve el email y `usuarioDeSesion` lo encuentra por `emailCorporativo`.
5. Intenta crear otro comprador con el mismo correo — confirma que el mensaje de error es "Ya existe un usuario con ese correo".

---

## Notas para quien retome esto

- El flujo usuario/clave (`crearUsuarioComprador`, `apiCrearUsuarioComprador`, tests en `test/dominio/auth.test.js:86-163`) sigue existiendo en el código pero **ya no se usa desde ningún formulario** tras este plan. Si en el futuro se decide eliminarlo del todo, es una decisión aparte — no la tomes por tu cuenta.
- La validación de correo no exige el dominio `@ipuc.org.co` específicamente, solo formato de email genérico — sigue el mismo nivel de validación que el resto del dominio (`validarUsuarioNuevo` tampoco es más estricto de lo necesario). Si aparecen compradores con correo mal escrito que nunca pueden entrar, considera agregar esa restricción entonces, no antes.
