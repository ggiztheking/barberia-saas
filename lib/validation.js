const normalizePhone = (value) => {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `52${digits}`;
  return digits;
};

const sanitizeText = (value, maxLength = 80) => String(value ?? '').trim().slice(0, maxLength);

const validateSlug = (value) => {
  const slug = String(value ?? '').trim().toLowerCase();
  if (!/^[a-z0-9-]{3,30}$/.test(slug)) return false;
  return !['api', 'registro', 'img', 'health', 'admin', 'agenda', 'super', 'manifest'].includes(slug);
};

const isValidDateString = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''));
const isValidHour = (value) => /^\d{2}:\d{2}$/.test(String(value ?? ''));

const normalizeBarberList = (value) =>
  String(value ?? '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)
    .slice(0, 30);

module.exports = {
  normalizePhone,
  sanitizeText,
  validateSlug,
  isValidDateString,
  isValidHour,
  normalizeBarberList,
};
