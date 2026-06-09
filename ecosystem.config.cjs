// PM2 requires CommonJS — .cjs extension is intentional.
const home = process.env.HOME;

module.exports = {
  apps: [{
    name: 'zylos-line',
    script: 'src/index.js',
    cwd: `${home}/zylos/.claude/skills/line`,
    env: {
      NODE_ENV: 'production'
    },
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    kill_timeout: 5000,
    error_file: `${home}/zylos/components/line/logs/error.log`,
    out_file: `${home}/zylos/components/line/logs/out.log`,
    log_date_format: 'YYYY-MM-DD HH:mm:ss'
  }]
};
