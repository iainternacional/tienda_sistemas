var ESQUEMA = {
  Usuarios: [
    'id', 'nombre', 'area', 'rol', 'tipoLogin', 'emailCorporativo',
    'usuario', 'salt', 'claveHash', 'esPseudoUsuario', 'activo'
  ],
  Productos: [
    'id', 'nombre', 'categoria', 'costo', 'precioVenta', 'stockActual', 'activo', 'alias', 'porcentajeAumento'
  ],
  Transacciones: [
    'id', 'usuarioId', 'productoId', 'productoNombre', 'cantidad',
    'valorUnitario', 'valorTotal', 'fecha', 'origen', 'estado',
    'anuladoPor', 'anuladoFecha', 'anuladoMotivo', 'costoUnitario'
  ],
  Prestamos: [
    'id', 'usuarioId', 'valor', 'fecha', 'estado',
    'anuladoPor', 'anuladoFecha', 'anuladoMotivo'
  ],
  Pagos: [
    'id', 'usuarioId', 'valor', 'fecha', 'aplicadoA', 'estado',
    'anuladoPor', 'anuladoFecha', 'anuladoMotivo'
  ],
  Perdidas: [
    'id', 'productoId', 'productoNombre', 'cantidad', 'motivo', 'valor', 'fecha', 'estado',
    'anuladoPor', 'anuladoFecha', 'anuladoMotivo'
  ],
  GastosCompartidos: [
    'id', 'motivo', 'descripcion', 'valorTotal', 'participantes', 'fecha', 'estado',
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
