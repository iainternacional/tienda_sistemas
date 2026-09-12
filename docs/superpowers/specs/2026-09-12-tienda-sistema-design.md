# Sistema de Tienda Interna — Diseño

Fecha: 2026-09-12
Autor: Andrés Puerta (área de sistemas), diseñado junto con Claude

## 1. Contexto y alcance

Tienda interna del área de sistemas, administrada por una sola persona (admin). Los
compradores son empleados de la organización; algunos tienen correo corporativo
(dominio de Google Workspace) y otros no. Hoy el proceso se maneja con Google Forms
para registrar inventario y compras, y Google Apps Script para mostrarle a cada
comprador cuánto debe.

Escala: pequeña — menos de 50 compradores, menos de 100 productos, volumen de
transacciones bajo.

Dos procesos manuales son especialmente lentos hoy y son un objetivo explícito de
automatización de este proyecto:

1. **Fiado en papel**: el comprador saca el producto y anota en una hoja de papel
   qué se llevó; el admin luego revisa esas anotaciones, papel por papel, y las
   digita manualmente en la cuenta de cada persona.
2. **Inventario manual**: cuando llega mercancía nueva, el admin digita a mano
   cada producto de la factura del proveedor.

Objetivo del sistema nuevo: reemplazar Forms + Apps Script suelto por una web app
propia (Apps Script Web App) que cubra inventario, fiado, préstamos en efectivo,
pérdidas, gastos compartidos, pagos, y una vista de autoservicio para cada
comprador — eliminando los dos cuellos de botella manuales anteriores, y
manteniendo el costo en cero (o casi cero) aprovechando Google Workspace para el
login corporativo.

Fuera de alcance (por ahora): apps nativas móviles, soporte para clientes externos
a la organización, múltiples tiendas/sedes.

## 2. Modelo de datos

Cada entidad vive en su propia hoja de Google Sheets.

### Usuario
- `id`, `nombre`, `area`
- `tipo_login`: `google_corporativo` | `usuario_clave`
- `email_corporativo` (si aplica) o `usuario` + `clave_hash` (si aplica)
- `es_pseudo_usuario` (bool) — para casos especiales de agregación de reportes
  (ej. "Pérdidas"), que no inician sesión ni tienen saldo propio.
- `activo` (bool)

### Producto
- `id`, `nombre`, `categoria`
- `costo` (precio de compra), `precio_venta`
- `stock_actual`
- `activo`

### Transaccion (compra/fiado)
- `id`, `usuario_id`, `producto_id`, `cantidad`, `valor_unitario`, `valor_total`
- `fecha`
- `origen`: `autoregistro` (el propio comprador la creó) | `admin` (la registró el
  administrador)
- `estado`: `pendiente` | `pagado` | `anulado`
- `anulado_por`, `anulado_fecha`, `anulado_motivo` (si aplica)

### Prestamo (efectivo)
- `id`, `usuario_id`, `valor`, `fecha`
- `estado`: `pendiente` | `pagado` | `anulado`
- `anulado_por`, `anulado_fecha`, `anulado_motivo` (si aplica)

### Pago (abono)
- `id`, `usuario_id`, `valor`, `fecha`
- `aplicado_a`: lista de ids de Transaccion/Prestamo/GastoCompartido que cubre
  (o abono general al saldo si no se especifica)

### Perdida
- `id`, `producto_id`, `cantidad`, `motivo`, `valor`, `fecha`
- Afecta el inventario (descuenta stock) y el reporte de pérdidas.
- No genera deuda para ningún usuario.
- `anulado`, `anulado_por`, `anulado_fecha` (para corregir errores de registro)

### GastoCompartido
- `id`, `motivo` (`bienvenida` | `cumpleanos` | `otro`), `valor_total`
- `participantes`: lista de `usuario_id` elegidos manualmente por el admin
  (para cumpleaños, el cumpleañero simplemente no se incluye en la lista)
- `fecha`
- Al guardarse, el sistema genera automáticamente una cuota individual
  (`valor_total / cantidad_participantes`) por cada participante, visible en su
  saldo pendiente.
- `anulado`, `anulado_por`, `anulado_fecha` (anula también las cuotas generadas)

**Principio general de corrección**: ningún registro se borra físicamente desde la
interfaz. Todo movimiento (Transaccion, Prestamo, Perdida, GastoCompartido) se
anula marcándolo como `anulado` con quién y cuándo lo anuló, y dejando el registro
original visible para auditoría. Esto reemplaza el borrado manual que hoy hace el
admin cuando asocia un producto al usuario equivocado.

## 3. Roles y acceso

### Admin (una sola persona)
- CRUD de inventario (productos, stock).
- Registrar compras/fiado, préstamos en efectivo, pérdidas, gastos compartidos,
  pagos/abonos.
- Anular cualquier movimiento con motivo.
- Ver reportes globales (ganancias, pérdidas, cartera pendiente).

### Comprador
- **Auto-registro de fiado**: al sacar un producto de la tienda, elige el
  producto y la cantidad directamente en la app — queda anotado de inmediato en
  su cuenta (`Transaccion` con `origen = autoregistro`), sin que el admin tenga
  que digitarlo. La app solo permite elegir productos con stock disponible.
- Lectura de su propia información:
  - Saldo total pendiente.
  - Desglose de qué le compone ese saldo (por producto, préstamo, o gasto
    compartido).
  - Historial de pagos realizados.

### Autenticación
- **Corporativo**: Google Sign-In restringido al dominio de la organización —
  automático vía `Session.getActiveUser()` en Apps Script, sin contraseñas que
  administrar.
- **No corporativo**: usuario/clave asignado por el admin (clave almacenada con
  hash). Se eligió esta opción porque no depende de que la persona tenga cuenta de
  Google, y el admin ya está acostumbrado a dar de alta manualmente a este tipo de
  usuarios.

## 4. Automatización de procesos manuales

### 4.1 Auto-registro de fiado (reemplaza el papel)

El comprador, desde su celular o cualquier navegador, entra a su vista de "Mi
cuenta" y ahí mismo registra lo que se lleva: elige el producto y la cantidad de
una lista (con el stock disponible visible), y confirma. Eso crea la
`Transaccion` directamente en su cuenta y descuenta el stock, sin pasar por el
admin. Ya no se necesita papel ni digitación posterior.

- Si el comprador se equivoca, no puede borrar su propio registro — le pide al
  admin que lo anule (mismo mecanismo de anulación de la sección 2).
- El admin conserva la posibilidad de registrar una compra/fiado manualmente en
  nombre de alguien (`origen = admin`), para los casos excepcionales en que el
  comprador no pueda hacerlo él mismo (ej. no tiene el celular a mano).

### 4.2 Ingreso de inventario por foto/escaneo de factura

Cuando llega mercancía nueva, el admin toma una foto o sube un escaneo de la
factura del proveedor desde el panel de administrador. El sistema:

1. Envía la imagen a un servicio de IA (Gemini API de Google, con nivel gratuito
   — se integra desde Apps Script vía `UrlFetchApp`) pidiéndole que extraiga cada
   línea de producto: nombre, cantidad, y costo unitario.
2. Muestra un **resumen editable** con lo que detectó, línea por línea, antes de
   tocar el inventario real. El admin puede corregir cualquier valor mal leído,
   eliminar líneas que no aplican, o completar datos faltantes.
3. Para cada línea, el sistema intenta emparejarla con un producto existente por
   nombre; si no encuentra coincidencia, la marca como "producto nuevo" para que
   el admin decida si crearlo o corregir el nombre para que empate con uno
   existente.
4. Solo al confirmar el resumen se actualiza el `stock_actual` de cada producto
   (o se crean los productos nuevos) y queda un registro del ingreso de
   inventario para trazabilidad.

Como las facturas son una mezcla de impresas y manuscritas, la lectura automática
no será perfecta — por eso el paso de resumen editable (punto 2) es obligatorio,
nunca se actualiza el inventario directo desde la foto sin revisión humana.

## 5. Reportes

- **Ganancia por periodo**: suma de `(precio_venta − costo) × cantidad_vendida`
  sobre transacciones no anuladas, en un rango de fechas.
- **Pérdidas por periodo**: suma de `valor` en registros de Perdida no anulados.
- **Cartera pendiente**: suma de saldos pendientes de todos los compradores
  (fiado + préstamos + cuotas de gastos compartidos, sin incluir lo anulado).
- **Histórico de gastos compartidos**: por motivo (bienvenida, cumpleaños, otro),
  con el detalle de participantes y valor por persona.

## 6. Arquitectura técnica

- **Base de datos**: Google Sheets (una hoja por entidad, según el modelo de
  datos de la sección 2).
- **Backend**: Google Apps Script — funciones de negocio (registrar transacción,
  calcular saldo, dividir gasto compartido, generar reportes) expuestas a través
  de un Web App (`doGet`/`doPost` o `google.script.run` desde el HTML Service).
- **Lectura de facturas (OCR/IA)**: llamada desde Apps Script (`UrlFetchApp`) a la
  Gemini API (Google AI Studio) para extraer líneas de producto de la foto de la
  factura, con nivel gratuito suficiente para el volumen bajo de esta tienda.
  Requiere una API key de Google AI Studio a nombre del admin.
- **Frontend**: Apps Script HTML Service, con dos vistas principales:
  - Panel de administrador (inventario, ingreso de facturas, registrar
    movimientos, reportes).
  - "Mi cuenta" (vista de comprador: auto-registro de fiado, saldo y detalle).
- **Móvil**: la web app responde a distintos tamaños de pantalla y se puede
  agregar como acceso directo en el celular (estilo PWA) — sin necesidad de app
  nativa.
- **Costo**: cero o casi cero — todo corre dentro de la cuenta de Google
  Workspace existente, usando los niveles gratuitos de Apps Script y Gemini API.

## 7. Fuera de alcance / futuro

- Apps nativas móviles (iOS/Android).
- Clientes externos a la organización.
- Migración a Firebase u otro backend, si la tienda crece más allá de la escala
  actual (documentado como alternativa considerada, Enfoque B).
