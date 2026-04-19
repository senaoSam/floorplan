# 02. 材料 / 牆 / 區域衰減模型

## 1. ITU-R P.2040：標準建材衰減模型

NPv1 核心使用 ITU-R P.2040-3 推薦書的材料參數化方法。

### 1.1 關鍵 wasm API

```cpp
addWallTypeITURModel(
    wallTypeId,
    attenuationDB,         // 參考頻率下的衰減 (dB)
    referenceFrequencyMHz, // 基準頻率（通常 2400 或 5000 MHz）
    wallTopHeightM,        // 牆頂高度
    wallBottomHeightM,     // 牆底高度
    isConductor,           // true = 金屬；false = 介電質
    iturmodel_a,
    iturmodel_b,
    iturmodel_c,
    iturmodel_d
);

addAttenuatingZoneTypeITURModel(
    zoneTypeId,
    topHeightM, bottomHeightM,
    pathLossExp,
    attenuationDBPerM,
    referenceFrequencyMHz,
    isConductor,
    iturmodel_a, iturmodel_b, iturmodel_c, iturmodel_d
);
```

### 1.2 ITU-R P.2040 複介電常數公式

對**介電質**（`isConductor = false`）：

$$
\eta'(f) = a \cdot f^{b}
$$
$$
\sigma(f) = c \cdot f^{d}
$$

- `η'` 相對介電常數 (relative permittivity, 實部)
- `σ` 電導率 (S/m)
- `f` 頻率 (GHz)
- `a, b, c, d` = ITU-R 表格係數，因材料不同

**ITU-R 範例係數表（P.2040-3）**：

| 材料 | a | b | c | d |
|---|---|---|---|---|
| Concrete | 5.31 | 0 | 0.0326 | 0.8095 |
| Brick | 3.75 | 0 | 0.038 | 0 |
| Plasterboard (Drywall) | 2.94 | 0 | 0.0116 | 0.7076 |
| Wood | 1.99 | 0 | 0.0047 | 1.0718 |
| Glass | 6.27 | 0 | 0.0043 | 1.1925 |
| Ceiling board | 1.50 | 0 | 0.0005 | 1.1634 |
| Chipboard | 2.58 | 0 | 0.0217 | 0.7800 |
| Floorboard | 3.66 | 0 | 0.0044 | 1.3515 |
| Metal | 1 | 0 | 10⁷ | 0 |

對**金屬**（`isConductor = true`）：直接視為近乎全反射（例如 σ=10⁷ S/m），穿透衰減取為極大值（典型 20+ dB 或更高），公式退化。

### 1.3 穿透損耗公式

從 η', σ 推單次穿牆損耗（單層均勻板子，垂直入射）：

$$
L_{wall}(f, \text{thickness}) \text{ dB} = \text{function of } \eta'(f),\sigma(f),d,\theta_{inc}
$$

最常見的是 ITU-R 推薦的簡化式：

$$
L_{dB} = \alpha(f) \cdot d
$$

$$
\alpha(f) = \frac{20\pi f \sqrt{\eta'}}{\ln(10) \cdot c} \cdot \text{Im}(\sqrt{1 - j \cdot 18\sigma / (f_{GHz} \eta')})
$$

**NPv1 的實務做法**（從 API 推論）：
- 使用者輸入「在參考頻率下此牆 = X dB」
- 引擎用 `(a, b, c, d)` 做**頻率外推**：算在其他頻率下的 α ratio，把 X dB 按比例調整
- 不逐層積分複雜反射，只做單一 bulk 衰減

```python
def wall_att_db(ref_att_db, ref_freq_mhz, target_freq_mhz, a, b, c, d, is_conductor):
    if is_conductor:
        return ref_att_db  # 金屬，頻率相關性小
    eta_ref = a * (ref_freq_mhz/1000)**b
    sig_ref = c * (ref_freq_mhz/1000)**d
    eta_tgt = a * (target_freq_mhz/1000)**b
    sig_tgt = c * (target_freq_mhz/1000)**d
    alpha_ref = attenuation_constant(ref_freq_mhz, eta_ref, sig_ref)
    alpha_tgt = attenuation_constant(target_freq_mhz, eta_tgt, sig_tgt)
    return ref_att_db * (alpha_tgt / alpha_ref)
```

## 2. 牆衰減流程 (Wall Attenuation)

### 2.1 資料結構

```graphql
fragment wallTypeFields on WallType {
    id
    name                  # "Concrete", "Drywall"
    color                 # 顯示色
    shortcutKey           # UI 快捷鍵
    topEdge bottomEdge    # 牆頂 / 牆底高度 (m)
    width                 # 牆厚度 (m) — 用於 dB/m 轉換
    reflectivity          # 反射率 (0~1)
    attenuation           # 參考頻率下的 dB 值
    materialClass         # enum：Concrete/Brick/Drywall/...
    transparencyEnabled
}
```

對應 wasm：`WallAttenuationProvider`、`ObstacleTypeHeightAttenuationModel`

### 2.2 穿牆判定

路徑損耗計算中，對每條射線 `A→B`：

1. R-tree 空間索引找出所有可能相交的牆
2. 對每面牆做 3D 線段/矩形相交（考慮 `topEdge / bottomEdge` 過濾高度）
3. 累加每面牆的頻率調整後 `attenuation`

**入射角修正**（推測有做，但 API 不明）：
- 斜射角穿牆的等效厚度 = `width / cos(θ_inc)`
- 法線附近的路徑損耗 ≈ 參考值；擦邊路徑損耗可達 2-5 倍

### 2.3 反射（Reflectivity）

`reflectivity` 欄位存在，但 DPM 本身不做反射路徑追蹤。推測用途：
- `ObstacleTypeHeightAttenuationModel` 可能在 diffraction 計算時加入邊緣反射修正
- 或 3D 視覺化用

## 3. 衰減區域 (Attenuating Zone)

### 3.1 四種 zone 幾何

```cpp
// 基本 2D zone（柱狀體）
addAttenuatingZoneType(zoneTypeId, topHeightM, bottomHeightM,
                       pathLossExp, attenuationDBPerM);

// 帶 ITU-R 材料的 zone
addAttenuatingZoneTypeITURModel(..., isConductor, a, b, c, d);

// 帶 max loss cap 的 zone
addAttenuatingZoneWithLogLDMaxAttenuationModel(
    zoneID, polygon, topH, botH,
    pathLossExp, attenuationDBPerM,
    maxLDAttenuationDB,   // 上限：即使無限深也不超過此值
    subLevel, storageType
);

// 傾斜頂/底面的 zone
addSlopedAttenuatingZone(..., topSlopeX, topSlopeY, topOriginOffset,
                              bottomSlopeX, bottomSlopeY, bottomOriginOffset);

// 專用：高架地板
appendRaisedFloorZone(zoneID, polygon, topH, botH,
                       attenuationDBPerM, maxLDAttenuationDB, pathLossExponent);
appendSlopedFloorZone(...);
```

### 3.2 Zone 內的 RF 公式

射線在 zone 內走的距離 `L` 會貢獻：

$$
L_{zone} = \min(L \times \alpha, L_{max})
$$

其中：
- `α` = `attenuationDBPerM`
- `L_{max}` = `maxLDAttenuationDB`（防止過大）
- **PLE 也被 zone 覆寫**：在 zone 內用 zone 專屬 PLE 而非全域

### 3.3 Sloped Plane 數學

頂平面方程：

$$
z = \text{topSlopeX} \cdot x + \text{topSlopeY} \cdot y + \text{topOriginOffset}
$$

射線 `P₀ + t·d` 與此平面交點：

$$
t = \frac{\text{offset} - \text{slopeX} \cdot P_{0x} - \text{slopeY} \cdot P_{0y} - P_{0z}}{d_z - \text{slopeX} \cdot d_x - \text{slopeY} \cdot d_y}
$$

射線在 zone 內的有效長度 = min(exit_t, top_plane_t, bottom_plane_t) − max(entry_t, ...)

## 4. 特殊 zone 類型

### 4.1 Raised Floor Zone（高架地板）

```graphql
fragment raisedFloorZoneFields on RaisedFloorZone {
    id area height attenuationDbPerMeter slabOnly
}
```

用於：機房、資料中心、舞台。電纜在地板下走，AP 在地板上，RSSI 穿透地板要多扣衰減。

### 4.2 Sloped Floor（傾斜地板/樓梯）

```graphql
fragment slopedFloorFields on SlopedFloor {
    id area attenuationDbPerMeter
    crowdEnabled      # 考慮人群擠滿時的額外衰減
    drawStairs        # 視覺化當樓梯畫
    slabOnly
    crowdHeight
    crowdAttenuationDbPerMeter
}
```

**Crowd 修正**：階梯座位區人滿時，人體（水袋）是強衰減體。`crowdAttenuationDbPerMeter` 在 `crowdHeight` 以下生效。

### 4.3 Hole In Floor Zone（地板孔洞）

```graphql
fragment holeInFloorZoneFields on HoleInFloorZone {
    id area type
}
```

樓層間的挑高、開放樓梯井：該區域 `floorAttenuation` = 0，跨樓層傳播不扣地板損耗。

## 5. Attenuating Triangle Field（ML 衰減網格）

**最特別的 NPv1 功能**：

```graphql
fragment attenuatingTriangleFieldFields on AttenuatingTriangleField {
    id
    triangleField      # 三角網格幾何 + 每個三角形的衰減值
    batchId
    envLearningModel   # 關聯的 ML 模型
}
fragment surveyAttenuatingTriangleFieldFields on SurveyAttenuatingTriangleField {
    id triangleField batchId envLearningModel
}
```

### 5.1 運作方式（詳見 06-env-learning.md）

1. 用戶提供 survey 實測資料（walking test RSSI 點）
2. 後端 ML 模型反推：每個小三角形在每個頻段下的「修正衰減」
3. 前端下載這張**校正網格**，傳給 wasm (`RegularTriangleGridAttenuationService`)
4. DPM 路徑損耗計算在最後多一步：沿射線累加三角形修正值

### 5.2 為何用三角形而非連續函數

- 連續函數校正（如 kriging）在邊緣會過擬合
- 三角形分片線性 + batch 約束：可解釋、可局部編輯
- `batchId`：不同 survey 批次可獨立管理

## 6. 系統級常數

```cpp
// wasm 存在的全域欄位
wifiNoiseFloor2_4GHz   // 預設 -95 ~ -100 dBm
wifiNoiseFloor5GHz     // 預設 -95 dBm
wifiNoiseFloor6GHz
staticNoiseFloor20MHz2_4GHz  // 頻寬 20MHz 下的理論底噪
staticNoiseFloor20MHz5GHz
staticNoiseFloor20MHz6GHz

REFERENCE_FREQUENCY_MHZ  // 材料外推的基準，通常 2400 或 5000

// 頻寬 → noise floor 修正
// NF(BW) = NF(20) + 10·log10(BW/20)
```

## 7. 完整複現參數清單

建一套 RF 引擎需要至少支援以下參數：

### 每個牆類型
- `attenuationDB` @ `referenceFrequencyMHz`
- ITU-R `(a, b, c, d)` 四參數
- `isConductor`
- `topEdgeHeight`, `bottomEdgeHeight`（通常 0 ~ 3m）
- `width`（厚度）
- `reflectivity`（0~1）

### 每個衰減區域類型
- `attenuationDBPerM`
- `pathLossExp`
- `topAltM`, `bottomAltM`
- `maxLDAttenuationDB` (optional)
- ITU-R 四參數 (optional)
- sloped 平面 6 參數 (optional)

### 每面牆實例
- `start`, `end` (2D 點)
- `wallTypeId`
- 高度繼承自 wallType 但可覆寫

### 每個接收區域（可選）
- triangle mesh + per-triangle attenuation
- env-learning batchId

### 全域
- 每頻段 `pathLossExponent` (default PLE)
- `diffractionLossDBPer90Deg`
- 每頻段 `noiseFloor`
