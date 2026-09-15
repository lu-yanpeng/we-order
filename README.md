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

## 代码审计

可以让AI帮忙检查代码。下面以mp小程序为例讲解用法，每个子项目应该分别保存自己的审计报告。

先手动指定`skills/brooks-lint/brooks-audit`让AI读取这个skill，然后让他根据`docs/phase-1/ARCHITECTURE-SPINE.md`，检查`mp/src`下的代码，把报告输出到`mp/docs/brooks-lint/YYYY-MM-DD 架构审计.md`。
整体流程就是这样，可以看情况来写提示词。

这里有一些细节：
1. 必须指定检查范围，否者会检查整个项目的所有代码。
2. 审计报告建议提交到git，因为不是每个问题都会立刻解决，可以把报告留下，等到以后再来解决。
3. 调用这个skill会在项目根目录生成两个`.brooks-lint`文件，需要提交到git。
4. 如果项目有自己的架构文档，可以让AI以自己的架构为标准做评判。否则会使用12本经典书籍做评判，可能会和自己的架构产生冲突。
5. 不知道用法，直接问AI。

项目审计建议有一定代码量后再做，而且只能做参考，不能让AI随意修复。千万不能让AI一次性修复所有问题，基本上会越改越乱。

## 其他

我使用的主力模型是DeepSeek v4.1 Flash。agents各家都大差不差，哪家有优惠就用哪个。实在不行，可以用opencode。
