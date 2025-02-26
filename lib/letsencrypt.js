/**
 * Letsecript module for Redbird (c) Optimalbits 2016
 *
 *
 *
 */

/**
 *  LetsEncrypt certificates are stored like the following:
 *
 *  /example.com
 *    /
 *
 *
 *
 */
var leStoreConfig = {};
var webrootPath = ':configDir/:hostname/.well-known/acme-challenge';

function init(certPath, port, logger) {
  var http = require('http');
  var path = require('path');
  var url = require('url');
  var fs = require('fs');

  logger && logger.info('Initializing letsencrypt, path %s, port: %s', certPath, port);

  leStoreConfig = {
    configDir: certPath,
    privkeyPath: ':configDir/:hostname/privkey.pem',
    fullchainPath: ':configDir/:hostname/fullchain.pem',
    certPath: ':configDir/:hostname/cert.pem',
    chainPath: ':configDir/:hostname/chain.pem',

    workDir: ':configDir/letsencrypt/var/lib',
    logsDir: ':configDir/letsencrypt/var/log',

    webrootPath: webrootPath,
    debug: false
  };

  // we need to proxy for example: 'example.com/.well-known/acme-challenge' -> 'localhost:port/example.com/'
  http.createServer(function (req, res) {
    var uri = url.parse(req.url).pathname;
    var filename = path.join(certPath, uri);
    var isForbiddenPath = uri.length < 3 || filename.indexOf(certPath) !== 0;

    if (isForbiddenPath) {
      logger && logger.info('Forbidden request on LetsEncrypt port %s: %s', port, filename);
      res.writeHead(403);
      res.end();
      return;
    }

    logger && logger.info('LetsEncrypt CA trying to validate challenge %s', filename);

    fs.stat(filename, function (err, stats) {
      if (err || !stats.isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.write("404 Not Found\n");
        res.end();
        return;
      }

      res.writeHead(200);
      fs.createReadStream(filename, "binary").pipe(res);
    });

  }).listen(port);
}

/**
 *  Gets the certificates for the given domain.
 *  Handles all the LetsEncrypt protocol. Uses
 *  existing certificates if any, or negotiates a new one.
 *  Returns a promise that resolves to an object with the certificates.
 *  TODO: We should use something like https://github.com/PaquitoSoft/memored/blob/master/index.js
 *  to avoid
 */
function getCertificates(domain, email, production, renew, logger) {
  var LE = require('greenlock');
  var le;

  // Storage Backend
  var leStore = require('le-store-certbot').create(leStoreConfig);

  // ACME Challenge Handlers
  var leChallenge = require('le-challenge-fs').create({
    webrootPath: webrootPath,
    debug: false
  });

  le = LE.create({
    server: production ? 'https://acme-v02.api.letsencrypt.org/directory' : 'https://acme-staging-v02.api.letsencrypt.org/directory',
    store: leStore,                                          // handles saving of config, accounts, and certificates
    challenges: { 'http-01': leChallenge },                  // handles /.well-known/acme-challege keys and tokens
    challengeType: 'http-01',                                // default to this challenge type
    debug: false,
    log: function (debug) {
      logger && logger.info(arguments, 'Lets encrypt debugger');
    }
  });

  // Check in-memory cache of certificates for the named domain
  return le.check({ domains: [domain] }).then(function (cert) {
    var opts = {
      domains: [domain],
      email: email,
      agreeTos: true,
      rsaKeySize: 2048,                                       // 2048 or higher
      challengeType: 'http-01'
    }

    if (cert) {
      if (renew) {
        logger && logger.info('renewing cert for ' + domain);
        opts.duplicate = true;
        return le.renew(opts, cert).catch(function (err) {
          logger && logger.error(err, 'Error renewing certificates for ', domain);
        });
      } else {
        logger && logger.info('Using cached cert for ' + domain);
        return cert;
      }
    } else {
      // Register Certificate manually
      logger && logger.info('Manually registering certificate for %s', domain);
      return le.register(opts).catch(function (err) {
        // logger && logger.error(err, 'Error registering LetsEncrypt certificates');
        throw err;
      });
    }
  });
}

module.exports.init = init;
module.exports.getCertificates = getCertificates;
