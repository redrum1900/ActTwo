# ACT II 单机部署

本方案适合一台 Linux 应用服务器、宝塔管理的 Nginx/HTTPS，以及独立 MySQL。它是部署模板，不代表已经在服务器上执行。前端构建文件、网页路由与 API 均由一个 Node 进程提供；不要再启动 Vite 开发服务器，也不要将 3001 端口暴露到公网。

## 部署前确认

- 应用服务器的 SSH 端口、用户、操作系统和域名；宝塔面板端口不一定是 SSH 端口。
- 服务器能访问 MySQL；使用**应用专属数据库及账号**。上线前备份现有 MySQL 和 `data/covers/`，并确认备份能恢复。
- 安装受支持的 Node.js LTS、npm 和 Nginx。当前 `npm start` 使用 `tsx` 运行 API 源码，因此部署必须保留 devDependencies，**不可**使用 `npm ci --omit=dev`。
- 准备 AI 与 MySQL 参数。`.env` 只存在服务器项目根目录，权限限制为应用用户可读，不加入 Git，也不要放到站点可直接访问的目录。MySQL 若是远程连接，配置 `MYSQL_SSL_CA` 验证服务端证书。

## 安装与启动

以下以 `/srv/act-ii` 和独立系统用户 `actii` 为例，按实际路径调整。先把已验证的项目代码同步到应用目录，保留 `data/covers/` 与服务器自己的 `.env`，不要从本机覆盖它们。首次安装时从 `.env.example` 创建 `.env`，填写 MySQL、AI 等参数；可通过服务器终端交互创建管理员：`npm run admin:create -- superadmin`。

在项目根目录运行：

```bash
npm ci
npm run build
```

生产环境设置 `NODE_ENV=production`、`GAME_API_HOST=127.0.0.1`、`PORT=3001`。运行 `npm start` 时会先连接 MySQL 并执行迁移，然后提供 `dist/web/` 与 API。建议使用 [systemd 模板](../deploy/act-ii.service.example)管理进程：核对 `WorkingDirectory`、`User`、`Group` 和 `command -v npm` 的真实路径后，安装服务文件并启动。也可以用宝塔 Node 项目管理器运行同一命令，但**只能选一种进程管理方式**。

宝塔新建站点、绑定域名并配置 HTTPS 后，把 [Nginx 反向代理片段](../deploy/nginx-location.conf.example)放入该站点的 `server` 块，再检查配置并重载 Nginx。片段会保留原始 `Host`，这对应用的同源请求校验是必要的；它还关闭代理缓冲以保证 AI 回复逐步显示。不要覆盖宝塔生成的证书和其他站点配置。

若暂时没有域名，可以先只在服务器本机用 `curl -I http://127.0.0.1:3001/` 验证进程；**正式浏览器登录和试玩需要 HTTPS 域名**，因为生产登录 Cookie 带 `Secure` 标记。仅用 HTTP 公网 IP 不适合作为正式验收入口。

## 验收清单

1. 服务启动日志显示 API 正在监听；`curl -I http://127.0.0.1:3001/` 返回页面；公网 HTTPS 首页可访问。
2. 登录、退出、注册、创作中心和审核页面可用；`/creator/...`、`/games/...`、`/playtest/...` 刷新后仍打开页面。
3. 草稿保存、封面与道具图片上传、校验、试玩、流式对话、自动存档及手动档恢复正常。
4. 确认新游戏使用最新发布版本，旧手动档仍读取对应快照；确认 AI 用量记录写入。
5. 检查 Nginx 与应用日志中没有 413、502、长对话超时或数据库连接错误。

## 更新、备份与回滚

更新前记录当前代码版本，并备份 MySQL 和 `data/covers/`；先在测试环境完成构建与试玩。更新代码后再次运行 `npm ci`、`npm run build`，再重启**唯一**应用进程并执行上面的验收清单。数据库迁移会在启动时执行：如果更新失败，不能假定只回退代码就能回退数据库；应检查迁移内容与备份后再决定恢复方案。

MySQL 和 `data/covers/` 应定期备份到服务器外部并演练恢复。`data/ai-requests.jsonl` 默认记录 AI 请求日志，应按保留策略保护和清理。公网开放前还需为登录、注册及智能导入配置限流/并发保护，并监控磁盘、内存、数据库连接和模型费用。
