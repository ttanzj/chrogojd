# chrogojd

Clash 全节点自动聚合服务（支持 Hysteria / Hysteria2 / Xray / Singbox / Clash 多种格式）

## 功能
- 保留全部原始订阅地址（`subscriptions.json` 可自由修改）
- 自动去重 + 失效地址自动跳过
- 每天 00:00 UTC 自动更新节点缓存
- 访问即返回完整 Clash YAML（可直接导入）

## 部署方式（ClawCloud）

1. 在 GitHub 创建仓库 `chrogojd`，把上面所有文件 push 上去。
2. GitHub Action 会自动构建并推送镜像 `ghcr.io/你的用户名/chrogojd:latest`。
3. 在 ClawCloud 新建容器：
   - 镜像地址：`ghcr.io/你的用户名/chrogojd:latest`
   - 端口映射：`3000`（容器端口）→ 你想要的宿主机端口（推荐 8080）
4. 启动后访问：

**访问地址**  
`http://你的ClawCloud-IP:8080/` （或你映射的端口）

浏览器会直接下载 `clash_config.yaml`，复制到 Clash Meta / Mihomo 即可使用。

## 修改订阅地址
编辑 `subscriptions.json` → push → GitHub Action 自动重新构建镜像。

## 注意
- 容器内部监听 **3000** 端口
- 推荐 ClawCloud 端口映射为 8080 或 80
- 第一次访问会立即抓取，之后使用缓存，速度极快

所有镜像地址：https://github.com/ttanzj?tab=packages
