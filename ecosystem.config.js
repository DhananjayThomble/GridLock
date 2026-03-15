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
 */
module.exports = {
  apps: [
    {
      name: 'gridlock-backend',
      script: 'server.js',
      cwd: '/home/ubuntu/projects/GridLock-prod/backend',
      env: {
        NODE_ENV: 'production',
        PORT: 5000,
        MONGO_URI: 'mongodb://localhost:27017/gridlock',
        REDIS_URL: 'redis://localhost:6379',
        ...(process.env.SENTRY_DSN ? { SENTRY_DSN: process.env.SENTRY_DSN } : {}),
        ...(process.env.POSTHOG_KEY ? { POSTHOG_KEY: process.env.POSTHOG_KEY } : {}),
      },
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
      env: {
        // Intentionally 'development' — beta mirrors dev behavior for testing
        // (verbose logging, detailed errors, no caching). Not a typo.
        NODE_ENV: 'development',
        PORT: 5001,
        MONGO_URI: 'mongodb://localhost:27017/gridlock_beta',
        REDIS_URL: 'redis://localhost:6379',
        ...(process.env.SENTRY_DSN ? { SENTRY_DSN: process.env.SENTRY_DSN } : {}),
        ...(process.env.POSTHOG_KEY ? { POSTHOG_KEY: process.env.POSTHOG_KEY } : {}),
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: '512M',
      error_file: '/home/ubuntu/.pm2/logs/gridlock-beta-backend-error.log',
      out_file: '/home/ubuntu/.pm2/logs/gridlock-beta-backend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
    {
      name: 'gh-notify',
      script: 'server.js',
      cwd: '/home/ubuntu/projects/gh-notify',
      env: {
        NODE_ENV: 'production',
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: '256M',
      error_file: '/home/ubuntu/.pm2/logs/gh-notify-error.log',
      out_file: '/home/ubuntu/.pm2/logs/gh-notify-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
