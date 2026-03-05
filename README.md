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

浏览器会展示 `clash_config.yaml`，复制到 Clash Meta / Mihomo 即可使用，但在实际运行中显示地址错误不出现。

## 修改订阅地址
编辑 `subscriptions.json` → push → GitHub Action 自动重新构建镜像。

## 订阅地址回传github
使用方法（ClawCloud 部署时必须设置）在 ClawCloud 部署页面 → 环境变量 添加以下变量：变量名
值示例
说明
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxx  必须（repo 权限）
GITHUB_REPO=你的用户名/chrogojd  默认即可
GITHUB_FILE_PATH=clash-cache.yaml  可自定义文件名
GITHUB_BRANCH=main  你的默认分支

PAT 生成提醒：
GitHub → Settings → Developer settings → Personal access tokens (classic) → 生成新 token → 勾选 repo 权限。

github订阅地址：（NekoBox（以及几乎所有 Clash 系客户端）订阅链接必须使用 raw.githubusercontent.com 的 raw 地址，而不是 blob 页面地址）
https://raw.githubusercontent.com/你的用户名/chrogojd/main/clash-cache.yaml

部署后，容器每次更新节点缓存（启动时 + 每天 00:00）都会自动把最新 YAML 上传到你的 GitHub 仓库，你可以在 GitHub 上直接看到 clash-cache.yaml 文件实时更新。

## 注意
- 容器内部监听 **3000** 端口
- 推荐 ClawCloud 端口映射为 8080 或 80
- 第一次访问会立即抓取，之后使用缓存，速度极快

所有镜像地址：https://github.com/你的用户名?tab=packages
