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
