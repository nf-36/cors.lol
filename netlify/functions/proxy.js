const rateLimit = 30000;
const rateLimitDuration = 1 * 60 * 1000; // 5 minutes
const requestCounts = new Map();

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

function prepareURL(rawURL) {
  rawURL = rawURL.trim();
  if (rawURL.startsWith('//')) {
    rawURL = 'https:' + rawURL;
  } else if (!rawURL.startsWith('http://') && !rawURL.startsWith('https://')) {
    rawURL = 'https://' + rawURL;
  }
  const parts = rawURL.split('://', 2);
  if (parts.length === 2) {
    const protocol = parts[0];
    const rest = parts[1].replace(/\/\/+/g, '/');
    rawURL = protocol + '://' + rest;
  }
  try {
    const parsed = new URL(rawURL);
    if (!parsed.host) throw new Error('missing host');
    return parsed.toString();
  } catch (err) {
    throw new Error('invalid URL: ' + err.message);
  }
}

function checkRateLimit(ip) {
  const now = Date.now();
  let info = requestCounts.get(ip);
  if (!info || now > info.reset) {
    info = { count: 0, reset: now + rateLimitDuration };
  }
  info.count++;
  requestCounts.set(ip, info);
  return info.count <= rateLimit;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders };
  }

  const ip = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
  if (!checkRateLimit(ip)) {
    return { statusCode: 429, headers: corsHeaders, body: 'Rate limit exceeded' };
    }

  const targetURL = event.queryStringParameters && event.queryStringParameters.url;
  if (!targetURL) {
    return { statusCode: 400, headers: corsHeaders, body: 'URL parameter is required' };
  }

  let preparedURL;
  try {
    preparedURL = prepareURL(targetURL);
  } catch (e) {
    return { statusCode: 400, headers: corsHeaders, body: e.message };
  }

  try {
    const response = await fetch(preparedURL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; cors.lol Netlify function)',
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    Object.assign(responseHeaders, corsHeaders);

    const contentType = responseHeaders['content-type'] || '';
    const isBinary = !/^text\//.test(contentType) && !/json/.test(contentType);
    const buffer = Buffer.from(await response.arrayBuffer());

    return {
      statusCode: response.status,
      headers: responseHeaders,
      body: buffer.toString(isBinary ? 'base64' : 'utf8'),
      isBase64Encoded: isBinary,
    };
  } catch (err) {
    return { statusCode: 502, headers: corsHeaders, body: 'Failed to fetch URL' };
  }
}
