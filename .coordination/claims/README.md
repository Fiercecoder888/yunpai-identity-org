# Session Claims

每个并行 session 在此目录创建一个以自己分支命名的 claim 文件，例如 `dev-s03-scroll-layout.md`。claim 文件只允许该 session 写入；任务结束后删除。内容至少包括：

```text
session_id:
owner:
branch:
base_commit:
scope:
paths:
started_at:
expected_end:
status:
```

发布操作另需声明 `DEPLOY_LOCK`，同一时间只能存在一个发布锁。
