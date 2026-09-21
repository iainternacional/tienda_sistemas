# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Git — prohibido sin permiso explícito

**Nunca** ejecutar `git commit`, `git push`, ni crear un Pull Request
(`gh pr create`) por cuenta propia. El usuario los hace él mismo. Solo
proceder con alguna de estas acciones si el usuario lo pide explícitamente en
ese momento — una autorización pasada no aplica a cambios futuros.

## What this is

Internal store system ("Tienda Sistemas") for the Sistemas department: inventory,
fiado (store credit) with comprador self-registration, préstamos, pagos, pérdidas,
gastos compartidos, and admin reports. Runs entirely as a Google Apps Script Web
App backed by a Google Sheet — no external hosting, near-zero cost.

## Commands

```bash
npm install              # install dependencies (just @google/clasp)
npm test                 # run the full test suite (node --test)
node --test test/dominio/auth.test.js   # run a single test file
npm run push             # clasp push — upload src/ to the Apps Script project
```

There is no build step and no linter configured — `src/` is pushed to Apps
Script as-is via `clasp` (`.clasp.json` sets `rootDir: ./src`).

Deploying a code change so the live Web App actually serves it requires a
manual step beyond `npm run push`: in the Apps Script editor, **Implementar →
Gestionar implementaciones → editar la implementación existente → Nueva
versión → Implementar** (creating a brand-new deployment instead would change
the Web App URL). If a change adds/renames a column in `ESQUEMA`
(`src/datos/esquema.js`), also re-run `configurarInicial()` from the Apps
Script editor's function dropdown afterward — it creates missing sheets and
writes headers, but does not touch existing rows.

The Web App needs the script property `ID_LIBRO` (target spreadsheet ID) set
in the Apps Script project before anything works; `configurarInicial()` sets
up the sheets and the first admin user.

## Architecture

Four layers, each with one job. A file's location tells you what it's allowed
to touch:

- **`src/dominio/`** — pure business logic. No Apps Script globals, no I/O.
  This is the only layer covered by `npm test`, and it's where nearly all
  logic and validation should live. Each module pairs with a
  `test/dominio/*.test.js` file.
- **`src/datos/`** — Google Sheets I/O (`SpreadsheetApp`), isolated so the
  domain layer never touches it directly. `esquema.js` defines every sheet's
  columns (`ESQUEMA`) plus the row⇄object mapping (`filaAObjeto`/
  `objetoAFila`); `hoja.js` has the generic CRUD (`leerTodo`, `agregarFila`,
  `actualizarPorId`) that every entity reuses; `libro.js` has
  `obtenerLibro()`, id/date/hash helpers.
- **`src/app/`** — `api.js` is the *only* place allowed to call both a
  `dominio` function and a `datos` function in the same request; every
  `apiXxx(token, ...)` function is what `google.script.run` calls from the
  HTML. `router.js` handles `doGet` (routes `?vista=admin` vs. the default
  comprador view) and `incluir()` for including HTML partials.
- **`src/web/`** — Apps Script HTML Service views: `admin.html` (admin panel)
  and `micuenta.html` (comprador self-service), sharing `estilos.html`. Talk
  to the backend only through `google.script.run.apiXxx(...)`.

### Apps Script/Node dual-module pattern

Every file under `src/` runs both inside Apps Script (shared global scope, no
`require`) and under `node --test` (CommonJS). Each one opens with a guarded
require block and closes with a guarded export:

```javascript
if (typeof require !== 'undefined') {
  var dineroModulo = require('./dinero.js');   // var, not const —
  var esEnteroPositivo = dineroModulo.esEnteroPositivo;  // a `var` redeclaration
}                                                          // is a no-op in Apps
                                                            // Script's shared scope,
                                                            // `const` would throw.

// ... implementation ...

if (typeof module !== 'undefined') {
  module.exports = { esEnteroPositivo };
}
```

Tests never touch real Sheets or Apps Script services. `test/ayudas/libroFalso.js`
provides an in-memory fake (`crearLibroFalso`) implementing the same
`getSheetByName`/`getRange`/`getValues`/`setValues`/`appendRow` surface the
`datos` layer expects, so `datos`-layer tests run under plain Node.

### Data model conventions (`src/datos/esquema.js`)

- **Money is always an integer** (Colombian pesos, no decimals). Any
  calculation that could produce a fraction (e.g. splitting a shared expense)
  must distribute the remainder instead of rounding — see `repartirEntre` in
  `src/dominio/gastosCompartidos.js`.
- **New columns are appended at the end** of an entity's array in `ESQUEMA`,
  never inserted in the middle — rows already written to the real sheet are
  mapped by position and would be corrupted otherwise.
- **Nothing is ever deleted.** Every mutable entity (Transacciones, Prestamos,
  Pagos, Perdidas, GastosCompartidos) is voided instead: `estado: 'anulado'`
  plus `anuladoPor`/`anuladoFecha`/`anuladoMotivo`, via the shared
  `anularRegistro()` in `src/dominio/anulacion.js`. The original record is
  kept intact.
- A comprador's saldo (`src/dominio/saldo.js`) is derived, not stored: pending
  debts (fiado, préstamos, cuotas of gastos compartidos) minus general abonos
  — see the "Decisiones de diseño" section of
  `docs/superpowers/plans/2026-09-14-fase2-prestamos-pagos-reportes.md` for
  why a *directed* pago (`aplicadoA` set) is handled differently from a
  general one.
- A shared expense's per-person cuotas are computed on the fly from its
  participant list (`cuotasDeGasto`), never stored as separate rows — voiding
  the expense voids its cuotas for free.

### Auth

Two login types coexist on the same `Usuarios` sheet, picked by `tipoLogin`:

- `google_corporativo` — `usuarioDeSesion()` in `src/app/api.js` first tries
  `Session.getActiveUser().getEmail()` and matches it against
  `emailCorporativo`. This only resolves reliably for accounts in the same
  Google Workspace domain as the script owner.
- `usuario_clave` — falls back to a token issued by `apiIniciarSesion`
  (salted hash via `hashConUtilities`, session token cached in
  `CacheService`, `DURACION_SESION_SEGUNDOS` TTL).

`exigirAdmin(token)` / `exigirUsuario(token)` in `api.js` gate every admin-only
endpoint; both throw rather than return on failure, and `apiXxx` functions
catch that and turn it into `{ ok: false, mensaje }`.

## Conventions

- Identifiers, user-facing messages, and commit messages are in Spanish,
  without accents in identifiers (`anular`, not `anúlar`).
- Every domain module's public functions throw `Error` with a Spanish message
  on invalid input; `api.js` is where those get caught and turned into
  `{ ok: false, mensaje }` responses — domain functions themselves never
  return an ok/error envelope.
- Design/planning docs live under `docs/superpowers/specs/` (architecture
  decisions) and `docs/superpowers/plans/` (task-by-task implementation
  plans) — check there for the reasoning behind a feature before assuming it
  needs revisiting.
