# Fase 3 — Lectura de facturas con IA (diseño)

## 1. Contexto y alcance

Implementa la sección 4.2 del spec original
(`docs/superpowers/specs/2026-09-12-tienda-sistema-design.md`): el admin sube o
toma una foto de la factura del proveedor desde el panel, el sistema le pide a
Gemini API que extraiga las líneas (producto, cantidad, costo unitario), las
muestra en un resumen editable, y solo al confirmar se actualiza el
inventario. Nunca se toca el stock directo desde la foto sin revisión humana.

Es la última pieza del spec original. Fase 1 (inventario + fiado) y Fase 2
(préstamos, pagos, pérdidas, gastos compartidos, reportes, login corporativo)
ya están en producción.

## 2. Modelo de datos

Nueva hoja al final de `ESQUEMA`, mismo patrón de anulación que las entidades
de Fase 2:

```
IngresosInventario: [
  'id', 'fecha', 'admin', 'lineas', 'estado',
  'anuladoPor', 'anuladoFecha', 'anuladoMotivo'
]
```

Una fila por factura confirmada, no por línea. `lineas` guarda el detalle
serializado como JSON en una sola celda (una celda de Sheets no almacena
arreglos ni objetos):

```json
[{"productoId": "p1", "productoNombre": "Cafe", "cantidad": 20, "costoUnitario": 800, "esNuevo": false}]
```

Anular un ingreso (`apiAnularIngresoInventario`) revierte el `stockActual` de
cada producto en `lineas` por su `cantidad`, igual que `apiAnularPerdida`. No
revierte el `costo` del producto aunque el ingreso lo haya cambiado — hacerlo
exigiría guardar el costo anterior por línea, y no es el caso real que hay que
resolver: si un ingreso se anula por error de digitación, el admin corrige el
costo a mano si hace falta.

## 3. Integración con Gemini API

- **Modelo:** `gemini-2.0-flash` (nivel gratuito, soporta visión).
- **Transporte:** `UrlFetchApp.fetch` desde Apps Script, imagen en base64
  (`Utilities.base64Encode`) como `inline_data` en el body del request a
  `generativelanguage.googleapis.com`.
- **API key:** Script Property `GEMINI_API_KEY`, mismo patrón que `ID_LIBRO` —
  se configura una vez desde el editor de Apps Script. La obtiene Andrés desde
  Google AI Studio (nivel gratuito).
- **Prompt:** pide explícitamente que la respuesta sea **solo JSON**, sin
  texto alrededor, con esta forma:
  ```json
  {"lineas": [{"nombre": "Cafe", "cantidad": 20, "costoUnitario": 800}]}
  ```
- **Parseo defensivo:** Gemini a veces envuelve el JSON en
  ` ```json ... ``` `; el código quita ese envoltorio (recorte de las marcas
  de código) antes de `JSON.parse`. Si el parseo falla, si la respuesta no
  trae `lineas`, o si `lineas` no es un arreglo, se trata como fallo de
  lectura (ver sección 5).

## 4. Flujo completo

1. Admin abre la tarjeta "Ingresar factura" en el panel y elige o toma la
   foto con `<input type="file" accept="image/*" capture="environment">`. El
   cliente valida el tamaño (máx. ~4MB) antes de continuar.
2. Clic en "Leer factura" → `apiLeerFactura(token, imagenBase64)`:
   - Llama a Gemini y parsea la respuesta (sección 3).
   - Sanea cada línea cruda: nombre no vacío, `cantidad` y `costoUnitario`
     enteros positivos. Una línea que no pasa esta validación se descarta en
     silencio, no se le muestra basura al admin.
   - Empareja cada línea saneada contra los productos `activo === true`: el
     nombre leído, normalizado (sin tildes, minúsculas, espacios recortados),
     se compara contra `nombre` y `alias` normalizados de cada producto. Si
     hay coincidencia exacta con cualquiera de los dos, la línea lleva
     `productoId` y `esNuevo: false`; si no, `esNuevo: true`.
   - Devuelve `{ ok, mensaje, lineas }`. Si Gemini falló o no dejó líneas
     útiles, `lineas` viene vacío y `mensaje` explica que no se pudo leer la
     factura.
3. El panel pinta una tabla editable con lo que llegó (vacía si el paso 2
   falló): nombre, cantidad, costo — todo editable — más categoría y precio
   de venta cuando `esNuevo` (con el mismo ayudante de % de aumento que ya
   existe en "Nuevo producto"). Botones "+ agregar línea" y "quitar" por fila,
   para corregir de la mano lo que Gemini leyó mal o para cargar la factura
   completa a mano si Gemini no leyó nada.
4. Admin ajusta lo necesario y da "Confirmar ingreso" →
   `apiConfirmarIngresoInventario(token, lineas)`.
5. Bajo `LockService` (toca stock, como `apiRegistrarPerdida`):
   validación todo-o-nada (sección 5), luego por cada línea: crea el producto
   si `esNuevo`, suma `cantidad` a `stockActual` y reemplaza `costo` por
   `costoUnitario` en el producto (nuevo o existente), y arma la fila de
   `IngresosInventario` con el detalle de todas las líneas.

## 5. Errores y casos borde

- **Gemini no responde, da error HTTP, o no deja líneas útiles tras el
  saneo:** `apiLeerFactura` devuelve `ok: false` con un mensaje claro; el
  resumen editable arranca vacío y el admin carga las líneas a mano con
  "+ agregar línea" — el mismo formulario sirve de respaldo manual sin
  pantallas separadas.
- **Confirmar con datos incompletos:** si alguna línea `esNuevo` no tiene
  categoría o precio de venta, o cualquier línea tiene cantidad o costo
  inválido, `apiConfirmarIngresoInventario` rechaza el ingreso completo (nada
  parcial) señalando cuál línea falló — mismo principio todo-o-nada que
  `crearGastoCompartido`.
- **Nombre coincide con un producto inactivo:** el emparejamiento solo
  considera productos activos, igual criterio que el resto del sistema; un
  producto desactivado se trata como inexistente y la línea sale `esNuevo`.
- **Foto demasiado pesada:** se valida en el cliente antes de llamar a
  `apiLeerFactura`, para no gastar la cuota de Gemini en una subida que va a
  fallar de todos modos.

## 6. Arquitectura técnica

Se mantiene la separación de Fase 1/2: lógica pura y testeable en
`src/dominio/` (sin dependencias de Apps Script, probada con `node --test`),
I/O aislado en `src/datos/` y `src/app/api.js` como única capa que toca ambos
mundos.

- **`src/dominio/facturas.js`** (nuevo, puro): saneo de líneas crudas,
  emparejamiento por nombre/alias normalizado, armado del registro
  `IngresoInventario`, y la validación todo-o-nada de la confirmación. Esto es
  lo que cubren las pruebas.
- **Llamada a Gemini** (`UrlFetchApp`) y el I/O de Sheets no se prueban
  localmente — mismo patrón que el resto del proyecto: la verificación es
  manual en producción, como ya se hizo para Fase 2.
- Reusa sin cambios: `crearProducto` y `descontarStock`/incremento de stock de
  `src/dominio/productos.js`, `anularRegistro` de `src/dominio/anulacion.js`.

## 7. Fuera de alcance

- Revertir el `costo` del producto al anular un ingreso (sección 2).
- Emparejamiento aproximado/fuzzy — si el nombre no empata exacto (ni por
  alias), el admin corrige el texto a mano en el resumen, como ya describe el
  spec original.
- Historial de precios de un producto a través del tiempo — el ingreso queda
  trazado en `IngresosInventario`, pero no hay un reporte de evolución de
  costo por producto.
