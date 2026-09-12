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
        categoria: producto.categoria,
        precioVenta: producto.precioVenta,
        stockActual: producto.stockActual
      };
    });
}

function estadoDeUsuario(usuario) {
  const transacciones = leerTodo(obtenerLibro(), 'Transacciones');
  return {
    autenticado: true,
    nombre: usuario.nombre,
    rol: usuario.rol,
    saldo: calcularSaldoUsuario(transacciones, usuario.id),
    desglose: desglosarSaldoUsuario(transacciones, usuario.id),
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
      categoria: String(datos.categoria || '').trim(),
      costo: Number(datos.costo),
      precioVenta: Number(datos.precioVenta),
      stockActual: Number(datos.stockActual)
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
      categoria: normalizados.categoria,
      costo: normalizados.costo,
      precioVenta: normalizados.precioVenta,
      stockActual: normalizados.stockActual,
      activo: true
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

function apiListarUsuarios(token) {
  try {
    exigirAdmin(token);
    const usuarios = leerTodo(obtenerLibro(), 'Usuarios')
      .filter(function (usuario) { return usuario.activo === true; })
      .map(function (usuario) {
        return { id: usuario.id, nombre: usuario.nombre, esPseudoUsuario: usuario.esPseudoUsuario === true };
      });
    return { ok: true, mensaje: '', usuarios: usuarios };
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

function apiListarTransaccionesRecientes(token) {
  try {
    exigirAdmin(token);
    const usuarios = leerTodo(obtenerLibro(), 'Usuarios');
    const nombrePorId = {};
    usuarios.forEach(function (usuario) { nombrePorId[usuario.id] = usuario.nombre; });
    const transacciones = leerTodo(obtenerLibro(), 'Transacciones')
      .sort(function (a, b) { return String(b.fecha).localeCompare(String(a.fecha)); })
      .slice(0, 50)
      .map(function (transaccion) {
        return {
          id: transaccion.id,
          fecha: transaccion.fecha,
          usuario: nombrePorId[transaccion.usuarioId] || transaccion.usuarioId,
          concepto: transaccion.productoNombre,
          cantidad: transaccion.cantidad,
          valorTotal: transaccion.valorTotal,
          origen: transaccion.origen,
          estado: transaccion.estado
        };
      });
    return { ok: true, mensaje: '', transacciones: transacciones };
  } catch (error) {
    return { ok: false, mensaje: error.message, transacciones: [] };
  }
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
