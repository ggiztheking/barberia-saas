const jwt = require('jsonwebtoken');
const { config } = require('./config');

const createAdminToken = (slug, businessId) => jwt.sign(
  { slug, businessId, role: 'admin' },
  config.JWT_SECRET,
  { expiresIn: config.JWT_EXPIRES_IN }
);

const verifyAdminToken = (token) => {
  if (!token) return null;
  try {
    return jwt.verify(token, config.JWT_SECRET);
  } catch (error) {
    return null;
  }
};

module.exports = { createAdminToken, verifyAdminToken };
