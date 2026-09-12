const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const {
  hashClave, verificarClave, resolverUsuarioPorEmail, resolverUsuarioPorClave, esAdmin
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
