const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

// Inlined from @expo/cli multipart encoder — no external deps needed
function encodeMultipartMixed(fields) {
  const boundary = `formdata-${crypto.randomBytes(8).toString('hex')}`;
  const CRLF = '\r\n';
  let body = '';
  for (const field of fields) {
    body += `--${boundary}${CRLF}`;
    body += `Content-Disposition: form-data; name="${field.name}"`;
    if (field.contentType) body += `${CRLF}Content-Type: ${field.contentType}`;
    body += `${CRLF}${CRLF}`;
    body += field.value + CRLF;
  }
  body += `--${boundary}--${CRLF}${CRLF}`;
  return { boundary, body };
}

const PROJECT_DIR = fs.realpathSync(process.env.WORKSPACE_DIR || __dirname);
// The service switches to a completed export; refreshes never write the tree
// currently served by this process. Restored workspaces still default to dist/.
const DIST_DIR = process.env.EXPO_STATIC_EXPORT_DIR || path.join(PROJECT_DIR, 'dist');
const PREVIOUS_DIST_DIR = process.env.EXPO_STATIC_PREVIOUS_EXPORT_DIR;
const PORT = parseInt(process.env.EXPO_STATIC_PORT || '8082', 10);

// Get installed Expo SDK version from node_modules (read-only, no require('expo'))
let EXPO_SDK_VERSION = '54.0.0';
try {
  EXPO_SDK_VERSION = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, 'node_modules/expo/package.json'), 'utf8')).version;
} catch {}
const SDK_MAJOR = EXPO_SDK_VERSION.split('.')[0] + '.0.0';

// Get local IP
const LOCAL_IP = Object.values(os.networkInterfaces())
  .flat()
  .find((i) => i.family === 'IPv4' && !i.internal)?.address || 'localhost';

// Read metadata.json and app.json to build the manifest
let metadata = null;
let appJson = null;
try {
  metadata = JSON.parse(fs.readFileSync(path.join(DIST_DIR, 'metadata.json'), 'utf8'));
  appJson = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, 'app.json'), 'utf8'));
} catch (e) {
  console.warn('[serve-expo] Could not load metadata.json or app.json:', e.message);
}
const exp = appJson ? (appJson.expo || appJson) : {};

function getManifest(host, platform, proto) {
  const platformMeta = metadata.fileMetadata[platform];
  if (!platformMeta) {
    throw new Error(`No metadata for platform: ${platform}. Did you export with -p ${platform}?`);
  }
  const bundlePath = platformMeta.bundle;
  const baseUrl = `${proto}://${host}`;

  // Match Expo CLI dev server manifest exactly:
  // - assets: [] (empty, like the dev server — assets are embedded in bundle)
  // - expoGo config matches dev server format
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    runtimeVersion: exp.runtimeVersion || `exposdk:${SDK_MAJOR}`,
    launchAsset: {
      key: 'bundle',
      contentType: 'application/javascript',
      url: `${baseUrl}/${bundlePath}`,
    },
    assets: [],
    metadata: {},
    extra: {
      eas: { projectId: exp.extra?.eas?.projectId },
      expoClient: {
        ...exp,
        sdkVersion: SDK_MAJOR,
        hostUri: host,
      },
      expoGo: {
        mainModuleName: 'index',
        debuggerHost: host,
        developer: { tool: 'expo-cli', projectRoot: PROJECT_DIR },
        packagerOpts: { dev: true },
      },
      scopeKey: `@anonymous/${exp.slug}`,
    },
  };
}

const MEDIA_TYPES = {
  '.bmp': 'image/bmp',
  '.heic': 'image/heic',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.aac': 'audio/aac',
  '.aiff': 'audio/aiff',
  '.caf': 'audio/x-caf',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.mpeg': 'video/mpeg',
  '.mpg': 'video/mpeg',
  '.webm': 'video/webm',
};
const EXPORT_TYPES = {
  ...MEDIA_TYPES,
  '.js': 'application/javascript',
  '.hbc': 'application/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
};

// Reject dot segments before URL normalization can hide traversal attempts.
function isPublicPath(relative) {
  return typeof relative === 'string' && relative.length > 0 &&
    !/[\\\x00-\x1f\x7f]/.test(relative) &&
    relative.split('/').every((part) => part.length > 0 && !part.startsWith('.'));
}

// Native exports list their bundles and hashed assets in metadata.json. In
// particular, dist/ is not a public directory: maps and metadata stay private.
function publicExports(exportMetadata) {
  const files = new Map();
  for (const platform of Object.values(exportMetadata?.fileMetadata || {})) {
    if (isPublicPath(platform.bundle) && ['.js', '.hbc'].includes(path.extname(platform.bundle))) {
      files.set(platform.bundle, 'application/javascript');
    }
    for (const asset of platform.assets || []) {
      // Explicitly exported custom assets (SQLite databases, model weights,
      // etc.) are public too; never apply this fallback to source directories.
      if (isPublicPath(asset.path) && typeof asset.ext === 'string' && /^[a-z0-9]+$/i.test(asset.ext)) {
        files.set(asset.path, EXPORT_TYPES[`.${asset.ext.toLowerCase()}`] || 'application/octet-stream');
      }
    }
  }
  return files;
}
const exportedFiles = publicExports(metadata);
let previousExports = new Map();
if (PREVIOUS_DIST_DIR) {
  try {
    previousExports = publicExports(JSON.parse(fs.readFileSync(path.join(PREVIOUS_DIST_DIR, 'metadata.json'), 'utf8')));
  } catch {}
}

const configuredAssets = new Set([
  exp.icon, exp.splash?.image, exp.ios?.icon, exp.android?.icon,
  exp.android?.adaptiveIcon?.foregroundImage, exp.android?.adaptiveIcon?.backgroundImage,
  exp.android?.adaptiveIcon?.monochromeImage, exp.web?.favicon,
].filter((entry) => typeof entry === 'string').map((entry) => entry.replace(/^\.\//, '')));

function sourceAssetType(relative) {
  if (!isPublicPath(relative)) return null;
  if (!relative.startsWith('assets/') && !relative.startsWith('node_modules/') && !configuredAssets.has(relative)) {
    return null;
  }
  return MEDIA_TYPES[path.extname(relative).toLowerCase()] || null;
}

function resolvePublicFile(base, relative, allowedType) {
  const mime = allowedType(relative);
  if (!mime) return null;
  try {
    const realFile = fs.realpathSync(path.join(base, relative));
    const realRelative = path.relative(base, realFile);
    // Check the target as well as the URL: file/directory symlinks must not
    // turn allowed asset names into aliases for private files or other roots.
    if (!isPublicPath(realRelative) || path.isAbsolute(realRelative) || !allowedType(realRelative)) return null;
    const stat = fs.statSync(realFile);
    return stat.isFile() ? { realFile, mime, size: stat.size } : null;
  } catch {
    return null;
  }
}

function servePublicFile(base, relative, allowedType, res) {
  const file = resolvePublicFile(base, relative, allowedType);
  if (!file) return false;
  const stream = fs.createReadStream(file.realFile);
  stream.on('error', () => res.destroy());
  res.writeHead(200, { 'Content-Type': file.mime, 'Content-Length': file.size });
  stream.pipe(res);
  return true;
}

const exportedMediaDigests = new Map();
function mediaType(relative) {
  return isPublicPath(relative) ? MEDIA_TYPES[path.extname(relative).toLowerCase()] : null;
}

// Metro dev-style asset URLs keep original paths, including src/images/ and
// fonts/. Export metadata names only the hashed copies. Match the requested
// media against those explicit public bytes, then serve the immutable export
// rather than exposing another source directory or a changing source file.
function serveExportedSourceAsset(relative, res) {
  const source = resolvePublicFile(PROJECT_DIR, relative, mediaType);
  if (!source) return false;
  let sourceDigest;
  try {
    for (const [base, files] of [[DIST_DIR, exportedFiles], [PREVIOUS_DIST_DIR, previousExports]]) {
      if (!base) continue;
      for (const [exportPath, mime] of files) {
        if (mime !== source.mime) continue;
        const exported = resolvePublicFile(base, exportPath, (file) => files.get(file));
        if (!exported || exported.size !== source.size) continue;
        if (!sourceDigest) sourceDigest = crypto.createHash('sha256').update(fs.readFileSync(source.realFile)).digest('hex');
        const key = `${base}/${exportPath}`;
        let digest = exportedMediaDigests.get(key);
        if (!digest) {
          digest = crypto.createHash('sha256').update(fs.readFileSync(exported.realFile)).digest('hex');
          exportedMediaDigests.set(key, digest);
        }
        if (sourceDigest === digest && servePublicFile(base, exportPath, (file) => files.get(file), res)) return true;
      }
    }
  } catch {}
  return false;
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch {
    res.writeHead(400);
    res.end('Malformed URL');
    return;
  }
  if (!pathname.startsWith('/') || (pathname !== '/' && !isPublicPath(pathname.slice(1)))) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const protoVer = req.headers['expo-protocol-version'] || '-';
  console.log(`  ${req.method} ${pathname} [platform=${req.headers['expo-platform'] || '-'}, proto=${protoVer}]`);

  // Manifest endpoints
  if (['/', '/manifest', '/index.exp'].includes(pathname)) {
    if (!metadata || !appJson) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Native export not ready — dist/metadata.json missing' }));
      return;
    }

    const platform = req.headers['expo-platform'] || 'ios';

    let manifest;
    try {
      manifest = getManifest(req.headers.host, platform, req.headers['x-forwarded-proto'] || 'http');
    } catch (e) {
      console.error(`  Error: ${e.message}`);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
      return;
    }

    const manifestJson = JSON.stringify(manifest);
    console.log(`  Manifest runtimeVersion: ${manifest.runtimeVersion}`);
    console.log(`  Manifest bundleUrl: ${manifest.launchAsset.url}`);

    const encoded = encodeMultipartMixed([
      {
        name: 'manifest',
        value: manifestJson,
        contentType: 'application/json',
      },
    ]);

    const bodyBuf = Buffer.from(encoded.body, 'utf-8');

    // Match Expo CLI dev server: always protocol version 0, explicit Content-Length
    res.writeHead(200, {
      'content-type': `multipart/mixed; boundary=${encoded.boundary}`,
      'content-length': bodyBuf.length,
      'expo-protocol-version': 0,
      'expo-sfv-version': 0,
      'cache-control': 'private, max-age=0',
    });
    res.end(bodyBuf);
    return;
  }

  // Status endpoint
  if (pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('packager-status:running');
    return;
  }

  // Symbolicate endpoint
  if (pathname === '/symbolicate') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ stack: [] }));
    return;
  }

  // Logs endpoint
  if (pathname === '/logs') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Health check endpoint
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  const relative = pathname.slice(1);
  if (servePublicFile(DIST_DIR, relative, (file) => exportedFiles.get(file), res)) return;
  // A device may still be fetching assets from the manifest it read just before
  // the handoff. Retain that export's explicit public files through one refresh.
  if (PREVIOUS_DIST_DIR && servePublicFile(PREVIOUS_DIST_DIR, relative, (file) => previousExports.get(file), res)) return;
  if (servePublicFile(PROJECT_DIR, relative, sourceAssetType, res)) return;
  if (serveExportedSourceAsset(relative, res)) return;

  // Metro source asset URLs can add /assets/ to a project-relative path.
  // Apply the same policy after stripping the prefix.
  if (relative.startsWith('assets/')) {
    const sourceRelative = relative.slice('assets/'.length);
    if (servePublicFile(PROJECT_DIR, sourceRelative, sourceAssetType, res) ||
        serveExportedSourceAsset(sourceRelative, res)) return;
  }

  console.log(`  404: ${pathname}`);
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  const expUrl = `exp://${LOCAL_IP}:${PORT}`;
  console.log(`\n  Expo dist/ server running! (SDK ${EXPO_SDK_VERSION})\n`);
  console.log(`  Local:    http://localhost:${PORT}`);
  console.log(`  Network:  http://${LOCAL_IP}:${PORT}`);
  console.log(`  Expo Go:  ${expUrl}`);
  console.log(`  Runtime:  exposdk:${SDK_MAJOR}\n`);

  try {
    require('qrcode-terminal').generate(expUrl, { small: true }, (qr) => {
      console.log(qr);
    });
  } catch {
    console.log(`  Scan this URL manually: ${expUrl}\n`);
  }
});
