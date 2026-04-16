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

---

## 語言使用規則

- **給使用者看的內容（回應、說明、測試步驟、提問）：中文**
- **Claude 自己思考、自己閱讀的內容（內部分析、計畫草稿、TodoWrite 項目、code comment 除非需要給使用者看）：英文**
- Commit message 固定英文（見上方產出格式）
