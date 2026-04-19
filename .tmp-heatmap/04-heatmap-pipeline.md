# 04. Heatmap 計算與渲染管線

## 1. 支援的 Heatmap 類型

> **2026-04-19 更正**：原稿依 GraphQL schema 寫「8 種」，**嚴重低估**。實測 `progressiveHeatmapWorker` 的 dispatch table (`uQ`) 共 **~50 種** visualizationType。詳列見 [17-progressive-heatmap-worker.md §4](17-progressive-heatmap-worker.md)。

從 GraphQL `HeatmapRequirementSettings` 可確認使用者可設定的 **requirement 類別** 8 大類：

```graphql
fragment heatmapRequirementSettingsFields on HeatmapRequirementSettings {
    primaryCoverageEnabled      # 主覆蓋（最強 AP 的 RSSI）
    secondaryCoverageEnabled    # 次覆蓋（第二強 AP，用於漫遊）
    tertiaryCoverageEnabled     # 三覆蓋
    snrEnabled                  # 訊號雜訊比
    dataRateEnabled             # 估計資料速率
    interferenceEnabled         # 同頻互擾
    uplinkEnabled               # 上行鏈路品質
    channelUtilizationEnabled   # 頻道佔用率
}
```

這 8 個是**要求類別**，不等於可視化類型。實際底層視覺化類型拆得更細：

- **RSSI / RSRP / BLE RSSI / UWB RSSI / Enocean RSSI / Zigbee RSSI** × **Max / Secondary / Tertiary** × **Downlink / Uplink** ≈ 36 組
- **Snr / Sinr** × Downlink / Uplink = 4 組
- **DataRate / CellularDataRate** × Downlink / Uplink = 4 組
- **Interference / ChannelUtilization*3 / WifiRequirements / WifiNumberOfAccessPoints / UwbAccuracy / UwbDop / UwbNumberOfAnchorsUplink** ≈ 10 組

額外 debug / 材料可視化（從 wasm 字串）：
- `Predicted RSSI` / `Measured RSSI`
- `LOS Attenuation Y`（LOS 可視化）
- Path Loss / FSPL / Wall / Zone debug layers

## 2. 每種 heatmap 的計算公式

### 2.1 Primary Coverage (RSSI)

對每個 grid 點 `p`，對所有 AP 的 radio：

$$
\text{RSSI}_{ap}(p) = P_{tx} + G_{tx}(\theta,\phi) - \text{PL}(ap \to p)
$$

主覆蓋 = 最強：

$$
\text{RSSI}_{primary}(p) = \max_{ap} \text{RSSI}_{ap}(p)
$$

### 2.2 Secondary / Tertiary Coverage

按 RSSI 排序取第 2 / 第 3 強。用於：
- 漫遊規劃：確保每點至少兩個 AP > -70 dBm
- 備援：避免單 AP 故障造成盲區

### 2.3 SNR

$$
\text{SNR}(p) = \text{RSSI}_{primary}(p) - N_{floor}(band, BW)
$$

$$
N_{floor}(BW) = \text{wifiNoiseFloor}_{band} + 10 \log_{10}\left(\frac{BW_{MHz}}{20}\right)
$$

但若 `interferenceEnabled`，底噪會加上同頻互擾：

$$
N_{eff} = 10 \log_{10}\left(10^{N_{floor}/10} + \sum_{interferer} 10^{\text{RSSI}_{intf}/10}\right)
$$

### 2.4 Data Rate

查表：(MCS, SNR, channelWidth, spatialStreams) → Mbps
典型 802.11ax 表：

| MCS | Min SNR (dB) | 20MHz 1SS | 80MHz 1SS | 80MHz 4SS |
|---|---|---|---|---|
| 0 | 2 | 8.6 | 36 | 144 |
| 7 | 19 | 72 | 309 | 1200 |
| 11 (HE) | 30 | 143 | 600 | 2400 |

NPv1 從 `radio.phy / maxModulationSupported / streamCount / channelWidth` 得出可用 MCS 範圍。

### 2.5 Interference (同頻互擾)

```cpp
getMutualWifiInterference(frequencyBand, rssiLimit)
getWifiInterference(frequencyBand, associationLimitDBm, rssiLimit,
                    useClientSignals, useMutualSignals)
```

分兩類：
- **Mutual interference**: 其他 AP 用相同頻道或重疊頻道
- **Client-generated**: 附近 client 的上行干擾

$$
I(p) = \sum_{\substack{ap_j \neq ap_{serving} \\ ch_j \cap ch_{serving} \neq \emptyset}} \text{RSSI}_{ap_j}(p) \cdot \text{overlap\_factor}
$$

`overlap_factor`：
- 完全重疊（同 primary channel）：1.0
- 部分重疊（相鄰 2.4GHz 頻道）：0.3~0.7
- 完全不重疊：0

### 2.6 Channel Utilization

結合：
1. client 密度（由 `CapacitySettings` 估算）
2. 客戶端平均數據需求
3. 可達 data rate
4. Airtime 模型

$$
\text{CU}(p) \approx \frac{\sum_{client} \frac{\text{demand}_{client}}{\text{dataRate}(client \to ap)}}{1}
$$

NPv1 從 `CapacitySettings` 拿每頻段 client limit 做估計。

### 2.7 Uplink

從接收端視角看 AP 收到的訊號強度：

$$
\text{Uplink RSSI}(p) = P_{tx,client} + G_{client} - \text{PL}(p \to ap) + G_{rx,ap}(\theta,\phi)
$$

`client TX power`：`HeatmapSettings.wifiClientTxPowerDBm`（通常 15 dBm）
Uplink 差異來源：client TX 較低 → uplink 總是比 downlink 弱 5-10 dB。

## 3. 三種 Prediction Mode

```graphql
predictionModeSettingSimulated   # 純模擬（只用 DPM 算）
predictionModeSettingLive        # 即時實測（連 AP 讀真 RSSI）
predictionModeAuto               # 自動：有 survey 用 survey，沒有用模擬
```

### 3.1 Simulated Mode
- 100% 靠 DPM 計算
- 最快、最一致
- 精度取決於牆材料設定

### 3.2 Live Mode
- 從現場 AP 取得 client association table 或 walking survey
- 顯示**實測 heatmap**
- 需要 NPv1 或對接的 WLAN controller API

### 3.3 Auto Mode
- 有 `AttenuatingTriangleField + envLearningModel` → 用校正網格
- 沒有 → fallback simulated
- 常見用法：先 simulated 設計 → 部署後 walking survey 校正 → 切 auto 看實際

## 4. 閾值與色彩映射

```graphql
fragment heatmapThresholdsFields on HeatmapThresholds {
    id technology heatmap
    labels          # ["Edge", "Low", "Decent", "High"]
    values          # [-85, -75, -70, -65]  (RSSI)
}
```

**色階**（從實際網頁觀察）：
- Edge (-85 以下): 深紅或透明
- Low (-75 ~ -85): 紅
- Decent (-70 ~ -75): 黃
- High (-65+): 綠

MapImage API URL 的 `dc=` / `rc=` 參數：
```
dc=090706,FB3D00,D4A84B,989797,1AB93D,FEFE00,FD83A1,0B81F0
rc=FD83A1,D4A84B,FEFE00,FB3D00,0B81F0,1AB93D
```

- `dc` = discrete colors（分段色）
- `rc` = ramp colors（連續漸變）
- 多色階對應多種 heatmap 類型

## 5. Grid 採樣與插值

### 5.1 Grid 解析度

推測採動態解析度：
- 縮放出：粗網格（50cm~1m cell）
- 縮放入：細網格（10~20cm cell）
- Triangle Grid 本身是靜態解析度；viewport 顯示時用 bilinear 插值

### 5.2 Cut-out Distance

```
HeatmapSettings.cutoutDistanceMeters
```

超過此距離的 grid cell 不計算（省時間）。典型 50~100m。

### 5.3 Client Height

```
HeatmapSettings.clientHeightMeters
```

Heatmap 的 z 平面高度，通常 1.0~1.5m（手機放口袋到頭部）。全樓層 grid 都在這個高度切片。

## 6. Raised Heatmap（3D 展示）

```
HeatmapSettings.raisedHeatmap
```

布林。啟用時：
- Heatmap 從 2D 拉成 3D 曲面（視覺效果）
- 高度代表 RSSI 強度
- 不是另外計算，只是渲染差異

**實現細節（wasm + index.js 分析後補充）**：
- Grid 計算階段完全相同：所有 cell 仍在 `clientHeightMeters` 單一平面上算 RSSI
- 差異僅在 GPU 頂點著色階段：將 `(gridX, gridY, RSSI_normalized * heightScale)` 送進 vertex shader，把原本 z=0 的平面 mesh 頂點抬起
- Fragment shader 照用原本的 RSSI → 顏色查表
- 因此 `raisedHeatmap` 開關**不會**重算 heatmap、不會觸發 wasm；只是切換 WebGL pipeline（或 Three.js material）
- 效能成本 ≈ 0，純 GPU 端工作

## 7. Opacity / Legend

```
HeatmapSettings.opacityPercentage        # 0~100
HeatmapSettings.wifiRssiLegendShowAll    # 顯示全頻段 or 單頻
```

## 8. 完整 heatmap 計算流程（複現版）

```python
def compute_heatmap(map_data, ap_list, heatmap_settings, freq_band):
    grid = build_regular_triangle_grid(
        map_data.extent,
        cell_size=detect_resolution(viewport)
    )

    # 為每 AP 預計算加速結構
    accel = DominantPathAccelerationStructure(map_data)

    noise_floor = heatmap_settings.noise_floor(freq_band)
    client_h = heatmap_settings.clientHeightMeters
    cutoff = heatmap_settings.cutoutDistanceMeters

    result = {}
    for cell in grid:
        p = Point3D(cell.x, cell.y, client_h)

        # 對每 AP 算 RSSI
        rssi_per_ap = []
        for ap in ap_list:
            if ap.frequency_band != freq_band:
                continue
            if distance(ap.pos, p) > cutoff:
                continue
            pl = accel.estimatePathLoss(ap.pos, p, ap.freqMHz,
                                         max_order=2)
            gain_tx = ap.antenna.gainAt(p)
            rssi = ap.txPower + gain_tx - pl
            rssi_per_ap.append((ap, rssi))

        rssi_per_ap.sort(key=lambda x: -x[1])

        # 各層 heatmap
        primary = rssi_per_ap[0][1] if rssi_per_ap else -120
        secondary = rssi_per_ap[1][1] if len(rssi_per_ap) > 1 else -120

        # SNR
        interference = sum(10**(r/10) for ap,r in rssi_per_ap[1:]
                           if overlaps_channel(ap, rssi_per_ap[0][0]))
        N_eff = 10 * log10(10**(noise_floor/10) + interference)
        snr = primary - N_eff

        # Data rate
        serving_ap = rssi_per_ap[0][0]
        mcs = lookup_mcs(snr, serving_ap.phy)
        data_rate = mcs.rate * serving_ap.streamCount

        result[cell.id] = {
            'primary_rssi': primary,
            'secondary_rssi': secondary,
            'snr': snr,
            'data_rate': data_rate,
            'interference_dbm': 10*log10(interference) if interference else -INF,
        }
    return result
```

## 9. 重算觸發條件

前端 reactive：任何以下改變都觸發 wasm 重算：
- AP 移動/新增/刪除
- 牆/zone 編輯
- 頻段/頻道切換
- HeatmapSettings 任何欄位變更
- 樓層切換（load 新 map objects）
- Mutation GraphQL 回來更新 local state → React 重 render

重算通常在 Web Worker 中執行（wasm with pthread；符號中有 `emscripten_thread_*`），避免卡 UI。

## 10. 邊緣情況

- **AP 無 antenna**：fallback 全向 (0 dBi isotropic)
- **AP 禁用** (`enabled=false`)：跳過，不計入任何 heatmap
- **Client TX 限制**：在 uplink 計算要考慮 PSD 限制（低功率模式）
- **Map 邊界外**：grid 只覆蓋 ScopeZone 內部；scope 外透明
