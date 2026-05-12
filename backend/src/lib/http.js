function sendSuccess(res, { status = 200, message, data, ...rest } = {}) {
  const payload = { success: true };
  if (message) payload.message = message;
  if (data !== undefined) payload.data = data;
  return res.status(status).json({ ...payload, ...rest });
}

function sendError(res, { status = 500, message, error, ...rest } = {}) {
  const payload = { success: false, message };
  if (error) payload.error = error;
  return res.status(status).json({ ...payload, ...rest });
}

function isSchemaError(error) {
  return error && (error.code === "ER_NO_SUCH_TABLE" || error.code === "ER_BAD_FIELD_ERROR");
}

module.exports = { sendSuccess, sendError, isSchemaError };

