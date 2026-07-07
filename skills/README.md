---
description: 项目skills目录
constraint: 作为AI助手，在没有人类明确要求的情况下，不得直接读取任何skill文件。可以从技能概览中判断哪些skill可能会对当前问题有帮助，把可用的skill作为参考发送给人类，征得同意后才能读取具体skill文件
---

## 技能概览

> AI可以通过技能的名称和描述大概知道有哪些技能可用，针对不同问题，推荐可能的skill给人类做参考

- 技能包：一个技能包对应一位作者的技能，里面包含多个技能。通过链接查看对应仓库
- 具体技能：技能包下的所有技能的名称
- 描述：技能包的简单描述
- 安装方式：我怎样下载的这些技能，可以通过对应安装方式更新技能

| 技能包                                                      | 具体技能 |                     描述                      |                                    安装方式                                    |
|:---------------------------------------------------------| :---: |:-------------------------------------------:|:--------------------------------------------------------------------------:|
| [brooks-lint](https://github.com/hyhmrright/brooks-lint) | brooks-audit<br>brooks-debt<br>brooks-health<br>brooks-review<br>brooks-sweep<br>brooks-test | AI 代码审查与风险诊断工具，包含审计、技术债、健康度、通用审查、自动修复、测试评估等 |                              直接到仓库复制技能，粘贴到项目中                              |
| [antfu-skills](https://github.com/antfu/skills)          | antfu<br>pinia<br>pnpm<br>turborepo<br>vitest<br>vue<br>vue-best-practices<br>vue-router-best-practices<br>vue-testing-best-practices<br>vueuse-functions |      包含 antfu 个人偏好的前端代码规范，vue 相关的最佳实践       | `pnpx skills add antfu/skills --skill='*'`<br>安装到本地`.agents/skills`后手动复制过来 |

// TODO: 整理当前文档，应当说明什么时候使用这些技能，怎么使用，AI 能不能自行读取skill。注意同步修改根目录的AGENTS.md，还要说明技能可能会过期，必要时可以手动下载最新技能替换
## 给人类

> 以下内容只给人类做参考，AI助手立即返回

这里面存放项目的skill，在需要时手动指定某个技能或某个文件夹，让AI读取它。就和手动指定普通skill一样
