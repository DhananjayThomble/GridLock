/**
 * PM2 Ecosystem Configuration — GridLock
 *
 * Defines all PM2-managed processes for the GridLock project.
 * Usage:
 *   pm2 start ecosystem.config.js            # Start all apps
 *   pm2 start ecosystem.config.js --only gridlock-backend  # Start one app
 *   pm2 reload ecosystem.config.js           # Zero-downtime reload all
 *
 * NOTE: This config uses absolute paths matching the EC2 directory layout
 * documented in INFRASTRUCTURE.md. If the server layout changes, update
 * both this file and the deploy scripts.
 *
 * IMPORTANT: All environment variables are loaded from .env files via dotenv
 * in each app's server.js. No secrets should be in this file — it's tracked by git.
 */
module.exports = {
  apps: [
    {
      name: 'gridlock-backend',
      script: 'server.js',
      cwd: '/home/ubuntu/projects/GridLock-prod/backend',
      // All env vars come from .env file (loaded by dotenv in server.js)
      // No secrets in this file — it's tracked by git
      instances: 1,
      autorestart: true,
      max_memory_restart: '512M',
      error_file: '/home/ubuntu/.pm2/logs/gridlock-backend-error.log',
      out_file: '/home/ubuntu/.pm2/logs/gridlock-backend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
    {
      name: 'gridlock-beta-backend',
      script: 'server.js',
      cwd: '/home/ubuntu/projects/GridLock-beta/backend',
      // All env vars come from .env file (loaded by dotenv in server.js)
      // Beta uses NODE_ENV=development for verbose logging, detailed errors
      instances: 1,
      autorestart: true,
      max_memory_restart: '512M',
      error_file: '/home/ubuntu/.pm2/logs/gridlock-beta-backend-error.log',
      out_file: '/home/ubuntu/.pm2/logs/gridlock-beta-backend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
