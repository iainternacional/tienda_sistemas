if (typeof require !== 'undefined') {
  var dineroModulo = require('./dinero.js');
  var esEnteroPositivo = dineroModulo.esEnteroPositivo;
  var productosModulo = require('./productos.js');
  var hayStockSuficiente = productosModulo.hayStockSuficiente;
}

function crearPerdida(datos) {
  if (!datos.id) {
    throw new Error('Falta el id de la perdida');
  }
  if (!datos.producto) {
    throw new Error('Falta el producto de la perdida');
  }
  if (!datos.consumo || !datos.consumo.consumos) {
    throw new Error('Falta el consumo de lotes de la perdida');
  }
  if (!datos.motivo || String(datos.motivo).trim() === '') {
    throw new Error('Debe indicar el motivo de la perdida');
  }
  if (!esEnteroPositivo(datos.cantidad)) {
    throw new Error('La cantidad debe ser un entero positivo');
  }
  if (!hayStockSuficiente(datos.producto, datos.cantidad)) {
    throw new Error('Stock insuficiente para ' + datos.producto.nombre);
  }
  return {
    id: datos.id,
    productoId: datos.producto.id,
    productoNombre: datos.producto.nombre,
    cantidad: datos.cantidad,
    motivo: String(datos.motivo).trim(),
    valor: datos.consumo.costoTotal,
    fecha: datos.fecha,
    estado: 'pendiente',
    anuladoPor: '',
    anuladoFecha: '',
    anuladoMotivo: '',
    lotesConsumidos: JSON.stringify(datos.consumo.consumos),
    gastoId: ''
  };
}

function estaCargada(perdida) {
  return String(perdida.gastoId || '').trim() !== '';
}

// Perdidas activas que todavia no se repartieron en un gasto compartido.
function perdidasSinCargar(perdidas) {
  return (perdidas || []).filter(function (perdida) {
    return perdida.estado !== 'anulado' && !estaCargada(perdida);
  });
}

// Valida la seleccion completa antes de tocar nada: todo o nada.
function seleccionarPerdidasACargar(perdidas, ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error('Debe elegir al menos una perdida');
  }
  const seleccionadas = [];
  ids.forEach(function (id) {
    const perdida = (perdidas || []).filter(function (p) { return p.id === id; })[0];
    if (!perdida) {
      throw new Error('No se encontro una de las perdidas');
    }
    if (perdida.estado === 'anulado') {
      throw new Error('Una de las perdidas esta anulada');
    }
    if (estaCargada(perdida)) {
      throw new Error('Una de las perdidas ya fue cargada a un gasto compartido');
    }
    if (seleccionadas.indexOf(perdida) !== -1) {
      throw new Error('Hay perdidas repetidas');
    }
    seleccionadas.push(perdida);
  });
  return {
    perdidas: seleccionadas,
    total: seleccionadas.reduce(function (suma, perdida) { return suma + Number(perdida.valor); }, 0)
  };
}

if (typeof module !== 'undefined') {
  module.exports = { crearPerdida, estaCargada, perdidasSinCargar, seleccionarPerdidasACargar };
}
