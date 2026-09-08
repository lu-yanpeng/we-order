这是一个我和AI协作开发的微信点餐小程序，它由三部分组成

- [uniapp](https://uniapp.dcloud.net.cn/) 微信小程序
- [vben admin](https://doc.vben.pro/guide/introduction/vben.html) 后台管理系统
- [supabase](https://supabase.com/docs/guides/getting-started) 后端

目录结构

```text
.
├── docs
│   ├── adr              # 决策
│   ├── brief.md         # 最开始的项目构想
│   └── phase-1          # 阶段性的prd和架构文档
└── skills               # 专用skill
    └── brooks-lint      # 检查架构或全面检查代码
    └── antfu-skills     # vue最佳实践
```

## 其他

我使用的agent工具，主力`opencode`，简单任务会用`Antigravity`
