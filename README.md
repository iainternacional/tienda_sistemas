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
