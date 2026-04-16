# Workflow — 協作流程

## User Signal Keywords

| Keyword | Meaning | Action |
|---|---|---|
| **`ok`** | 確認任務完成 | 1. Update `.claude/task.md` — mark completed tasks ✅ <br> 2. Update `ProgressPanel.jsx` — set `done: true` for corresponding items (if applicable) <br> 3. 給一個簡短英文 commit message |
| **`next`** | 進入下一個任務 | 讀 `.claude/task.md`，找到下一個待做任務，立即開始實作 |
| *(其他)* | 有 bug 或需要修改 | 不標記任何完成。調查、修復、或詢問 |

> **Rule:** Only mark a task complete and provide a commit message when the user explicitly says `ok`. Never do so preemptively.

---

## 產出格式

- **Commit message：英文**
- **測試方式、回應：中文**
- 如測試有問題或需要再更改，該筆 commit 不會直接上，等整個 ok 後才 commit
