// Thin shim: delegate to main handler so Vercel creates an explicit
// serverless function at /api/squads instead of routing through the
// /api/(.*) → /api/index.js rewrite, which Vercel treats as a static
// file for POST/PATCH/DELETE and returns 405.
module.exports = require('./index.js');
