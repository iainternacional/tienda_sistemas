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
  return leerTodo(obtenerLibro(), 'Productos')
    .filter(function (producto) { return producto.activo === true; })
    .map(function (producto) {
      return {
        id: producto.id,
        nombre: producto.nombre,
        alias: producto.alias,
        categoria: producto.categoria,
        precioVenta: producto.precioVenta,
        stockActual: producto.stockActual
      };
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

function estadoDeUsuario(usuario) {
  const movimientos = leerMovimientos(obtenerLibro());
  return {
    autenticado: true,
    nombre: usuario.nombre,
    rol: usuario.rol,
    saldo: calcularSaldoUsuario(movimientos, usuario.id),
    desglose: desglosarSaldoUsuario(movimientos, usuario.id),
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

function apiObtenerEstado(token) {
  const usuario = usuarioDeSesion(token);
  if (!usuario) {
    return {
      autenticado: false, nombre: '', rol: '', saldo: 0,
      desglose: [], productos: [], mensaje: 'Inicie sesion para continuar'
    };
  }
  return estadoDeUsuario(usuario);
}

function registrarFiado(usuario, productoId, cantidad, origen) {
  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(30000);
  try {
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
      throw new Error('El producto no existe o esta inactivo');
    }
    const transaccion = crearTransaccionFiado({
      id: nuevoId(),
      usuarioId: usuario.id,
      producto: producto,
      cantidad: cantidad,
      fecha: ahoraIso(),
      origen: origen
    });
    const actualizado = descontarStock(producto, cantidad);
    agregarFila(libro, 'Transacciones', transaccion);
    actualizarPorId(libro, 'Productos', producto.id, { stockActual: actualizado.stockActual });
    return transaccion;
  } finally {
    bloqueo.releaseLock();
  }
}

function apiRegistrarFiado(token, productoId, cantidad) {
  try {
    const usuario = exigirUsuario(token);
    const transaccion = registrarFiado(usuario, productoId, Number(cantidad), 'autoregistro');
    const estado = estadoDeUsuario(usuario);
    estado.ok = true;
    estado.mensaje = 'Registrado: ' + transaccion.cantidad + ' x ' + transaccion.productoNombre;
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
    agregarFila(libro, 'Productos', {
      id: nuevoId(),
      nombre: normalizados.nombre,
      alias: normalizados.alias,
      categoria: normalizados.categoria,
      costo: normalizados.costo,
      precioVenta: normalizados.precioVenta,
      stockActual: normalizados.stockActual,
      activo: true,
      porcentajeAumento: normalizados.porcentajeAumento
    });
    return { ok: true, mensaje: 'Producto creado', productos: productosVisibles() };
  } catch (error) {
    return { ok: false, mensaje: error.message, productos: [] };
  }
}

function apiActualizarProducto(token, productoId, cambios) {
  try {
    exigirAdmin(token);
    const permitidos = {};
    ['nombre', 'categoria', 'costo', 'precioVenta', 'stockActual', 'activo'].forEach(function (campo) {
      if (cambios[campo] !== undefined && cambios[campo] !== null && cambios[campo] !== '') {
        permitidos[campo] = campo === 'nombre' || campo === 'categoria'
          ? String(cambios[campo]).trim()
          : (campo === 'activo' ? cambios[campo] === true : Number(cambios[campo]));
      }
    });
    const encontrado = actualizarPorId(obtenerLibro(), 'Productos', productoId, permitidos);
    if (!encontrado) {
      return { ok: false, mensaje: 'No se encontro el producto', productos: [] };
    }
    return { ok: true, mensaje: 'Producto actualizado', productos: productosVisibles() };
  } catch (error) {
    return { ok: false, mensaje: error.message, productos: [] };
  }
}

function usuariosVisibles() {
  return leerTodo(obtenerLibro(), 'Usuarios')
    .filter(function (usuario) { return usuario.activo === true; })
    .map(function (usuario) {
      return { id: usuario.id, nombre: usuario.nombre, esPseudoUsuario: usuario.esPseudoUsuario === true };
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

function apiRegistrarFiadoComoAdmin(token, usuarioId, productoId, cantidad) {
  try {
    exigirAdmin(token);
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
    const transaccion = registrarFiado(destino, productoId, Number(cantidad), 'admin');
    return { ok: true, mensaje: 'Registrado a ' + destino.nombre + ': ' + transaccion.cantidad + ' x ' + transaccion.productoNombre };
  } catch (error) {
    return { ok: false, mensaje: error.message };
  }
}

function apiRegistrarPrestamo(token, usuarioId, valor) {
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
      fecha: ahoraIso()
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
    const perdida = crearPerdida({
      id: nuevoId(),
      producto: producto,
      cantidad: Number(cantidad),
      motivo: motivo,
      fecha: ahoraIso()
    });
    const actualizado = descontarStock(producto, Number(cantidad));
    agregarFila(libro, 'Perdidas', perdida);
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

function apiRegistrarGastoCompartido(token, datos) {
  try {
    exigirAdmin(token);
    const libro = obtenerLibro();
    const gasto = crearGastoCompartido({
      id: nuevoId(),
      motivo: String(datos.motivo || '').trim(),
      descripcion: datos.descripcion,
      valorTotal: Number(datos.valorTotal),
      participantes: datos.participantes || [],
      fecha: ahoraIso()
    });
    agregarFila(libro, 'GastosCompartidos', gasto);
    const cuotas = cuotasDeGasto(gasto);
    return {
      ok: true,
      mensaje: 'Gasto repartido entre ' + cuotas.length + ' personas'
    };
  } catch (error) {
    return { ok: false, mensaje: error.message };
  }
}

function apiAnularGastoCompartido(token, gastoId, motivo) {
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
    return { ok: true, mensaje: 'Gasto anulado y cuotas retiradas de los saldos' };
  } catch (error) {
    return { ok: false, mensaje: error.message };
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

function apiReportes(token, desde, hasta) {
  try {
    exigirAdmin(token);
    const libro = obtenerLibro();
    const movimientos = leerMovimientos(libro);
    const productos = leerTodo(libro, 'Productos');
    const usuarios = leerTodo(libro, 'Usuarios');
    const perdidas = leerTodo(libro, 'Perdidas');
    return {
      ok: true,
      mensaje: '',
      ganancia: reporteGanancia(movimientos.transacciones, productos, desde, hasta),
      perdidas: reportePerdidas(perdidas, desde, hasta),
      cartera: reporteCartera(movimientos, usuarios),
      gastos: reporteGastosCompartidos(movimientos.gastos)
    };
  } catch (error) {
    return {
      ok: false,
      mensaje: error.message,
      ganancia: { total: 0, estimado: false, porProducto: [] },
      perdidas: { total: 0, lineas: [] },
      cartera: { total: 0, porUsuario: [] },
      gastos: []
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

function apiListarMovimientosRecientes(token) {
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
        quien: nombrePorId[registro.usuarioId] || registro.usuarioId,
        concepto: registro.productoNombre + ' x' + registro.cantidad,
        valor: registro.valorTotal, estado: registro.estado
      });
    });

    leerTodo(libro, 'Prestamos').forEach(function (registro) {
      movimientos.push({
        id: registro.id, tipo: 'prestamo', fecha: registro.fecha,
        quien: nombrePorId[registro.usuarioId] || registro.usuarioId,
        concepto: 'Prestamo en efectivo',
        valor: registro.valor, estado: registro.estado
      });
    });

    leerTodo(libro, 'Pagos').forEach(function (registro) {
      movimientos.push({
        id: registro.id, tipo: 'pago', fecha: registro.fecha,
        quien: nombrePorId[registro.usuarioId] || registro.usuarioId,
        concepto: 'Abono',
        valor: -registro.valor, estado: registro.estado
      });
    });

    leerTodo(libro, 'Perdidas').forEach(function (registro) {
      movimientos.push({
        id: registro.id, tipo: 'perdida', fecha: registro.fecha,
        quien: '-',
        concepto: 'Perdida de ' + registro.productoNombre + ' x' + registro.cantidad + ' (' + registro.motivo + ')',
        valor: registro.valor, estado: registro.estado
      });
    });

    leerTodo(libro, 'GastosCompartidos').forEach(function (registro) {
      movimientos.push({
        id: registro.id, tipo: 'gasto', fecha: registro.fecha,
        quien: '-',
        concepto: 'Gasto ' + registro.motivo + (registro.descripcion ? ': ' + registro.descripcion : ''),
        valor: registro.valorTotal, estado: registro.estado
      });
    });

    movimientos.sort(function (a, b) { return String(b.fecha).localeCompare(String(a.fecha)); });
    return { ok: true, mensaje: '', movimientos: movimientos.slice(0, 50) };
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
