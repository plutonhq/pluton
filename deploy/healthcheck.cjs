// Keep the Compose node -e body identical to this probe (also works in older images).
const http = require('node:http');
const fail = code => process.exit(code);
const deadline = setTimeout(() => fail(10), 4000);
const request = http.get({ host: '127.0.0.1', port: 5173, path: '/api/health', method: 'GET' }, response => {
  if (response.statusCode !== 200) return fail(11);
  if ((response.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase() !== 'application/json') return fail(12);
  let body = '';
  response.on('data', chunk => { body += chunk; if (Buffer.byteLength(body) > 1024) fail(12); });
  response.on('error', () => fail(10));
  response.on('end', () => {
    try {
      const value = JSON.parse(body);
      if (!value || Array.isArray(value) || Object.keys(value).length !== 1 || value.status !== 'healthy') return fail(13);
      clearTimeout(deadline);
    } catch { fail(12); }
  });
});
request.on('error', () => fail(10));
