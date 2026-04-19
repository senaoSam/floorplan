# 05. 頻道規劃與干擾最小化

## 1. 核心 API

```cpp
setChannelOptimiserInput(
    accessPointContainer, activeMapId, extent,
    fraMode,                  // Frequency Reuse Analysis mode
    primaryRssiLimitDBm,      // -70 典型，用來決定 AP 覆蓋半徑
    channelScheme,            // 頻道分配策略
    pathLossExp,              // 估傳播用
    predictionMode,
    options
);

ChannelOptimiser::doSelectWifiChannelsInBand(
    freqBand, channelWidth,
    workspace, radios, radiosToModify,
    DoSelectWifiChannelsMode
);

ChannelOptimiser::selectWifiRadiosToDisableBasedOnCoverage(
    freqBand, primaryRssiLimit, radios, workspace
);
```

## 2. 目標函數

最小化「重疊干擾加權和」，同時維持每處覆蓋率。

$$
\min \sum_{p \in grid} \sum_{ap_i, ap_j \text{ overlap}} w_{ij}(p) \cdot \text{overlap}(ch_i, ch_j)
$$

- $w_{ij}(p) = f(\text{RSSI}_i(p), \text{RSSI}_j(p))$：兩者都強才算真互擾
- $\text{overlap}(ch_i, ch_j)$：0~1 重疊比例

## 3. 頻道資源庫

```cpp
addWifiChannel(frequencyBand, channelWidth,
               channelCenterFrequencyIndex0,
               channelCenterFrequencyIndex1,
               primaryChannel);
```

### 3.1 802.11 頻道編號慣例

**2.4 GHz**：ch 1~14；20MHz 只有 1/6/11 不重疊
**5 GHz**：ch 36, 40, 44, 48, ... 165；支援 20/40/80/160 MHz 頻寬
**6 GHz**：ch 1~233；20MHz 間隔，支援 20/40/80/160/320 MHz

`channelCenterFrequencyIndex0 / Index1`：
- 80MHz = 兩個 40MHz 中心頻率
- 160MHz = 兩個 80MHz 段（支援非連續 80+80）

### 3.2 Channel Width Auto

```graphql
fragment wifiBandChannelSettings on WifiBandChannelSettings {
    channelWidthMHz
    primaryChannelPool
    channelWidthAuto                          # bool
    allowedChannelWidths
    channelWidthAutoAllowedInterferenceShare  # 閾值
    allowedPrimaryChannels
}

channelWidthAutoMinAllowedRelativeFitness5GHz
channelWidthAutoMinAllowedRelativeFitness6GHz
```

**自動頻寬**的邏輯：
1. 先用最大頻寬算 fitness（吞吐量 - 干擾）
2. 若 fitness / 理想值 < threshold，降頻寬（160 → 80 → 40 → 20）
3. 重選直到滿意

**Threshold 預設值**：wasm 字串與 index.js 均未直接暴露此常數，推測範圍 0.7 ~ 0.85（業界經驗值；0.8 為常見起點）。複現時建議設為可調參數，預設 `0.8`，以 NPv1 官方 UI 實測行為校正。

## 4. 演算法選擇（推測）

典型頻道規劃使用：
- **Greedy (DSATUR colouring)** 最常見：先處理覆蓋範圍大的 AP，選當前最少用到的頻道
- **Simulated Annealing / GA**：全局最佳化，較慢
- **ILP solver**：小規模精確解
- NPv1 `DoSelectWifiChannelsMode` enum 暗示有多種模式可選

## 5. 關閉冗餘 AP

```cpp
selectWifiRadiosToDisableBasedOnCoverage(freqBand, primaryRssiLimit, ...)
```

邏輯：
1. 對每個 AP 計算其「獨占覆蓋面積」（該 AP 是此區域 primary，且 RSSI > limit）
2. 若某 AP 獨占面積 ≈ 0 （完全被鄰近 AP 覆蓋），標記為可關閉
3. 節省 airtime、減少同頻干擾

## 6. 頻段偏好 (Band Steering)

```cpp
setBandPreferenceWithPriority(frequencyBand, highSignalLimitDBm, priority)
setBandPreference(frequencyBand, highSignalLimitDBm)
setBandBoost(frequencyBand, signalLimitDBm, signalBoostDeltaDB)
```

用於模擬 client 怎麼選頻段：
- 6GHz 強 → 優先 6G；弱 → 降到 5G
- `signalLimitDBm`：切換閾值
- `signalBoostDeltaDB`：人工偏好偏移（偏好 5G → 5G RSSI +3dB 再比較）

## 7. 2.4GHz 特別處理

```cpp
DISABLE_EXTRA_2_4GHZ           # AP 多時，關閉部分 2.4G radio
CONVERT_ALL_EXTRA_2_4GHZ_TO_5GHZ  # 2.4G radio 轉為 5G 額外 radio
AUTO_EXTRA_2_4_GHZ_TO_5GHZ     # 自動決定
```

2.4G 只有 3 個不重疊頻道，AP 密度高時互擾嚴重。NPv1 支援：
- 一顆 AP 同時跑 2.4G + 5G 兩 radio → 高密度環境可關 2.4G 避免互擾
- 或把 2.4G 硬體重配成 5G 額外 radio

## 8. AFC (6GHz Automatic Frequency Coordination)

```graphql
fragment apAfcRequestParametersFields on ApAfcRequestParameters { ... }
fragment apAfcResponseDataFields on ApAfcResponseData { ... }

ChannelSettings.afcEnabled
```

**AFC 流程**：
1. AP 啟動時上報位置（GPS）
2. 送請求到 AFC 伺服器（FCC/產業聯盟維護）
3. 回傳：可用頻道清單 + 每頻道最大 EIRP
4. 規劃時考慮 AFC 限制（室外 6GHz Standard Power Device 強制）

NPv1 把 AFC 結果快取在 `ApAfcResponseData` 中，頻道優化時濾掉 AFC 禁用頻道。

## 9. Cellular 頻道（LTE/5G NR）

```cpp
addCellularChannelSet(frequencyBand, channelWidth, numberOfChannels);
addTDDChannel(channelNumber, frequencyMHz);
addFDDChannel(channelNumber, downlinkFrequencyMHz, uplinkFrequencyMHz);
addCellularFR1NRRadio(..., numerology, cyclicPrefix, ..., mimoSupport, ...);
addCellularLTERadio(...);
```

NPv1 也支援企業級蜂巢式網路（私網 4G/5G）規劃，不只 WiFi。邏輯類似但增加：
- TDD vs FDD 模式
- 5G NR SCS（Sub-Carrier Spacing / numerology）
- LTE coexistence（`supportLTECoexistence`）

## 10. 複現實作骨架

```python
class ChannelOptimizer:
    def __init__(self, aps, walls, zones, rssi_limit=-70):
        self.aps = aps
        self.engine = RfEngine(walls, zones)
        self.rssi_limit = rssi_limit

    def optimize(self, band, width_mhz, candidate_channels):
        # 1. 預計算每 AP 覆蓋範圍
        coverage = {}
        for ap in self.aps:
            grid = self.engine.compute_coverage(ap, band)
            coverage[ap.id] = {p for p in grid if grid[p] >= self.rssi_limit}

        # 2. 建 AP 衝突圖
        graph = {}
        for i, a in enumerate(self.aps):
            graph[a.id] = []
            for b in self.aps[i+1:]:
                overlap = coverage[a.id] & coverage[b.id]
                if len(overlap) > 0.1 * len(coverage[a.id]):
                    graph[a.id].append((b.id, len(overlap)))

        # 3. 貪婪染色 (最大衝突優先)
        assignment = {}
        aps_sorted = sorted(self.aps, key=lambda a: -sum(w for _,w in graph[a.id]))
        for ap in aps_sorted:
            used = set()
            for nb_id, _ in graph[ap.id]:
                if nb_id in assignment:
                    used.add(assignment[nb_id])
            free = [ch for ch in candidate_channels if ch not in used]
            if not free:
                # 有衝突，選衝突最小的
                assignment[ap.id] = min(candidate_channels,
                    key=lambda ch: sum(1 for nb,_ in graph[ap.id]
                                       if assignment.get(nb) == ch))
            else:
                assignment[ap.id] = free[0]

        # 4. 可選：local search / SA 改善
        for _ in range(100):
            improved = self.try_swap(assignment, graph)
            if not improved: break
        return assignment
```

## 11. 頻道品質 (Fitness) 計算

```cpp
DataStatistics                    # wasm struct
channelWidthAutoMinAllowedRelativeFitness5GHz
```

Fitness 結合：
- **Coverage**：多少比例 grid 有 RSSI ≥ limit
- **Interference**：同頻互擾總能量
- **Throughput**：可達總 Mbps
- **Fairness**：各 AP 負載平衡

$$
\text{Fitness} = w_1 \cdot \text{CovRatio} - w_2 \cdot \text{IntfNorm} + w_3 \cdot \text{TputNorm} - w_4 \cdot \text{LoadImbalance}
$$
