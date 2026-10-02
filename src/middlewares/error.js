const env = require('../config/env');

const notFound = (req, _res, next) => {
  const err = new Error(`Route introuvable : ${req.method} ${req.originalUrl}`);
  err.status = 404;
  next(err);
};

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, _req, res, _next) => {
  let status = err.status || 500;
  let message = err.message || 'Erreur serveur';

  if (err.code === 11000) {
    status = 409;
    const field = Object.keys(err.keyPattern || {})[0] || 'champ';
    message = `Valeur deja utilisee pour : ${field}`;
  }
  if (err.name === 'CastError') {
    status = 400;
    message = 'Identifiant invalide';
  }
  if (err.name === 'ValidationError') {
    status = 400;
    message = Object.values(err.errors).map((e) => e.message).join(', ');
  }

  if (status >= 500) console.error('[VELOX] Erreur :', err);

  res.status(status).json({
    success: false,
    message,
    ...(err.details ? { details: err.details } : {}),
    ...(env.NODE_ENV === 'development' && status >= 500 ? { stack: err.stack } : {}),
  });
};

module.exports = { notFound, errorHandler };
