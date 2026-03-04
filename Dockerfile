FROM node:20-slim

WORKDIR /app

# 只复制 package 文件先安装依赖（利用 Docker 缓存）
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# 再复制所有代码
COPY . .

EXPOSE 3000
CMD ["npm", "start"]
