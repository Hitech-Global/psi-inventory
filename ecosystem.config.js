// PM2 部署配置（B1 · SYSTEM-READY-AUDIT-01）
// 用法:
//   pm2 start ecosystem.config.js
//   pm2 save && pm2 startup   # 开机自启
//   pm2 logs inventory-app    # 查看日志
//   pm2 reload inventory-app  # 平滑重启
//
// 说明:
//   - 敏感变量（FEISHU_*/BREAKGLASS_ADMIN_PASSWORD/TRUSTED_ORIGINS 等）由 .env 提供，
//     server.js 顶部已 require('dotenv').config() 自动加载；此处仅强制 NODE_ENV=production。
//   - 单进程 fork 模式：应用使用 better-sqlite3 单文件库，不适合 cluster 多实例并发写。
module.exports = {
  apps: [
    {
      name: 'inventory-app',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '500M',
      // 崩溃重启节流：避免异常时疯狂重启
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 2000,
      env: {
        NODE_ENV: 'production'
      },
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      merge_logs: true,
      time: true
    }
  ]
};
