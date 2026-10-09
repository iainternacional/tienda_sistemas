const DURACION_SESION_SEGUNDOS = 21600;

function usuarioDeToken(token) {
  if (!token) {
    return null;
  }
  const usuarioId = CacheService.getScriptCache().get('sesion_' + token);
  if (!usuarioId) {
    return null;
  }
  const usuarios = leerTodo(obtenerLibro(), 'Usuarios');
  for (let i = 0; i < usuarios.length; i++) {
    if (usuarios[i].id === usuarioId && usuarios[i].activo === true) {
      return usuarios[i];
    }
  }
  return null;
}

function usuarioDeSesion(token) {
  let email = '';
  try {
    email = Session.getActiveUser().getEmail();
  } catch (error) {
    email = '';
  }
  if (email) {
    const usuario = resolverUsuarioPorEmail(leerTodo(obtenerLibro(), 'Usuarios'), email);
    if (usuario) {
      return usuario;
    }
  }
  return usuarioDeToken(token);
}

function exigirUsuario(token) {
  const usuario = usuarioDeSesion(token);
  if (!usuario) {
    throw new Error('Sesion no valida. Vuelva a iniciar sesion.');
  }
  return usuario;
}

function exigirAdmin(token) {
  const usuario = exigirUsuario(token);
  if (!esAdmin(usuario)) {
    throw new Error('Esta accion es solo para el administrador');
  }
  return usuario;
}

function productosVisibles() {
  const libro = obtenerLibro();
  const lotes = leerTodo(libro, 'Lotes');
  return leerTodo(libro, 'Productos')
    .filter(function (producto) { return producto.activo === true; })
    .map(function (producto) {
      return {
        id: producto.id,
        nombre: producto.nombre,
        alias: producto.alias,
        categoria: producto.categoria,
        precioVenta: precioVigente(lotes, producto.id, producto.precioVenta),
        stockActual: producto.stockActual
      };
    });
}

function guardarPrecioDeLotes(libro, lotes) {
  lotes.forEach(function (lote) {
    actualizarPorId(libro, 'Lotes', lote.id, { precioVenta: lote.precioVenta });
  });
}

function leerMovimientos(libro) {
  return {
    transacciones: leerTodo(libro, 'Transacciones'),
    prestamos: leerTodo(libro, 'Prestamos'),
    gastos: leerTodo(libro, 'GastosCompartidos'),
    pagos: leerTodo(libro, 'Pagos')
  };
}

const LIMITE_DESGLOSE = 50;

function estadoDeUsuario(usuario, verTodo) {
  const movimientos = leerMovimientos(obtenerLibro());
  const resumen = resumirSaldoUsuario(movimientos, usuario.id, verTodo ? 0 : LIMITE_DESGLOSE);
  return {
    autenticado: true,
    nombre: usuario.nombre,
    rol: usuario.rol,
    saldo: resumen.saldo,
    desglose: resumen.desglose,
    hayMasMovimientos: resumen.totalLineas > resumen.desglose.length,
    productos: productosVisibles(),
    mensaje: ''
  };
}

function apiIniciarSesion(usuario, clave) {
  const usuarios = leerTodo(obtenerLibro(), 'Usuarios');
  const encontrado = resolverUsuarioPorClave(usuarios, usuario, clave, hashConUtilities);
  if (!encontrado) {
    return { ok: false, token: '', mensaje: 'Usuario o clave incorrectos' };
  }
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put('sesion_' + token, encontrado.id, DURACION_SESION_SEGUNDOS);
  return { ok: true, token: token, mensaje: '' };
}

function apiObtenerEstado(token, verTodo) {
  const usuario = usuarioDeSesion(token);
  if (!usuario) {
    return {
      autenticado: false, nombre: '', rol: '', saldo: 0,
      desglose: [], productos: [], mensaje: 'Inicie sesion para continuar'
    };
  }
  return estadoDeUsuario(usuario, verTodo === true);
}

function registrarFiadoSinBloqueo(libro, usuario, productoId, cantidad, origen) {
  const productos = leerTodo(libro, 'Productos');
  let producto = null;
  for (let i = 0; i < productos.length; i++) {
    if (productos[i].id === productoId) {
      producto = productos[i];
      break;
    }
  }
  if (!producto || producto.activo !== true) {
    throw new Error('El producto no existe o esta inactivo');
  }
  const consumo = consumirDeLotes(leerTodo(libro, 'Lotes'), producto.id, cantidad, producto.nombre, producto.precioVenta);
  const transaccion = crearTransaccionFiado({
    id: nuevoId(),
    usuarioId: usuario.id,
    producto: producto,
    cantidad: cantidad,
    fecha: ahoraIso(),
    origen: origen,
    consumo: consumo
  });
  const actualizado = descontarStock(producto, cantidad);
  agregarFila(libro, 'Transacciones', transaccion);
  consumo.lotesActualizados.forEach(function (lote) {
    actualizarPorId(libro, 'Lotes', lote.id, { cantidadRestante: lote.cantidadRestante });
  });
  actualizarPorId(libro, 'Productos', producto.id, { stockActual: actualizado.stockActual });
  return transaccion;
}

function registrarFiadoMultiple(usuario, lineas, origen) {
  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(30000);
  try {
    const libro = obtenerLibro();
    const productos = leerTodo(libro, 'Productos');
    const cantidadesPorProducto = {};
    lineas.forEach(function (linea) {
      cantidadesPorProducto[linea.productoId] = (cantidadesPorProducto[linea.productoId] || 0) + Number(linea.cantidad);
    });
    Object.keys(cantidadesPorProducto).forEach(function (productoId) {
      const producto = productos.filter(function (p) { return p.id === productoId; })[0];
      if (!producto || producto.activo !== true) {
        throw new Error('El producto no existe o esta inactivo');
      }
      if (!hayStockSuficiente(producto, cantidadesPorProducto[productoId])) {
        throw new Error('Stock insuficiente para ' + producto.nombre);
      }
    });
    return lineas.map(function (linea) {
      return registrarFiadoSinBloqueo(libro, usuario, linea.productoId, Number(linea.cantidad), origen);
    });
  } finally {
    bloqueo.releaseLock();
  }
}

function apiRegistrarFiado(token, lineas) {
  try {
    const usuario = exigirUsuario(token);
    validarLineasFiado(lineas, 3);
    const transacciones = registrarFiadoMultiple(usuario, lineas, 'autoregistro');
    const totalUnidades = transacciones.reduce(function (suma, t) { return suma + t.cantidad; }, 0);
    const estado = estadoDeUsuario(usuario);
    estado.ok = true;
    estado.mensaje = 'Registrado: ' + transacciones.length + ' producto(s), ' + totalUnidades + ' unidad(es)';
    return estado;
  } catch (error) {
    return { ok: false, mensaje: error.message, saldo: 0, desglose: [], productos: [] };
  }
}

function apiCrearProducto(token, datos) {
  try {
    exigirAdmin(token);
    const normalizados = {
      nombre: String(datos.nombre || '').trim(),
      alias: String(datos.alias || '').trim(),
      categoria: String(datos.categoria || '').trim(),
      costo: Number(datos.costo),
      precioVenta: Number(datos.precioVenta),
      stockActual: Number(datos.stockActual),
      porcentajeAumento: Number(datos.porcentajeAumento) || 0
    };
    const validacion = validarProductoNuevo(normalizados);
    if (!validacion.valido) {
      return { ok: false, mensaje: validacion.errores.join('. '), productos: [] };
    }
    const libro = obtenerLibro();
    if (buscarProductoPorNombre(leerTodo(libro, 'Productos'), normalizados.nombre)) {
      return { ok: false, mensaje: 'Ya existe un producto con ese nombre', productos: [] };
    }
    const productoId = nuevoId();
    agregarFila(libro, 'Productos', {
      id: productoId,
      nombre: normalizados.nombre,
      alias: normalizados.alias,
      categoria: normalizados.categoria,
      costo: normalizados.costo,
      precioVenta: normalizados.precioVenta,
      stockActual: normalizados.stockActual,
      activo: true,
      porcentajeAumento: normalizados.porcentajeAumento
    });
    if (normalizados.stockActual > 0) {
      agregarFila(libro, 'Lotes', crearLote({
        id: nuevoId(),
        productoId: productoId,
        fecha: ahoraIso(),
        cantidad: normalizados.stockActual,
        costoUnitario: normalizados.costo,
        precioVenta: normalizados.precioVenta
      }));
    }
    return { ok: true, mensaje: 'Producto creado', productos: productosVisibles() };
  } catch (error) {
    return { ok: false, mensaje: error.message, productos: [] };
  }
}

function apiActualizarProducto(token, productoId, cambios) {
  try {
    exigirAdmin(token);
    const permitidos = {};
    ['nombre', 'alias', 'categoria', 'costo', 'precioVenta', 'porcentajeAumento', 'activo'].forEach(function (campo) {
      if (cambios[campo] !== undefined && cambios[campo] !== null && cambios[campo] !== '') {
        permitidos[campo] = campo === 'nombre' || campo === 'alias' || campo === 'categoria'
          ? String(cambios[campo]).trim()
          : (campo === 'activo' ? cambios[campo] === true : Number(cambios[campo]));
      }
    });
    if (cambios.alias === '') {
      permitidos.alias = '';
    }
    if (permitidos.nombre === '') {
      return { ok: false, mensaje: 'El nombre no puede quedar vacio', productos: [] };
    }
    if (permitidos.precioVenta !== undefined && !(permitidos.precioVenta > 0)) {
      return { ok: false, mensaje: 'El precio de venta debe ser mayor a cero', productos: [] };
    }
    if (permitidos.porcentajeAumento !== undefined && !(permitidos.porcentajeAumento >= 0)) {
      return { ok: false, mensaje: 'El porcentaje de aumento no puede ser negativo', productos: [] };
    }
    if (permitidos.precioVenta !== undefined && !Number.isInteger(permitidos.precioVenta)) {
      return { ok: false, mensaje: 'El precio de venta debe ser un numero entero', productos: [] };
    }
    const libro = obtenerLibro();
    const productos = leerTodo(libro, 'Productos');
    if (permitidos.nombre) {
      const repetido = buscarProductoPorNombre(productos, permitidos.nombre);
      if (repetido && repetido.id !== productoId) {
        return { ok: false, mensaje: 'Ya existe un producto con ese nombre', productos: [] };
      }
    }
    const actual = productos.filter(function (p) { return p.id === productoId; })[0];
    if (!actual) {
      return { ok: false, mensaje: 'No se encontro el producto', productos: [] };
    }
    actualizarPorId(libro, 'Productos', productoId, permitidos);
    // Un cambio manual de precio aplica a todas las unidades que quedan, de cualquier lote.
    if (permitidos.precioVenta !== undefined && permitidos.precioVenta !== Number(actual.precioVenta)) {
      guardarPrecioDeLotes(libro, asignarPrecioALotesConStock(leerTodo(libro, 'Lotes'), productoId, permitidos.precioVenta));
    }
    return { ok: true, mensaje: 'Producto actualizado', productos: productosVisibles() };
  } catch (error) {
    return { ok: false, mensaje: error.message, productos: [] };
  }
}

function apiListarProductosAdmin(token) {
  try {
    exigirAdmin(token);
    const libro = obtenerLibro();
    const lotes = leerTodo(libro, 'Lotes');
    const productos = leerTodo(libro, 'Productos').map(function (producto) {
      return {
        id: producto.id,
        nombre: producto.nombre,
        alias: producto.alias,
        categoria: producto.categoria,
        costo: producto.costo,
        precioVenta: producto.precioVenta,
        precioVigente: precioVigente(lotes, producto.id, producto.precioVenta),
        porcentajeAumento: producto.porcentajeAumento,
        stockActual: producto.stockActual,
        activo: producto.activo === true
      };
    });
    return { ok: true, mensaje: '', productos: productos };
  } catch (error) {
    return { ok: false, mensaje: error.message, productos: [] };
  }
}

function usuariosVisibles() {
  return leerTodo(obtenerLibro(), 'Usuarios')
    .filter(function (usuario) {
      return usuario.activo === true && usuario.esPseudoUsuario !== true;
    })
    .map(function (usuario) {
      return {
        id: usuario.id,
        nombre: usuario.nombre,
        area: usuario.area,
        tipoLogin: usuario.tipoLogin,
        usuario: usuario.usuario,
        emailCorporativo: usuario.emailCorporativo,
        esPseudoUsuario: usuario.esPseudoUsuario === true
      };
    });
}

function apiListarUsuarios(token) {
  try {
    exigirAdmin(token);
    return { ok: true, mensaje: '', usuarios: usuariosVisibles() };
  } catch (error) {
    return { ok: false, mensaje: error.message, usuarios: [] };
  }
}

function usuariosParaReportes() {
  return leerTodo(obtenerLibro(), 'Usuarios')
    .filter(function (usuario) { return usuario.activo === true && usuario.esPseudoUsuario !== true; })
    .map(function (usuario) { return { id: usuario.id, nombre: usuario.nombre }; });
}

function apiListarUsuariosParaReportes(token) {
  try {
    exigirAdmin(token);
    return { ok: true, mensaje: '', usuarios: usuariosParaReportes() };
  } catch (error) {
    return { ok: false, mensaje: error.message, usuarios: [] };
  }
}

function apiCrearUsuarioComprador(token, datos) {
  try {
    exigirAdmin(token);
    const libro = obtenerLibro();
    if (buscarUsuarioPorNombreDeUsuario(leerTodo(libro, 'Usuarios'), datos.usuario)) {
      return { ok: false, mensaje: 'Ya existe un usuario con ese login', usuarios: [] };
    }
    const nuevo = crearUsuarioComprador({
      id: nuevoId(),
      nombre: datos.nombre,
      area: datos.area,
      usuario: datos.usuario,
      clave: datos.clave,
      salt: Utilities.getUuid()
    }, hashConUtilities);
    agregarFila(libro, 'Usuarios', nuevo);
    return {
      ok: true,
      mensaje: 'Comprador creado. Entrega estos datos a ' + nuevo.nombre + ': usuario ' + nuevo.usuario,
      usuarios: usuariosVisibles()
    };
  } catch (error) {
    return { ok: false, mensaje: error.message, usuarios: [] };
  }
}

function apiCrearUsuarioCorporativo(token, datos) {
  try {
    exigirAdmin(token);
    const libro = obtenerLibro();
    if (buscarUsuarioPorEmailCorporativo(leerTodo(libro, 'Usuarios'), datos.email)) {
      return { ok: false, mensaje: 'Ya existe un usuario con ese correo', usuarios: [] };
    }
    const nuevo = crearUsuarioCorporativo({
      id: nuevoId(),
      nombre: datos.nombre,
      area: datos.area,
      email: datos.email
    });
    agregarFila(libro, 'Usuarios', nuevo);
    return {
      ok: true,
      mensaje: nuevo.nombre + ' ya puede entrar a "Mi cuenta" con su correo ' + nuevo.emailCorporativo,
      usuarios: usuariosVisibles()
    };
  } catch (error) {
    return { ok: false, mensaje: error.message, usuarios: [] };
  }
}

function apiActualizarUsuario(token, usuarioId, cambios) {
  try {
    exigirAdmin(token);
    const libro = obtenerLibro();
    const usuarios = leerTodo(libro, 'Usuarios');
    const existente = usuarios.filter(function (usuario) { return usuario.id === usuarioId; })[0];
    if (!existente) {
      return { ok: false, mensaje: 'No se encontro el comprador', usuarios: [] };
    }
    if (existente.tipoLogin === 'usuario_clave') {
      const otro = buscarUsuarioPorNombreDeUsuario(usuarios, cambios.usuario);
      if (otro && otro.id !== usuarioId) {
        return { ok: false, mensaje: 'Ya existe un usuario con ese login', usuarios: [] };
      }
    } else if (existente.tipoLogin === 'google_corporativo') {
      const otro = buscarUsuarioPorEmailCorporativo(usuarios, cambios.email);
      if (otro && otro.id !== usuarioId) {
        return { ok: false, mensaje: 'Ya existe un usuario con ese correo', usuarios: [] };
      }
    }
    const permitidos = prepararActualizacionUsuario(existente, cambios);
    actualizarPorId(libro, 'Usuarios', usuarioId, permitidos);
    return { ok: true, mensaje: 'Comprador actualizado', usuarios: usuariosVisibles() };
  } catch (error) {
    return { ok: false, mensaje: error.message, usuarios: [] };
  }
}

function apiRegistrarFiadoComoAdmin(token, usuarioId, lineas) {
  try {
    exigirAdmin(token);
    validarLineasFiado(lineas);
    const usuarios = leerTodo(obtenerLibro(), 'Usuarios');
    let destino = null;
    for (let i = 0; i < usuarios.length; i++) {
      if (usuarios[i].id === usuarioId && usuarios[i].activo === true) {
        destino = usuarios[i];
        break;
      }
    }
    if (!destino) {
      return { ok: false, mensaje: 'No se encontro el usuario' };
    }
    const transacciones = registrarFiadoMultiple(destino, lineas, 'admin');
    const totalUnidades = transacciones.reduce(function (suma, t) { return suma + t.cantidad; }, 0);
    return {
      ok: true,
      mensaje: 'Registrado a ' + destino.nombre + ': ' + transacciones.length + ' producto(s), ' + totalUnidades + ' unidad(es)'
    };
  } catch (error) {
    return { ok: false, mensaje: error.message };
  }
}

function apiRegistrarPrestamo(token, usuarioId, valor, concepto) {
  try {
    exigirAdmin(token);
    const libro = obtenerLibro();
    const usuarios = leerTodo(libro, 'Usuarios');
    let destino = null;
    for (let i = 0; i < usuarios.length; i++) {
      if (usuarios[i].id === usuarioId && usuarios[i].activo === true) {
        destino = usuarios[i];
        break;
      }
    }
    if (!destino) {
      return { ok: false, mensaje: 'No se encontro el usuario' };
    }
    const prestamo = crearPrestamo({
      id: nuevoId(),
      usuarioId: destino.id,
      valor: Number(valor),
      fecha: ahoraIso(),
      concepto: concepto
    });
    agregarFila(libro, 'Prestamos', prestamo);
    return { ok: true, mensaje: 'Prestamo registrado a ' + destino.nombre };
  } catch (error) {
    return { ok: false, mensaje: error.message };
  }
}

function apiAnularPrestamo(token, prestamoId, motivo) {
  try {
    const admin = exigirAdmin(token);
    const libro = obtenerLibro();
    const prestamos = leerTodo(libro, 'Prestamos');
    let original = null;
    for (let i = 0; i < prestamos.length; i++) {
      if (prestamos[i].id === prestamoId) {
        original = prestamos[i];
        break;
      }
    }
    if (!original) {
      return { ok: false, mensaje: 'No se encontro el prestamo' };
    }
    const anulado = anularRegistro(original, {
      anuladoPor: admin.nombre,
      anuladoFecha: ahoraIso(),
      anuladoMotivo: motivo
    });
    actualizarPorId(libro, 'Prestamos', prestamoId, {
      estado: anulado.estado,
      anuladoPor: anulado.anuladoPor,
      anuladoFecha: anulado.anuladoFecha,
      anuladoMotivo: anulado.anuladoMotivo
    });
    return { ok: true, mensaje: 'Prestamo anulado' };
  } catch (error) {
    return { ok: false, mensaje: error.message };
  }
}

function apiRegistrarPerdida(token, productoId, cantidad, motivo) {
  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(30000);
  try {
    exigirAdmin(token);
    const libro = obtenerLibro();
    const productos = leerTodo(libro, 'Productos');
    let producto = null;
    for (let i = 0; i < productos.length; i++) {
      if (productos[i].id === productoId) {
        producto = productos[i];
        break;
      }
    }
    if (!producto || producto.activo !== true) {
      return { ok: false, mensaje: 'El producto no existe o esta inactivo', productos: [] };
    }
    const consumo = consumirDeLotes(leerTodo(libro, 'Lotes'), producto.id, Number(cantidad), producto.nombre, producto.precioVenta);
    const perdida = crearPerdida({
      id: nuevoId(),
      producto: producto,
      cantidad: Number(cantidad),
      motivo: motivo,
      fecha: ahoraIso(),
      consumo: consumo
    });
    const actualizado = descontarStock(producto, Number(cantidad));
    agregarFila(libro, 'Perdidas', perdida);
    consumo.lotesActualizados.forEach(function (lote) {
      actualizarPorId(libro, 'Lotes', lote.id, { cantidadRestante: lote.cantidadRestante });
    });
    actualizarPorId(libro, 'Productos', producto.id, { stockActual: actualizado.stockActual });
    return { ok: true, mensaje: 'Perdida registrada: ' + perdida.cantidad + ' x ' + perdida.productoNombre, productos: productosVisibles() };
  } catch (error) {
    return { ok: false, mensaje: error.message, productos: [] };
  } finally {
    bloqueo.releaseLock();
  }
}

function apiAnularPerdida(token, perdidaId, motivo) {
  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(30000);
  try {
    const admin = exigirAdmin(token);
    const libro = obtenerLibro();
    const perdidas = leerTodo(libro, 'Perdidas');
    let original = null;
    for (let i = 0; i < perdidas.length; i++) {
      if (perdidas[i].id === perdidaId) {
        original = perdidas[i];
        break;
      }
    }
    if (!original) {
      return { ok: false, mensaje: 'No se encontro la perdida', productos: [] };
    }
    const anulado = anularRegistro(original, {
      anuladoPor: admin.nombre,
      anuladoFecha: ahoraIso(),
      anuladoMotivo: motivo
    });
    actualizarPorId(libro, 'Perdidas', perdidaId, {
      estado: anulado.estado,
      anuladoPor: anulado.anuladoPor,
      anuladoFecha: anulado.anuladoFecha,
      anuladoMotivo: anulado.anuladoMotivo
    });
    const consumosPerdida = original.lotesConsumidos ? JSON.parse(original.lotesConsumidos) : [];
    devolverALotes(leerTodo(libro, 'Lotes'), consumosPerdida).forEach(function (lote) {
      actualizarPorId(libro, 'Lotes', lote.id, { cantidadRestante: lote.cantidadRestante });
    });
    const productos = leerTodo(libro, 'Productos');
    for (let j = 0; j < productos.length; j++) {
      if (productos[j].id === original.productoId) {
        actualizarPorId(libro, 'Productos', original.productoId, {
          stockActual: productos[j].stockActual + original.cantidad
        });
        break;
      }
    }
    return { ok: true, mensaje: 'Perdida anulada y stock devuelto', productos: productosVisibles() };
  } catch (error) {
    return { ok: false, mensaje: error.message, productos: [] };
  } finally {
    bloqueo.releaseLock();
  }
}

function apiLeerFactura(token, imagenBase64) {
  try {
    exigirAdmin(token);
    if (!imagenBase64) {
      return { ok: false, mensaje: 'Falta la imagen de la factura', lineas: [] };
    }
    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) {
      return { ok: false, mensaje: 'Falta configurar GEMINI_API_KEY en el proyecto', lineas: [] };
    }
    const prompt = 'Lee esta factura de proveedor y devuelve SOLO un JSON, sin texto ' +
      'alrededor, con esta forma exacta: {"lineas": [{"nombre": "...", "cantidad": 0, ' +
      '"costoUnitario": 0}]}. cantidad y costoUnitario son numeros enteros. Si un dato ' +
      'no es legible, omite esa linea por completo.';
    const respuesta = UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=' + apiKey,
      {
        method: 'post',
        contentType: 'application/json',
        muteHttpExceptions: true,
        payload: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: 'image/jpeg', data: imagenBase64 } }
            ]
          }]
        })
      }
    );
    if (respuesta.getResponseCode() !== 200) {
      return { ok: false, mensaje: 'Gemini no pudo procesar la factura (HTTP ' + respuesta.getResponseCode() + ')', lineas: [] };
    }
    const texto = JSON.parse(respuesta.getContentText()).candidates[0].content.parts[0].text;
    const saneadas = sanearLineas(parsearRespuestaGemini(texto));
    if (saneadas.length === 0) {
      return { ok: false, mensaje: 'No se pudo leer ninguna linea de la factura', lineas: [] };
    }
    const productosActivos = leerTodo(obtenerLibro(), 'Productos').filter(function (p) { return p.activo === true; });
    return { ok: true, mensaje: '', lineas: emparejarLineas(saneadas, productosActivos) };
  } catch (error) {
    return { ok: false, mensaje: 'No se pudo leer la factura: ' + error.message, lineas: [] };
  }
}

function apiConfirmarIngresoInventario(token, lineas) {
  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(30000);
  try {
    const admin = exigirAdmin(token);
    validarLineasParaConfirmar(lineas);
    const libro = obtenerLibro();
    const productos = leerTodo(libro, 'Productos');
    lineas.forEach(function (linea) {
      if (linea.esNuevo && buscarProductoPorNombre(productos, linea.nombre)) {
        throw new Error('Ya existe un producto llamado "' + linea.nombre + '"');
      }
      if (!linea.esNuevo && !productos.some(function (p) { return p.id === linea.productoId && p.activo === true; })) {
        throw new Error('El producto de la linea "' + linea.nombre + '" ya no existe o esta inactivo');
      }
    });
    lineas.forEach(function (linea) {
      if (linea.esNuevo) {
        const id = nuevoId();
        agregarFila(libro, 'Productos', {
          id: id, nombre: linea.nombre, alias: '', categoria: String(linea.categoria).trim(),
          costo: Number(linea.costoUnitario), precioVenta: Number(linea.precioVenta),
          stockActual: Number(linea.cantidad), activo: true, porcentajeAumento: 0
        });
        linea.productoId = id;
        linea.precioVenta = Number(linea.precioVenta);
      } else {
        const producto = productos.filter(function (p) { return p.id === linea.productoId; })[0];
        const precioAnterior = Number(producto.precioVenta);
        linea.precioVenta = Number(linea.precioVenta) || precioAnterior;
        // los lotes viejos sin precio propio conservan el precio que tenian
        guardarPrecioDeLotes(libro, fijarPrecioEnLotesSinPrecio(leerTodo(libro, 'Lotes'), producto.id, precioAnterior));
        producto.stockActual = producto.stockActual + Number(linea.cantidad);
        producto.precioVenta = linea.precioVenta;
        actualizarPorId(libro, 'Productos', producto.id, {
          stockActual: producto.stockActual,
          costo: Number(linea.costoUnitario),
          precioVenta: producto.precioVenta
        });
      }
      const loteId = nuevoId();
      agregarFila(libro, 'Lotes', crearLote({
        id: loteId,
        productoId: linea.productoId,
        fecha: ahoraIso(),
        cantidad: Number(linea.cantidad),
        costoUnitario: Number(linea.costoUnitario),
        precioVenta: linea.precioVenta
      }));
      linea.loteId = loteId;
    });
    const ingreso = crearIngresoInventario({ id: nuevoId(), admin: admin.nombre, lineas: lineas, fecha: ahoraIso() });
    agregarFila(libro, 'IngresosInventario', ingreso);
    return { ok: true, mensaje: 'Factura ingresada al inventario', productos: productosVisibles() };
  } catch (error) {
    return { ok: false, mensaje: error.message, productos: [] };
  } finally {
    bloqueo.releaseLock();
  }
}

function apiAjustarStockSubir(token, productoId, cantidad, costoUnitario, precioVenta) {
  try {
    exigirAdmin(token);
    const producto = leerTodo(obtenerLibro(), 'Productos')
      .filter(function (p) { return p.id === productoId && p.activo === true; })[0];
    if (!producto) {
      return { ok: false, mensaje: 'El producto no existe o esta inactivo', productos: [] };
    }
    return apiConfirmarIngresoInventario(token, [{
      nombre: producto.nombre,
      productoId: producto.id,
      cantidad: Number(cantidad),
      costoUnitario: Number(costoUnitario),
      precioVenta: Number(precioVenta) || '',
      esNuevo: false
    }]);
  } catch (error) {
    return { ok: false, mensaje: error.message, productos: [] };
  }
}

function apiAnularIngresoInventario(token, ingresoId, motivo) {
  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(30000);
  try {
    const admin = exigirAdmin(token);
    const libro = obtenerLibro();
    const ingresos = leerTodo(libro, 'IngresosInventario');
    let original = null;
    for (let i = 0; i < ingresos.length; i++) {
      if (ingresos[i].id === ingresoId) { original = ingresos[i]; break; }
    }
    if (!original) {
      return { ok: false, mensaje: 'No se encontro el ingreso', productos: [] };
    }
    const lineas = JSON.parse(original.lineas);
    const lotes = leerTodo(libro, 'Lotes');
    const lotesDelIngreso = [];
    for (let k = 0; k < lineas.length; k++) {
      const lote = lotes.filter(function (l) { return l.id === lineas[k].loteId; })[0];
      if (!lote) {
        continue;
      }
      if (!puedeAnularseLote(lote)) {
        return { ok: false, mensaje: 'No se puede anular: ya se consumieron unidades de este lote', productos: [] };
      }
      lotesDelIngreso.push(lote);
    }
    const anulado = anularRegistro(original, {
      anuladoPor: admin.nombre, anuladoFecha: ahoraIso(), anuladoMotivo: motivo
    });
    actualizarPorId(libro, 'IngresosInventario', ingresoId, {
      estado: anulado.estado, anuladoPor: anulado.anuladoPor,
      anuladoFecha: anulado.anuladoFecha, anuladoMotivo: anulado.anuladoMotivo
    });
    lotesDelIngreso.forEach(function (lote) {
      const loteAnulado = anularRegistro(lote, {
        anuladoPor: admin.nombre, anuladoFecha: ahoraIso(), anuladoMotivo: motivo
      });
      actualizarPorId(libro, 'Lotes', lote.id, {
        estado: loteAnulado.estado, anuladoPor: loteAnulado.anuladoPor,
        anuladoFecha: loteAnulado.anuladoFecha, anuladoMotivo: loteAnulado.anuladoMotivo
      });
    });
    const productos = leerTodo(libro, 'Productos');
    lineas.forEach(function (linea) {
      const producto = productos.filter(function (p) { return p.id === linea.productoId; })[0];
      if (producto) {
        actualizarPorId(libro, 'Productos', producto.id, { stockActual: producto.stockActual - Number(linea.cantidad) });
      }
    });
    return { ok: true, mensaje: 'Ingreso anulado', productos: productosVisibles() };
  } catch (error) {
    return { ok: false, mensaje: error.message, productos: [] };
  } finally {
    bloqueo.releaseLock();
  }
}

function apiRegistrarGastoCompartido(token, datos) {
  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(30000);
  try {
    exigirAdmin(token);
    const libro = obtenerLibro();
    let producto = null;
    let consumo = null;
    const cantidad = Number(datos.cantidad);
    if (datos.productoId) {
      const productos = leerTodo(libro, 'Productos');
      for (let i = 0; i < productos.length; i++) {
        if (productos[i].id === datos.productoId) {
          producto = productos[i];
          break;
        }
      }
      if (!producto || producto.activo !== true) {
        return { ok: false, mensaje: 'El producto no existe o esta inactivo', productos: [] };
      }
      consumo = consumirDeLotes(leerTodo(libro, 'Lotes'), producto.id, cantidad, producto.nombre, producto.precioVenta);
    }
    const gasto = crearGastoCompartido({
      id: nuevoId(),
      motivo: String(datos.motivo || '').trim(),
      descripcion: datos.descripcion,
      valorTotal: Number(datos.valorTotal),
      participantes: datos.participantes || [],
      fecha: ahoraIso(),
      producto: producto,
      cantidad: cantidad,
      consumo: consumo
    });
    if (producto) {
      const actualizado = descontarStock(producto, cantidad);
      agregarFila(libro, 'GastosCompartidos', gasto);
      consumo.lotesActualizados.forEach(function (lote) {
        actualizarPorId(libro, 'Lotes', lote.id, { cantidadRestante: lote.cantidadRestante });
      });
      actualizarPorId(libro, 'Productos', producto.id, { stockActual: actualizado.stockActual });
    } else {
      agregarFila(libro, 'GastosCompartidos', gasto);
    }
    const cuotas = cuotasDeGasto(gasto);
    return {
      ok: true,
      mensaje: 'Gasto de ' + gasto.valorTotal + ' repartido entre ' + cuotas.length + ' personas',
      productos: productosVisibles()
    };
  } catch (error) {
    return { ok: false, mensaje: error.message, productos: [] };
  } finally {
    bloqueo.releaseLock();
  }
}

function apiAnularGastoCompartido(token, gastoId, motivo) {
  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(30000);
  try {
    const admin = exigirAdmin(token);
    const libro = obtenerLibro();
    const gastos = leerTodo(libro, 'GastosCompartidos');
    let original = null;
    for (let i = 0; i < gastos.length; i++) {
      if (gastos[i].id === gastoId) {
        original = gastos[i];
        break;
      }
    }
    if (!original) {
      return { ok: false, mensaje: 'No se encontro el gasto compartido' };
    }
    const anulado = anularRegistro(original, {
      anuladoPor: admin.nombre,
      anuladoFecha: ahoraIso(),
      anuladoMotivo: motivo
    });
    actualizarPorId(libro, 'GastosCompartidos', gastoId, {
      estado: anulado.estado,
      anuladoPor: anulado.anuladoPor,
      anuladoFecha: anulado.anuladoFecha,
      anuladoMotivo: anulado.anuladoMotivo
    });
    if (original.productoId && original.lotesConsumidos) {
      devolverALotes(leerTodo(libro, 'Lotes'), JSON.parse(original.lotesConsumidos)).forEach(function (lote) {
        actualizarPorId(libro, 'Lotes', lote.id, { cantidadRestante: lote.cantidadRestante });
      });
      const productos = leerTodo(libro, 'Productos');
      for (let j = 0; j < productos.length; j++) {
        if (productos[j].id === original.productoId) {
          actualizarPorId(libro, 'Productos', original.productoId, {
            stockActual: productos[j].stockActual + Number(original.cantidad)
          });
          break;
        }
      }
      return { ok: true, mensaje: 'Gasto anulado, cuotas retiradas y stock devuelto' };
    }
    return { ok: true, mensaje: 'Gasto anulado y cuotas retiradas de los saldos' };
  } catch (error) {
    return { ok: false, mensaje: error.message };
  } finally {
    bloqueo.releaseLock();
  }
}

function apiRegistrarPago(token, usuarioId, valor) {
  try {
    exigirAdmin(token);
    const libro = obtenerLibro();
    const usuarios = leerTodo(libro, 'Usuarios');
    let destino = null;
    for (let i = 0; i < usuarios.length; i++) {
      if (usuarios[i].id === usuarioId && usuarios[i].activo === true) {
        destino = usuarios[i];
        break;
      }
    }
    if (!destino) {
      return { ok: false, mensaje: 'No se encontro el usuario' };
    }
    const pago = crearPago({
      id: nuevoId(),
      usuarioId: destino.id,
      valor: Number(valor),
      aplicadoA: [],
      fecha: ahoraIso()
    });
    agregarFila(libro, 'Pagos', pago);
    return { ok: true, mensaje: 'Abono registrado a ' + destino.nombre };
  } catch (error) {
    return { ok: false, mensaje: error.message };
  }
}

function apiReportes(token, desde, hasta, usuarioId, productoId) {
  try {
    exigirAdmin(token);
    const libro = obtenerLibro();
    const movimientos = leerMovimientos(libro);
    const productos = leerTodo(libro, 'Productos');
    const usuarios = leerTodo(libro, 'Usuarios');
    const perdidas = leerTodo(libro, 'Perdidas');
    const lotes = leerTodo(libro, 'Lotes');
    return {
      ok: true,
      mensaje: '',
      ganancia: reporteGanancia(movimientos.transacciones, productos, desde, hasta, usuarioId),
      perdidas: reportePerdidas(perdidas, desde, hasta),
      cartera: reporteCartera(movimientos, usuarios, usuarioId),
      gastos: reporteGastosCompartidos(movimientos.gastos),
      inventario: reporteInventario(lotes, productos),
      compras: reporteComprasPorProducto(movimientos.transacciones, usuarios, productoId, desde, hasta)
    };
  } catch (error) {
    return {
      ok: false,
      mensaje: error.message,
      ganancia: { total: 0, estimado: false, porProducto: [] },
      perdidas: { total: 0, lineas: [] },
      cartera: { total: 0, porUsuario: [] },
      gastos: [],
      inventario: { valorTotal: 0, porProducto: [] },
      compras: { total: { cantidad: 0, valor: 0 }, porUsuario: [] }
    };
  }
}

function apiAnularPago(token, pagoId, motivo) {
  try {
    const admin = exigirAdmin(token);
    const libro = obtenerLibro();
    const pagos = leerTodo(libro, 'Pagos');
    let original = null;
    for (let i = 0; i < pagos.length; i++) {
      if (pagos[i].id === pagoId) {
        original = pagos[i];
        break;
      }
    }
    if (!original) {
      return { ok: false, mensaje: 'No se encontro el abono' };
    }
    const anulado = anularRegistro(original, {
      anuladoPor: admin.nombre,
      anuladoFecha: ahoraIso(),
      anuladoMotivo: motivo
    });
    actualizarPorId(libro, 'Pagos', pagoId, {
      estado: anulado.estado,
      anuladoPor: anulado.anuladoPor,
      anuladoFecha: anulado.anuladoFecha,
      anuladoMotivo: anulado.anuladoMotivo
    });
    return { ok: true, mensaje: 'Abono anulado' };
  } catch (error) {
    return { ok: false, mensaje: error.message };
  }
}

function apiListarMovimientosRecientes(token, usuarioId) {
  try {
    exigirAdmin(token);
    const libro = obtenerLibro();
    const nombrePorId = {};
    leerTodo(libro, 'Usuarios').forEach(function (usuario) {
      nombrePorId[usuario.id] = usuario.nombre;
    });
    const movimientos = [];

    leerTodo(libro, 'Transacciones').forEach(function (registro) {
      movimientos.push({
        id: registro.id, tipo: 'transaccion', fecha: registro.fecha,
        usuarioId: registro.usuarioId,
        quien: nombrePorId[registro.usuarioId] || registro.usuarioId,
        concepto: registro.productoNombre + ' x' + registro.cantidad,
        valor: registro.valorTotal, estado: registro.estado
      });
    });

    leerTodo(libro, 'Prestamos').forEach(function (registro) {
      movimientos.push({
        id: registro.id, tipo: 'prestamo', fecha: registro.fecha,
        usuarioId: registro.usuarioId,
        quien: nombrePorId[registro.usuarioId] || registro.usuarioId,
        concepto: registro.concepto || 'Prestamo en efectivo',
        valor: registro.valor, estado: registro.estado
      });
    });

    leerTodo(libro, 'Pagos').forEach(function (registro) {
      movimientos.push({
        id: registro.id, tipo: 'pago', fecha: registro.fecha,
        usuarioId: registro.usuarioId,
        quien: nombrePorId[registro.usuarioId] || registro.usuarioId,
        concepto: 'Abono',
        valor: -registro.valor, estado: registro.estado
      });
    });

    leerTodo(libro, 'Perdidas').forEach(function (registro) {
      movimientos.push({
        id: registro.id, tipo: 'perdida', fecha: registro.fecha,
        usuarioId: null,
        quien: '-',
        concepto: 'Perdida de ' + registro.productoNombre + ' x' + registro.cantidad + ' (' + registro.motivo + ')',
        valor: registro.valor, estado: registro.estado
      });
    });

    leerTodo(libro, 'GastosCompartidos').forEach(function (registro) {
      const idsParticipantes = participantesDe(registro);
      const partes = repartirEntre(registro.valorTotal, idsParticipantes.length);
      idsParticipantes.forEach(function (participanteId, indice) {
        movimientos.push({
          id: registro.id, tipo: 'gasto', fecha: registro.fecha,
          usuarioId: participanteId,
          quien: nombrePorId[participanteId] || participanteId,
          concepto: 'Gasto ' + registro.motivo +
            (registro.productoNombre ? ' (' + registro.productoNombre + ' x' + registro.cantidad + ')' : '') +
            (registro.descripcion ? ': ' + registro.descripcion : ''),
          valor: partes[indice], estado: registro.estado
        });
      });
    });

    leerTodo(libro, 'IngresosInventario').forEach(function (registro) {
      const lineas = JSON.parse(registro.lineas || '[]');
      movimientos.push({
        id: registro.id, tipo: 'ingreso', fecha: registro.fecha,
        usuarioId: null,
        quien: registro.admin || '-',
        concepto: 'Ingreso de factura: ' + lineas.length + ' producto(s)',
        valor: lineas.reduce(function (suma, l) { return suma + l.cantidad * l.costoUnitario; }, 0),
        estado: registro.estado
      });
    });

    const filtrados = usuarioId
      ? movimientos.filter(function (m) { return m.usuarioId === usuarioId; })
      : movimientos;
    filtrados.sort(function (a, b) { return String(b.fecha).localeCompare(String(a.fecha)); });
    return { ok: true, mensaje: '', movimientos: filtrados.slice(0, 50) };
  } catch (error) {
    return { ok: false, mensaje: error.message, movimientos: [] };
  }
}

function apiAnularMovimiento(token, tipo, movimientoId, motivo) {
  if (tipo === 'transaccion') { return apiAnularTransaccion(token, movimientoId, motivo); }
  if (tipo === 'prestamo') { return apiAnularPrestamo(token, movimientoId, motivo); }
  if (tipo === 'pago') { return apiAnularPago(token, movimientoId, motivo); }
  if (tipo === 'perdida') { return apiAnularPerdida(token, movimientoId, motivo); }
  if (tipo === 'gasto') { return apiAnularGastoCompartido(token, movimientoId, motivo); }
  if (tipo === 'ingreso') { return apiAnularIngresoInventario(token, movimientoId, motivo); }
  return { ok: false, mensaje: 'Tipo de movimiento desconocido: ' + tipo };
}

function apiAnularTransaccion(token, transaccionId, motivo) {
  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(30000);
  try {
    const admin = exigirAdmin(token);
    const libro = obtenerLibro();
    const transacciones = leerTodo(libro, 'Transacciones');
    let original = null;
    for (let i = 0; i < transacciones.length; i++) {
      if (transacciones[i].id === transaccionId) {
        original = transacciones[i];
        break;
      }
    }
    if (!original) {
      return { ok: false, mensaje: 'No se encontro la transaccion' };
    }
    const anulada = anularTransaccion(original, {
      anuladoPor: admin.nombre,
      anuladoFecha: ahoraIso(),
      anuladoMotivo: motivo
    });
    actualizarPorId(libro, 'Transacciones', transaccionId, {
      estado: anulada.estado,
      anuladoPor: anulada.anuladoPor,
      anuladoFecha: anulada.anuladoFecha,
      anuladoMotivo: anulada.anuladoMotivo
    });
    const consumosTransaccion = original.lotesConsumidos ? JSON.parse(original.lotesConsumidos) : [];
    devolverALotes(leerTodo(libro, 'Lotes'), consumosTransaccion).forEach(function (lote) {
      actualizarPorId(libro, 'Lotes', lote.id, { cantidadRestante: lote.cantidadRestante });
    });
    const productos = leerTodo(libro, 'Productos');
    for (let j = 0; j < productos.length; j++) {
      if (productos[j].id === original.productoId) {
        actualizarPorId(libro, 'Productos', original.productoId, {
          stockActual: productos[j].stockActual + original.cantidad
        });
        break;
      }
    }
    return { ok: true, mensaje: 'Movimiento anulado y stock devuelto' };
  } catch (error) {
    return { ok: false, mensaje: error.message };
  } finally {
    bloqueo.releaseLock();
  }
}

function configurarInicial() {
  const libro = obtenerLibro();
  inicializarLibro(libro);
  const email = Session.getEffectiveUser().getEmail();
  const usuarios = leerTodo(libro, 'Usuarios');
  if (resolverUsuarioPorEmail(usuarios, email)) {
    return 'El libro ya estaba inicializado y el admin ya existe: ' + email;
  }
  agregarFila(libro, 'Usuarios', {
    id: nuevoId(),
    nombre: 'Administrador',
    area: 'Sistemas',
    rol: 'admin',
    tipoLogin: 'google_corporativo',
    emailCorporativo: email,
    usuario: '',
    salt: '',
    claveHash: '',
    esPseudoUsuario: false,
    activo: true
  });
  return 'Libro inicializado y admin creado para ' + email;
}
