const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const {
  hashClave, verificarClave, resolverUsuarioPorEmail, resolverUsuarioPorClave, esAdmin,
  validarUsuarioNuevo, crearUsuarioComprador, buscarUsuarioPorNombreDeUsuario
} = require('../../src/dominio/auth.js');

function hashDePrueba(texto) {
  return crypto.createHash('sha256').update(texto, 'utf8').digest('hex');
}

const USUARIOS = [
  {
    id: 'u1', nombre: 'Andres', area: 'Sistemas', rol: 'admin',
    tipoLogin: 'google_corporativo', emailCorporativo: 'andres.puerta@ipuc.org.co',
    usuario: '', salt: '', claveHash: '', esPseudoUsuario: false, activo: true
  },
  {
    id: 'u2', nombre: 'Maria', area: 'Sistemas', rol: 'comprador',
    tipoLogin: 'usuario_clave', emailCorporativo: '',
    usuario: 'maria', salt: 'sal123', claveHash: hashDePrueba('sal123:secreta'),
    esPseudoUsuario: false, activo: true
  },
  {
    id: 'u3', nombre: 'Pedro', area: 'Sistemas', rol: 'comprador',
    tipoLogin: 'google_corporativo', emailCorporativo: 'pedro@ipuc.org.co',
    usuario: '', salt: '', claveHash: '', esPseudoUsuario: false, activo: false
  },
  {
    id: 'u4', nombre: 'Perdidas', area: 'Sistemas', rol: 'comprador',
    tipoLogin: '', emailCorporativo: '', usuario: '', salt: '', claveHash: '',
    esPseudoUsuario: true, activo: true
  }
];

test('hashClave combina salt y clave de forma estable', () => {
  assert.strictEqual(hashClave('secreta', 'sal123', hashDePrueba), hashDePrueba('sal123:secreta'));
});

test('hashClave cambia si cambia el salt', () => {
  assert.notStrictEqual(hashClave('secreta', 'sal123', hashDePrueba), hashClave('secreta', 'otra', hashDePrueba));
});

test('verificarClave acepta la clave correcta y rechaza la incorrecta', () => {
  const hash = hashClave('secreta', 'sal123', hashDePrueba);
  assert.strictEqual(verificarClave('secreta', 'sal123', hash, hashDePrueba), true);
  assert.strictEqual(verificarClave('otra', 'sal123', hash, hashDePrueba), false);
});

test('resolverUsuarioPorEmail encuentra ignorando mayusculas y espacios', () => {
  assert.strictEqual(resolverUsuarioPorEmail(USUARIOS, '  ANDRES.PUERTA@ipuc.org.co ').id, 'u1');
});

test('resolverUsuarioPorEmail devuelve null si el email viene vacio', () => {
  assert.strictEqual(resolverUsuarioPorEmail(USUARIOS, ''), null);
});

test('resolverUsuarioPorEmail ignora usuarios inactivos', () => {
  assert.strictEqual(resolverUsuarioPorEmail(USUARIOS, 'pedro@ipuc.org.co'), null);
});

test('resolverUsuarioPorEmail ignora pseudo usuarios', () => {
  const conPseudoEmail = USUARIOS.map(u => u.id === 'u4' ? Object.assign({}, u, { emailCorporativo: 'perdidas@ipuc.org.co' }) : u);
  assert.strictEqual(resolverUsuarioPorEmail(conPseudoEmail, 'perdidas@ipuc.org.co'), null);
});

test('resolverUsuarioPorClave devuelve el usuario con la clave correcta', () => {
  assert.strictEqual(resolverUsuarioPorClave(USUARIOS, 'maria', 'secreta', hashDePrueba).id, 'u2');
});

test('resolverUsuarioPorClave devuelve null con clave incorrecta', () => {
  assert.strictEqual(resolverUsuarioPorClave(USUARIOS, 'maria', 'incorrecta', hashDePrueba), null);
});

test('resolverUsuarioPorClave devuelve null con usuario inexistente', () => {
  assert.strictEqual(resolverUsuarioPorClave(USUARIOS, 'nadie', 'secreta', hashDePrueba), null);
});

test('esAdmin solo es cierto para el rol admin', () => {
  assert.strictEqual(esAdmin(USUARIOS[0]), true);
  assert.strictEqual(esAdmin(USUARIOS[1]), false);
  assert.strictEqual(esAdmin(null), false);
});

const DATOS_VALIDOS = {
  id: 'u9', nombre: 'Juan Perez', area: 'Contabilidad',
  usuario: 'juan.perez', clave: 'secreta', salt: 'sal999'
};

test('validarUsuarioNuevo acepta datos completos', () => {
  assert.strictEqual(validarUsuarioNuevo(DATOS_VALIDOS).valido, true);
});

test('validarUsuarioNuevo exige el nombre', () => {
  const resultado = validarUsuarioNuevo(Object.assign({}, DATOS_VALIDOS, { nombre: '   ' }));
  assert.strictEqual(resultado.valido, false);
  assert.match(resultado.errores.join('. '), /nombre/i);
});

test('validarUsuarioNuevo exige el usuario', () => {
  const resultado = validarUsuarioNuevo(Object.assign({}, DATOS_VALIDOS, { usuario: '' }));
  assert.strictEqual(resultado.valido, false);
  assert.match(resultado.errores.join('. '), /usuario/i);
});

test('validarUsuarioNuevo rechaza usuario con espacios', () => {
  const resultado = validarUsuarioNuevo(Object.assign({}, DATOS_VALIDOS, { usuario: 'juan perez' }));
  assert.strictEqual(resultado.valido, false);
});

test('validarUsuarioNuevo rechaza usuario de menos de tres caracteres', () => {
  assert.strictEqual(validarUsuarioNuevo(Object.assign({}, DATOS_VALIDOS, { usuario: 'ab' })).valido, false);
});

test('validarUsuarioNuevo rechaza clave de menos de cuatro caracteres', () => {
  const resultado = validarUsuarioNuevo(Object.assign({}, DATOS_VALIDOS, { clave: '123' }));
  assert.strictEqual(resultado.valido, false);
  assert.match(resultado.errores.join('. '), /clave/i);
});

test('crearUsuarioComprador arma un comprador con login de usuario y clave', () => {
  const creado = crearUsuarioComprador(DATOS_VALIDOS, hashDePrueba);
  assert.strictEqual(creado.id, 'u9');
  assert.strictEqual(creado.nombre, 'Juan Perez');
  assert.strictEqual(creado.area, 'Contabilidad');
  assert.strictEqual(creado.rol, 'comprador');
  assert.strictEqual(creado.tipoLogin, 'usuario_clave');
  assert.strictEqual(creado.emailCorporativo, '');
  assert.strictEqual(creado.esPseudoUsuario, false);
  assert.strictEqual(creado.activo, true);
});

test('crearUsuarioComprador guarda la clave como hash verificable, nunca en texto plano', () => {
  const creado = crearUsuarioComprador(DATOS_VALIDOS, hashDePrueba);
  assert.strictEqual(creado.clave, undefined);
  assert.notStrictEqual(creado.claveHash, 'secreta');
  assert.strictEqual(verificarClave('secreta', creado.salt, creado.claveHash, hashDePrueba), true);
  assert.strictEqual(verificarClave('otra', creado.salt, creado.claveHash, hashDePrueba), false);
});

test('el comprador recien creado puede iniciar sesion con su clave', () => {
  const creado = crearUsuarioComprador(DATOS_VALIDOS, hashDePrueba);
  const padron = USUARIOS.concat([creado]);
  assert.strictEqual(resolverUsuarioPorClave(padron, 'juan.perez', 'secreta', hashDePrueba).id, 'u9');
  assert.strictEqual(resolverUsuarioPorClave(padron, 'juan.perez', 'incorrecta', hashDePrueba), null);
});

test('crearUsuarioComprador normaliza el usuario y recorta el nombre', () => {
  const creado = crearUsuarioComprador(
    Object.assign({}, DATOS_VALIDOS, { usuario: '  JUAN.PEREZ ', nombre: '  Juan Perez  ' }),
    hashDePrueba
  );
  assert.strictEqual(creado.usuario, 'juan.perez');
  assert.strictEqual(creado.nombre, 'Juan Perez');
});

test('crearUsuarioComprador falla si los datos no son validos', () => {
  assert.throws(
    () => crearUsuarioComprador(Object.assign({}, DATOS_VALIDOS, { clave: '1' }), hashDePrueba),
    /clave/i
  );
});

test('buscarUsuarioPorNombreDeUsuario encuentra ignorando mayusculas y espacios', () => {
  assert.strictEqual(buscarUsuarioPorNombreDeUsuario(USUARIOS, '  MARIA ').id, 'u2');
});

test('buscarUsuarioPorNombreDeUsuario tambien encuentra inactivos para no reciclar logins', () => {
  const conInactivo = USUARIOS.concat([
    { id: 'u5', nombre: 'Ana', usuario: 'ana', salt: 's', claveHash: 'h', esPseudoUsuario: false, activo: false }
  ]);
  assert.strictEqual(buscarUsuarioPorNombreDeUsuario(conInactivo, 'ana').id, 'u5');
});

test('buscarUsuarioPorNombreDeUsuario devuelve null si no existe o viene vacio', () => {
  assert.strictEqual(buscarUsuarioPorNombreDeUsuario(USUARIOS, 'nadie'), null);
  assert.strictEqual(buscarUsuarioPorNombreDeUsuario(USUARIOS, ''), null);
});
