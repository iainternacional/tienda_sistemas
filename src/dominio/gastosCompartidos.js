if (typeof require !== 'undefined') {
  var dineroModulo = require('./dinero.js');
  var esEnteroPositivo = dineroModulo.esEnteroPositivo;
  var productosModulo = require('./productos.js');
  var hayStockSuficiente = productosModulo.hayStockSuficiente;
}

const MOTIVOS_GASTO_VALIDOS = ['bienvenida', 'cumpleanos', 'otro'];

function repartirEntre(valorTotal, cantidadParticipantes) {
  if (!esEnteroPositivo(cantidadParticipantes)) {
    throw new Error('Debe haber al menos un participante');
  }
  if (!esEnteroPositivo(valorTotal)) {
    throw new Error('El valor total debe ser un entero positivo');
  }
  const base = Math.floor(valorTotal / cantidadParticipantes);
  const residuo = valorTotal - base * cantidadParticipantes;
  const partes = [];
  for (let i = 0; i < cantidadParticipantes; i++) {
    partes.push(i < residuo ? base + 1 : base);
  }
  return partes;
}

function crearGastoCompartido(datos) {
  if (!datos.id) {
    throw new Error('Falta el id del gasto compartido');
  }
  if (MOTIVOS_GASTO_VALIDOS.indexOf(datos.motivo) === -1) {
    throw new Error('Motivo invalido: ' + datos.motivo);
  }
  const participantes = datos.participantes || [];
  if (participantes.length === 0) {
    throw new Error('Debe elegir al menos un participante');
  }
  for (let i = 0; i < participantes.length; i++) {
    if (participantes.indexOf(participantes[i]) !== i) {
      throw new Error('Hay participantes repetidos');
    }
  }
  let valorTotal = datos.valorTotal;
  let datosProducto = { productoId: '', productoNombre: '', cantidad: '', lotesConsumidos: '' };
  if (datos.producto) {
    if (!esEnteroPositivo(datos.cantidad)) {
      throw new Error('La cantidad debe ser un entero positivo');
    }
    if (!hayStockSuficiente(datos.producto, datos.cantidad)) {
      throw new Error('Stock insuficiente para ' + datos.producto.nombre);
    }
    if (!datos.consumo || !datos.consumo.consumos) {
      throw new Error('Falta el consumo de lotes del gasto compartido');
    }
    valorTotal = datos.consumo.costoTotal;
    datosProducto = {
      productoId: datos.producto.id,
      productoNombre: datos.producto.nombre,
      cantidad: datos.cantidad,
      lotesConsumidos: JSON.stringify(datos.consumo.consumos)
    };
  }
  if (!esEnteroPositivo(valorTotal)) {
    throw new Error('El valor total debe ser un entero positivo');
  }
  return {
    id: datos.id,
    motivo: datos.motivo,
    descripcion: String(datos.descripcion || '').trim(),
    valorTotal: valorTotal,
    participantes: participantes.join(','),
    fecha: datos.fecha,
    estado: 'pendiente',
    anuladoPor: '',
    anuladoFecha: '',
    anuladoMotivo: '',
    productoId: datosProducto.productoId,
    productoNombre: datosProducto.productoNombre,
    cantidad: datosProducto.cantidad,
    lotesConsumidos: datosProducto.lotesConsumidos
  };
}

function participantesDe(gasto) {
  return String(gasto.participantes || '')
    .split(',')
    .map(function (id) { return id.trim(); })
    .filter(function (id) { return id !== ''; });
}

function cuotasDeGasto(gasto) {
  if (gasto.estado === 'anulado') {
    return [];
  }
  const ids = participantesDe(gasto);
  if (ids.length === 0) {
    return [];
  }
  const partes = repartirEntre(gasto.valorTotal, ids.length);
  return ids.map(function (usuarioId, indice) {
    return {
      gastoId: gasto.id,
      usuarioId: usuarioId,
      valor: partes[indice],
      fecha: gasto.fecha,
      motivo: gasto.motivo,
      descripcion: gasto.descripcion
    };
  });
}

if (typeof module !== 'undefined') {
  module.exports = { repartirEntre, crearGastoCompartido, cuotasDeGasto, participantesDe };
}
