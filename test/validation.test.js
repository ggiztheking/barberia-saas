const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePhone,
  sanitizeText,
  validateSlug,
  isValidDateString,
  isValidHour,
  normalizeBarberList,
} = require('../lib/validation');

test('normaliza telefonos a formato local de México', () => {
  assert.equal(normalizePhone('9991234567'), '529991234567');
  assert.equal(normalizePhone('52 999 123 4567'), '529991234567');
  assert.equal(normalizePhone(''), '');
});

test('sanitiza textos cortando longitud y espacios', () => {
  assert.equal(sanitizeText('   Pedro     ', 20), 'Pedro');
  assert.equal(sanitizeText('abcdef', 3), 'abc');
});

test('valida slugs de negocio', () => {
  assert.equal(validateSlug('mi-barberia'), true);
  assert.equal(validateSlug('admin'), false);
  assert.equal(validateSlug('ab'), false);
});

test('valida fechas y horas', () => {
  assert.equal(isValidDateString('2026-10-03'), true);
  assert.equal(isValidDateString('03-10-2026'), false);
  assert.equal(isValidHour('10:30'), true);
  assert.equal(isValidHour('25:99'), false);
});

test('normaliza la lista de barberos', () => {
  assert.deepEqual(normalizeBarberList('Pedro, Ana , Carlos'), ['Pedro', 'Ana', 'Carlos']);
  assert.deepEqual(normalizeBarberList(''), []);
});
