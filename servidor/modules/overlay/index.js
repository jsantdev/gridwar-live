const path = require('node:path');

function registerOverlayRoutes(app) {
  const overlayFile = path.join(__dirname, 'index.html');
  app.get(['/', '/index.html'], (request, response) => {
    response.sendFile(overlayFile);
  });
}

module.exports = { registerOverlayRoutes };
