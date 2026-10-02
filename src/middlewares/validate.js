const ApiError = require('../utils/ApiError');

// validate(schemaZod) : valide req.body et remplace par la version nettoyee
const validate = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    return next(new ApiError(400, 'Donnees invalides', details));
  }
  req.body = result.data;
  next();
};

module.exports = validate;
