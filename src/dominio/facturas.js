if (typeof require !== 'undefined') {
  var dineroModulo = require('./dinero.js');
  var esEnteroPositivo = dineroModulo.esEnteroPositivo;
  var productosModulo = require('./productos.js');
  var normalizarNombre = productosModulo.normalizarNombre;
}

function sanearLineas(lineasCrudas) {
  if (!Array.isArray(lineasCrudas)) {
    return [];
  }
  const saneadas = [];
  lineasCrudas.forEach(function (linea) {
    if (!linea || typeof linea !== 'object') {
      return;
    }
    const nombre = String(linea.nombre || '').trim();
    const cantidad = Number(linea.cantidad);
    const costoUnitario = Number(linea.costoUnitario);
    if (nombre === '' || !esEnteroPositivo(cantidad) || !esEnteroPositivo(costoUnitario)) {
      return;
    }
    saneadas.push({ nombre: nombre, cantidad: cantidad, costoUnitario: costoUnitario });
  });
  return saneadas;
}

function buscarPorNombreOAlias(productos, nombre) {
  const buscado = normalizarNombre(nombre);
  if (buscado === '') {
    return null;
  }
  for (let i = 0; i < productos.length; i++) {
    if (normalizarNombre(productos[i].nombre) === buscado || normalizarNombre(productos[i].alias) === buscado) {
      return productos[i];
    }
  }
  return null;
}

function emparejarLineas(lineasSaneadas, productosActivos) {
  return lineasSaneadas.map(function (linea) {
    const encontrado = buscarPorNombreOAlias(productosActivos, linea.nombre);
    return Object.assign({}, linea, {
      productoId: encontrado ? encontrado.id : '',
      esNuevo: !encontrado
    });
  });
}

function parsearRespuestaGemini(texto) {
  if (!texto || typeof texto !== 'string') {
    throw new Error('No se pudo interpretar la respuesta de Gemini: vacia');
  }
  const limpio = texto.trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
  let json;
  try {
    json = JSON.parse(limpio);
  } catch (error) {
    throw new Error('No se pudo interpretar la respuesta de Gemini');
  }
  if (!json || !Array.isArray(json.lineas)) {
    throw new Error('La respuesta de Gemini no trae lineas');
  }
  return json.lineas;
}

function validarLineasParaConfirmar(lineas) {
  if (!Array.isArray(lineas) || lineas.length === 0) {
    throw new Error('Debe haber al menos una linea para confirmar');
  }
  lineas.forEach(function (linea, indice) {
    const numero = indice + 1;
    const nombre = String((linea && linea.nombre) || '').trim();
    if (nombre === '') {
      throw new Error('Linea ' + numero + ': falta el nombre');
    }
    if (!esEnteroPositivo(Number(linea.cantidad))) {
      throw new Error('Linea ' + numero + ' (' + nombre + '): la cantidad debe ser un entero positivo');
    }
    if (!esEnteroPositivo(Number(linea.costoUnitario))) {
      throw new Error('Linea ' + numero + ' (' + nombre + '): el costo debe ser un entero positivo');
    }
    if (linea.esNuevo) {
      if (String(linea.categoria || '').trim() === '') {
        throw new Error('Linea ' + numero + ' (' + nombre + '): falta la categoria del producto nuevo');
      }
      if (!esEnteroPositivo(Number(linea.precioVenta))) {
        throw new Error('Linea ' + numero + ' (' + nombre + '): el precio de venta debe ser un entero positivo');
      }
    }
  });
}

function crearIngresoInventario(datos) {
  if (!datos.id) {
    throw new Error('Falta el id del ingreso');
  }
  validarLineasParaConfirmar(datos.lineas);
  return {
    id: datos.id,
    fecha: datos.fecha,
    admin: datos.admin,
    lineas: JSON.stringify(datos.lineas),
    estado: 'pendiente',
    anuladoPor: '',
    anuladoFecha: '',
    anuladoMotivo: ''
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    sanearLineas,
    emparejarLineas,
    parsearRespuestaGemini,
    validarLineasParaConfirmar,
    crearIngresoInventario
  };
}
