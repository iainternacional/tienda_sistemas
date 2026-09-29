if (typeof require !== 'undefined') {
  var dineroModulo = require('./dinero.js');
  var esEnteroPositivo = dineroModulo.esEnteroPositivo;
}

function crearLote(datos) {
  if (!datos.id) {
    throw new Error('Falta el id del lote');
  }
  if (!datos.productoId) {
    throw new Error('Falta el producto del lote');
  }
  if (!esEnteroPositivo(datos.cantidad)) {
    throw new Error('La cantidad debe ser un entero positivo');
  }
  if (!esEnteroPositivo(datos.costoUnitario)) {
    throw new Error('El costo unitario debe ser un entero positivo');
  }
  return {
    id: datos.id,
    productoId: datos.productoId,
    fecha: datos.fecha,
    cantidadInicial: datos.cantidad,
    cantidadRestante: datos.cantidad,
    costoUnitario: datos.costoUnitario,
    estado: 'activo',
    anuladoPor: '',
    anuladoFecha: '',
    anuladoMotivo: ''
  };
}

function lotesDisponibles(lotes, productoId) {
  return (lotes || [])
    .filter(function (lote) {
      return lote.productoId === productoId
        && lote.estado === 'activo'
        && Number(lote.cantidadRestante) > 0;
    })
    .sort(function (a, b) { return String(a.fecha).localeCompare(String(b.fecha)); });
}

function consumirDeLotes(lotes, productoId, cantidadRequerida, nombreProducto) {
  if (!esEnteroPositivo(cantidadRequerida)) {
    throw new Error('La cantidad debe ser un entero positivo');
  }
  const disponibles = lotesDisponibles(lotes, productoId);
  const total = disponibles.reduce(function (suma, lote) {
    return suma + Number(lote.cantidadRestante);
  }, 0);
  if (total < cantidadRequerida) {
    throw new Error('Stock insuficiente para ' + nombreProducto);
  }
  const consumos = [];
  const lotesActualizados = [];
  let pendiente = cantidadRequerida;
  let costoTotal = 0;
  for (let i = 0; i < disponibles.length && pendiente > 0; i++) {
    const lote = disponibles[i];
    const disponible = Number(lote.cantidadRestante);
    const toma = pendiente < disponible ? pendiente : disponible;
    const costoUnitario = Number(lote.costoUnitario);
    consumos.push({ loteId: lote.id, cantidad: toma, costoUnitario: costoUnitario });
    lotesActualizados.push(Object.assign({}, lote, { cantidadRestante: disponible - toma }));
    costoTotal += toma * costoUnitario;
    pendiente -= toma;
  }
  return {
    consumos: consumos,
    costoTotal: costoTotal,
    costoUnitarioPromedio: Math.round(costoTotal / cantidadRequerida),
    lotesActualizados: lotesActualizados
  };
}

function devolverALotes(lotes, lotesConsumidos) {
  const porId = {};
  (lotesConsumidos || []).forEach(function (consumo) {
    porId[consumo.loteId] = (porId[consumo.loteId] || 0) + Number(consumo.cantidad);
  });
  const actualizados = [];
  (lotes || []).forEach(function (lote) {
    if (porId[lote.id] === undefined) {
      return;
    }
    actualizados.push(Object.assign({}, lote, {
      cantidadRestante: Number(lote.cantidadRestante) + porId[lote.id]
    }));
  });
  return actualizados;
}

function puedeAnularseLote(lote) {
  return Number(lote.cantidadRestante) === Number(lote.cantidadInicial);
}

if (typeof module !== 'undefined') {
  module.exports = { crearLote, lotesDisponibles, consumirDeLotes, devolverALotes, puedeAnularseLote };
}
