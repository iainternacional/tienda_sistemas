function crearHojaFalsa(nombre, filasIniciales) {
  const contenido = (filasIniciales || []).map(fila => fila.slice());
  return {
    nombre: nombre,
    contenido: contenido,
    getLastRow() {
      return contenido.length;
    },
    appendRow(fila) {
      contenido.push(fila.slice());
    },
    getRange(filaInicio, columnaInicio, numFilas, numColumnas) {
      return {
        getValues() {
          const resultado = [];
          for (let f = 0; f < numFilas; f++) {
            const filaExistente = contenido[filaInicio - 1 + f] || [];
            const fila = [];
            for (let c = 0; c < numColumnas; c++) {
              const valor = filaExistente[columnaInicio - 1 + c];
              fila.push(valor === undefined ? '' : valor);
            }
            resultado.push(fila);
          }
          return resultado;
        },
        setValues(valores) {
          valores.forEach((fila, f) => {
            const indice = filaInicio - 1 + f;
            if (!contenido[indice]) {
              contenido[indice] = [];
            }
            fila.forEach((valor, c) => {
              contenido[indice][columnaInicio - 1 + c] = valor;
            });
          });
        }
      };
    }
  };
}

function crearLibroFalso(datosIniciales) {
  const hojas = {};
  Object.keys(datosIniciales || {}).forEach(nombre => {
    hojas[nombre] = crearHojaFalsa(nombre, datosIniciales[nombre]);
  });
  return {
    hojas: hojas,
    getSheetByName(nombre) {
      return hojas[nombre] || null;
    },
    insertSheet(nombre) {
      hojas[nombre] = crearHojaFalsa(nombre, []);
      return hojas[nombre];
    }
  };
}

module.exports = { crearLibroFalso };
