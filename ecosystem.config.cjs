module.exports = {
  apps: [{
    name: 'geomanger-api',
    script: 'src/app.js',
    cwd: '/var/www/Report4biz/backend',
    interpreter: 'node',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production'
    }
  }]
};
