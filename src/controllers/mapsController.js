const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

// Proxy de Google Static Maps : la cle Google ne quitte jamais le serveur.
// Le front utilise : GET /api/maps/static?center=48.85,2.36&zoom=15&markers=48.85,2.36
exports.staticMap = asyncHandler(async (req, res) => {
  if (!env.GOOGLE_MAPS_API_KEY) throw new ApiError(503, 'Google Maps non configure sur le serveur');

  const { center = '48.8530,2.3698', zoom = '14', width = '600', height = '360', markers, path } = req.query;
  const w = Math.min(Number(width) || 600, 640);
  const h = Math.min(Number(height) || 360, 640);

  const darkStyle = [
    'element:geometry|color:0x070a0e',
    'element:labels.text.stroke|color:0x070a0e',
    'element:labels.text.fill|color:0x8b949e',
    'feature:administrative.locality|element:labels.text.fill|color:0xc3f400',
    'feature:poi|element:labels.text.fill|color:0x00daf3',
    'feature:road|element:geometry|color:0x161b22',
    'feature:road|element:geometry.stroke|color:0x21262d',
    'feature:road.highway|element:geometry|color:0x238636',
    'feature:transit|element:geometry|color:0x1c2026',
    'feature:water|element:geometry|color:0x0d1117',
  ]
    .map((s) => `style=${encodeURIComponent(s)}`)
    .join('&');

  let url = `https://maps.googleapis.com/maps/api/staticmap?center=${encodeURIComponent(center)}&zoom=${encodeURIComponent(
    zoom
  )}&size=${w}x${h}&scale=2&maptype=roadmap&${darkStyle}&key=${env.GOOGLE_MAPS_API_KEY}`;
  if (markers) url += `&markers=color:green%7C${encodeURIComponent(markers)}`;
  if (path) url += `&path=color:0xc3f400ff%7Cweight:4%7C${String(path).split(';').map(encodeURIComponent).join('%7C')}`;

  const upstream = await fetch(url);
  if (!upstream.ok) throw new ApiError(502, 'Erreur Google Maps');

  res.set('Content-Type', upstream.headers.get('content-type') || 'image/png');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(Buffer.from(await upstream.arrayBuffer()));
});
