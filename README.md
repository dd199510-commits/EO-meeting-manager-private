# CEO Office 会议管理系统

这是一个基于 `React + Vite + Electron` 的会议管理桌面应用，用来维护会议主数据、生成排程、进行人工审核，并输出预留通知。

## 主要流程

1. 在“维护会议库”里新建会议，补齐参会人、时长、周期和历史记录。
2. 在“生成与确认排程”里生成待排程清单，并调用 AI 生成建议排程。
3. 将 AI 结果导入审核区，人工拖拽微调、补充临时日程、确认冲突。
4. 完成最终检查后，生成并复制预留通知内容。

## 目录说明

- `src/features/meetings`：会议库维护、筛选、编辑、历史导入
- `src/features/planner`：排程主工作台
- `src/features/review`：审核调整视图
- `src/features/finalCheck`：最终检查
- `src/features/reserveNotice`：预留通知生成和模板管理
- `electron`：桌面端 AI 调度、配置和本地任务队列

## 开发

```bash
npm install
npm run dev
```

构建：

```bash
npm run build
```
