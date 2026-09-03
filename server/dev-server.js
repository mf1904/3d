/* layout3d — menjalankan server dengan data terpisah untuk pengembangan
 *
 * Gunanya satu: memastikan percobaan lokal tidak pernah menyentuh server/data
 * yang berisi hash password dan project sungguhan. Data pengembangan ditaruh
 * di server/data-dev, yang di-ignore git.
 *
 *   node server/dev-server.js
 */
'use strict';

const path = require('path');

process.env.LAYOUT3D_DATA = process.env.LAYOUT3D_DATA ||
  path.join(__dirname, 'data-dev');
process.env.PORT = process.env.PORT || '8130';
process.env.HOST = process.env.HOST || '127.0.0.1';

console.log('[layout3d] MODE PENGEMBANGAN — data di ' + process.env.LAYOUT3D_DATA);

require('./server.js');
