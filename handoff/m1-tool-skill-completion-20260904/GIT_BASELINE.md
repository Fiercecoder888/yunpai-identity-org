# Git 开发基线

## 远端

```text
origin = ssh://git@192.168.110.22:2222/yunpaiadmin/yunpai-gragh0903.git
```

资料包生成时：

```text
origin/main = 1829888a58855b0fd6064fa5b8ee4a858823c191
origin/dev  = a0d943317b07b09d7112078eb4e3800a686af4aa
```

这些只是生成时证据。开发必须重新 fetch，以执行时最新 `origin/main` 为基线。

## 推荐流程

```bash
git status --short --branch
git remote -v
GIT_SSH_COMMAND='ssh -i ~/.ssh/id_ed25519_company -o IdentitiesOnly=yes -o BatchMode=yes' git fetch origin main dev
git rev-parse origin/main origin/dev
git worktree add ../yunpaigragh-m1-dev -b codex/m1-tool-skill-completion-YYYYMMDD origin/main
cd ../yunpaigragh-m1-dev
```

完成并通过测试后：

```bash
git diff --check
git status --short
git add <仅本任务文件>
git commit -m "m1: complete tool and skill integration"
git push -u origin codex/m1-tool-skill-completion-YYYYMMDD
```

然后由集成负责人审查并合入 `dev`。普通开发不得直接提交或推送 `main`。

## 分支并发要求

- 开工前检查 `.coordination/claims/` 和 `git worktree list`。
- 认领 Registry/Skill/ops/M1 测试和 Adapter 路径，避免与 M3/M4 公共 HTTP Adapter 修改冲突。
- 若最新 main 已合入 M3/M4 公共 Adapter，基于其扩展，不回退已有 header/error/query 逻辑。
- 不暂存其他 session 的账本、截图、运行产物或数据库。
- 不使用 hard reset、强推或覆盖远端历史。

## 凭据

仓库和资料包都不得保存私钥、Token、密码或真实 `.env`。上述 SSH 命令只引用本机既有身份文件，不复制其内容。
