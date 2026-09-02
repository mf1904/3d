/* PM2 — jalankan: pm2 start ecosystem.config.js && pm2 save */
module.exports = {
  apps: [{
    name: 'layout3d',
    script: 'server.js',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',          // SQLite single-writer: jangan di-cluster
    autorestart: true,
    max_memory_restart: '256M',
    env: {
      NODE_ENV: 'production',
      HOST: '127.0.0.1',        // hanya dari localhost; publik lewat Caddy
      PORT: 8130
    },
    error_file: 'logs/err.log',
    out_file: 'logs/out.log',
    time: true
  }]
};
