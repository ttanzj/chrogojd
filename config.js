import { config } from 'dotenv';
config();

export default {
  github: {
    repoUrl: process.env.GITHUB_REPO || 'https://github.com/ttanzj/chrogojd.git',
    branch: 'main',
    commitMessagePrefix: process.env.COMMIT_PREFIX || '🔄 自动更新节点订阅'
  },

  output: {
    yaml: './clash.yaml',
    base64: './sub.base64'
  }
};