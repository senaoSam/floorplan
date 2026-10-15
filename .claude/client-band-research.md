<!-- 2026-10-14 調研（Phase 58-11）；只讀網頁，數字可信度見 [V]/[S]/[I] 標記 -->
# Hamina Client View 的選頻與漫遊規則：兩份研究報告合併

標記說明：**[V]** 表示讀過原頁面；**[S]** 表示只看到搜尋摘要或第三方頁面；**[I]** 表示推論。

## 總結

- Hamina 沒有公開任何選頻或漫遊的數字規則，包括門檻、差值（delta）、遲滯，以及 5 GHz 和 6 GHz 怎麼選。它只說各裝置類型照廠商文件的行為模擬。[V]
- 因此真正能引用的數字，都來自 Apple、Android 和 wpa_supplicant 的文件。
- 2025-05-15 起，Hamina 的模擬熱圖一次只能看一個頻段。原因是「selecting multiple bands at the same time can give a misleading view of the network」。[V] https://docs.hamina.com/hamina/other/release-notes/2025-archive.md

## 1. Hamina 怎麼選頻段（5 vs 2.4、6 vs 5）

- [V] 官方文件唯一寫明的規則是：「simulate a client performing an inter-band roam, or roaming to an AP in 2.4 GHz, when no 5 GHz option is available, per the known roaming algorithm of the selected client type.」意思是 5 GHz 為主，2.4 GHz 只是備援。
  - 文件沒有定義「5 GHz 可用」的門檻。
  - 6 GHz 和 5 GHz 怎麼選，文件也完全沒寫。
  - 來源：https://docs.hamina.com/planner/design/client-view 、https://docs.hamina.com/hamina/simulation/client-view.md
- [V] 文件說裝置行為「simulated using the documented roaming behaviors, as provided by the client vendors」，並歡迎廠商把 roaming specifications 寄到 support@hamina.com。
- [V] 用 Hamina 文件內建的問答查詢，得到的回答是：「The docs don't specify a fixed 5-vs-6 GHz preference or numeric RSSI roaming thresholds for each device.」
- [V] 文件也提醒，漫遊行為「varies greatly between vendors, OS, chipsets, and drivers ... outside of what Hamina Network Planner can simulate」。
- [V] 介面上有兩個相關元素：灰色虛線表示漫遊候選 AP；「Show association area」用藍色顯示裝置「stay associated」的範圍，紅色表示裝置連到其他樓層的 AP。
- [I] 「stay associated」這個用詞暗示關聯範圍取決於目前連著哪台 AP，也就是有黏著性（sticky，觸發門檻＋差值），而不是永遠挑最強的。Hamina 沒有證實這點。

## 2. 「6 GHz capable」設定

- [V] 文件只寫「Enables 6 GHz capabilities for the selected client」，沒說開啟後是否優先選 6 GHz。
- [V] 相關版本記錄：
  - 2023-10-13：iPhone 可設為支援 Wi-Fi 6E，用來模擬 iPhone 15 Pro。https://docs.hamina.com/hamina/other/release-notes/2023-archive.md
  - 2024-09-19：iPhone 裝置類型加入 Wi-Fi 7。https://docs.hamina.com/hamina/other/release-notes/2024-archive.md
- [V] 部落格提到裝置有「Preferred band of the device (including 6GHz ...)」設定，但沒有給數值。https://blog.hamina.com/hamina-feature-focus-client-view-0
- [S] 有一段搜尋摘要說，支援 6 GHz 的裝置在「better quality/throughput」時會優先 6 GHz。在原頁面找不到這句，不採用。
- [I] 這個開關最可能只是把 6 GHz 射頻加進候選清單。偏好 6 GHz 的效果應該來自廠商規則：Apple 的自動連線順序把 6 GHz 排第一，評分也偏好較寬頻道。

## 3. 各裝置類型的漫遊行為

Hamina 沒有公開任何一種裝置類型的門檻。[V] 已知的相關資訊：

- 2024-08-20 加入 Windows Laptop：做法是用常見 Intel 晶片模擬上千次漫遊，「brute-forced」歸納出行為，參數沒公開。[V]
- 2023-12-11 加入跨樓層漫遊，以及 Downlink / Uplink / Worstlink 三種模式。[V]
- 支援的裝置類型包括 Apple、Android、Vocera、舊型裝置、4G/5G 手機。[S]

以下是 Hamina 最可能採用的廠商數值（這個對應關係是推論 [I]，數值本身的來源標在表內）：

| 裝置 | 觸發漫遊 | 候選 AP 須強多少 | 選頻規則 | 來源 |
|---|---|---|---|---|
| iPhone / iPad | 低於 -70 dBm | 傳資料時 8 dB，閒置時 12 dB | 自動連線順序 6 > 5 > 5 DFS > 2.4；RSSI > -65 dBm 時偏好 5/6 GHz（見下方衝突說明） | [V] https://support.apple.com/en-us/102002 、https://support.apple.com/en-us/102169 、https://support.apple.com/guide/deployment/dep3b0448c58/web |
| macOS | 低於 -75 dBm | 一律 12 dB | RSSI > -68 dBm 時偏好 5/6 GHz（見下方衝突說明） | 觸發門檻與差值 [V] 102002 |
| Android (AOSP) | 2.4 GHz 高於 -73 dBm、5/6 GHz 高於 -70 dBm 視為「足夠」，不觸發掃描 | 沒有固定差值；用評分，目前連線有加分（作用等同遲滯）；10 秒內不重跑選網 | 最低可用門檻：2.4 GHz -80、5 GHz -77、6 GHz 可設定；ThroughputScorer 依預估吞吐量評分，自然偏好 5/6 GHz 和寬頻道 | [V] https://source.android.com/docs/core/connect/wifi-network-selection |
| Linux / ChromeOS (wpa_supplicant) | — | 差值依目前 RSSI 而定（約 1–5 dB，未驗證 [I]） | 頻段分數 2.4=0、5=1、6=2；`min_diff += (cur_band_score - sel_band_score) * 2`，等於每差一個頻段偏 2 dB | [V] https://lists.infradead.org/pipermail/hostap/2023-February/041300.html 、https://lists.infradead.org/pipermail/hostap/2023-December/042220.html |
| Windows / Intel | 由「Roaming Aggressiveness」五段設定決定（預設 Medium），依連線品質而不是 dBm | 未公開 | 「Preferred Band」預設 No Preference，即挑最強訊號 [S] | [V] https://www.intel.com/content/www/us/en/support/articles/000005546/wireless/legacy-intel-wireless-products.html 、https://www.intel.com/content/www/us/en/support/articles/000005585/wireless/legacy-intel-wireless-products.html |
| Samsung (Knox) | 預設 -75 dBm | 可設定；社群建議 VoIP 用觸發 -70、差值 6 dB | — | [S] 原頁面抓取失敗 |

**Apple 的補充**
- [V] 評分依據包括頻道使用率、已連線裝置數和 RSSI；偏好較新的標準（Wi-Fi 7 > 6 > 5 > 4）和較寬頻道（160 > 80 > 40 > 20 MHz）。
- [V] 6 GHz 是透過 2.4 / 5 GHz beacon 裡的 RNR 發現的。
- [V] 在 5/6 GHz 小區以 -67 dBm 重疊設計的網路中，裝置會「keeps its connection to the BSSID longer than expected」，也就是有黏著性。

**兩份報告互相衝突、需要再查證的地方**
- iOS 的 -65 dBm：報告 A 說它在現行 Apple 部署指南頁上 [V]；報告 B 只在 2013 年的舊 PDF 看到 [S]。
- macOS 的 -68 dBm：報告 A 標 [V]（同一頁）；報告 B 標 [S]，說現行頁面上找不到。
- Intel「Preferred Band」：報告 A 說官方頁只有 2.4 / 5 GHz 選項 [V]；報告 B 列有 6 GHz 選項 [S]。

**跨頻段和同頻段漫遊有沒有不同規則**
- 廠商文件都沒有另設一套跨頻段規則。Apple 和 wpa_supplicant 對所有漫遊用同一組觸發門檻和差值，wpa_supplicant 再加頻段偏好。[V]
- Hamina 也沒說兩者是否不同。[V]

## 4. Band steering 與 802.11k/v/r

- [V] Hamina 的 Client View、容量規劃文件，以及 2023 至 2026-10 的版本記錄，都沒有提到 band steering 或 802.11k/v。
- [V] Apple 在 iPhone 5s 以後、所有 iPad、Apple 晶片 Mac 支援 11k/r/v。有 11k 時只掃 Neighbor Report 的前 6 筆；沒有時要掃每個頻段的每個頻道。https://support.apple.com/en-us/102002
- [V] Packet Pushers HW051（來賓為 Hamina 的 Jerry Olla）的實測：
  - 開啟 11k 後 iPhone 更願意漫遊，也更常選 6 GHz。
  - 6 GHz 頻道較寬時，裝置會「like a magnet」地被吸過去；RSSI 和頻寬都相同時，沒有理由偏好 6 GHz。
  - Intel BE200 和 M2 MacBook Pro「6 to 6 every time」。
  - https://packetpushers.net/podcasts/heavy-wireless/hw051-how-wi-fi-devices-handle-roaming-on-2-4-5-and-6-ghz-bands/
- [I] Band steering 是 AP 端的行為；Hamina 看起來只模擬裝置端的決策，也沒有模擬 11k/v。

## 5. 廠商參考與熱圖頻段選擇

廠商數值見第 3 節的表格。另外：

- [V] Cisco 與 Apple 的白皮書建議：小區邊緣 ≥ -67 dBm（高密度 -65），每處至少有兩台 5 GHz AP 達 -67 dBm；建議只開 5 GHz 並啟用 11k/v。白皮書沒涵蓋 6 GHz。https://www.cisco.com/c/en/us/products/collateral/wireless/access-points/enterprise-best-practices-ios-ipados-wp.html
- [V] Microsoft Learn 只寫到驅動層的漫遊觸發（WDI ROAMING_NEEDED），沒有選頻演算法。
- [V] Hamina 的熱圖從多選頻段改成單選。文件從來沒說明多選時數值怎麼合併。
- [I] 這支持先前的方向：熱圖預設看 5 GHz，「最強」只用在 RSSI，SINR 這類指標不提供合併檢視。

---

## 建議給我們 Client View 的規則

以下凡標「提案」的，都是我依上面的來源組合出來的，不是任何廠商或 Hamina 的原文規則。

### 我們目前和各來源的差異

| 項目 | 我們目前 | 來源怎麼做 |
|---|---|---|
| 5/6 GHz 門檻 | 任一 5/6 GHz 射頻 ≥ -85 dBm 就留在 5/6 GHz | 有出處的數字都比 -85 嚴格得多：Android 5 GHz 最低 -77 [V]、iOS -65 / macOS -68（兩份報告對可信度有衝突）、Apple 漫遊觸發 -70 / -75 [V] |
| 6 vs 5 GHz | 比原始 RSSI，6 GHz 常輸 | Apple 自動連線把 6 GHz 排第一 [V]；wpa_supplicant 每差一個頻段偏 2 dB [V]；Apple 和 Android 的評分都偏好寬頻道 [V] |
| 跨頻段切換 | 沒有遲滯 | 沒有任何來源是無遲滯切換；Apple 用同一組觸發門檻和差值 [V]，Android 給目前連線加分 [V] |

### 規則提案（依裝置類型帶參數）

**1. 2.4 vs 5/6 GHz（提案）**

- 任一 5/6 GHz 候選 ≥ `T_band` 時，只在 5/6 GHz 裡選；否則才考慮 2.4 GHz。這條規則的結構對應 Hamina 的「no 5 GHz option」。
- `T_band` 的候選值：
  - iPhone：-65（衝突待查證）
  - Mac：-68（衝突待查證）
  - Android：-77（[V]，取自 AOSP 的 5 GHz 最低可用門檻）
  - Windows：沒有公開數值，需要另定

**2. 6 vs 5 GHz（提案，二擇一）**

- (a) 嚴格順序：6 GHz 候選 ≥ `T_band` 時優先 6 GHz。依據是 Apple 的自動連線順序 [V]。
- (b) 加權：每高一個頻段加 2 dB 後再比 RSSI。依據是 wpa_supplicant [V]。
- 可以加一個選項：6 GHz 頻道較寬時再加權。這只有 Apple 的評分順序和 Podcast 的定性描述支持，沒有任何具體 dB 數字。

**3. 跨頻段遲滯（提案）**

不另設一套規則，跨頻段沿用同頻段漫遊的觸發門檻和差值：

| 裝置 | 觸發 | 差值 | 來源 |
|---|---|---|---|
| iPhone | < -70 dBm | 8 dB（傳資料）/ 12 dB（閒置） | [V] |
| Mac | < -75 dBm | 12 dB | [V] |
| Android | 2.4 > -73 / 5–6 > -70 視為足夠，不切換 | 加分值未取得具體數字，需要另定 | [V] |

目前連線還在「足夠」範圍內時，就算另一個頻段更強也不切換；低於觸發門檻後，候選必須超過差值才切換。

### 不確定的地方

- iOS -65 和 macOS -68 是否仍是 Apple 現行規則：兩份報告的判定互相衝突，需要重抓 dep3b0448c58 頁面確認。
- Android 給目前連線的加分預設值、6 GHz 的最低門檻、wpa_supplicant 的差值梯度：都沒有取得具體數字。
- Windows / Intel 沒有任何 dBm 數值，Hamina 自己的實測參數也沒公開。
- Hamina 實際用哪些數字完全無法證實。以上全都是「照廠商文件」的推論。

### 需要你拍板的事

1. `T_band` 採用哪一組數字？是照裝置類型分開設，還是先統一一個值？
2. 6 vs 5 GHz 採 (a) 嚴格順序，還是 (b) 每頻段 +2 dB？
3. 跨頻段遲滯是否沿用同頻段的觸發門檻＋差值？Android 的加分沒有數字，要怎麼處理？
4. 要不要先花時間查證 -65 / -68 的衝突，再開始實作？