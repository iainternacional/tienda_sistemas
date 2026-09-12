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
