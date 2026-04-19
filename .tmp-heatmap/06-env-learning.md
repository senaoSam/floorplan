# 06. Survey 校正與 Environment Learning

> 這是 NPv1 最具差異化的功能。商業軟體常有此方向但實作細節多為 proprietary；以下是從 wasm 符號 + GraphQL fields 技術分析推論。

## 1. 相關 wasm 符號

```cpp
AbstractSurveyAttenuationEstimator           // 基類
EnvLearningWallZoneAttenuationEstimator      // 主 ML 估計器
AttenuatingObjectPresenceEvaluator           // 判斷該位置有無障礙
targetAttenuationZoneTypeIds_                // 要估計的目標 zone 類型
ResourceContainer.antennaIds
getSurveyAttenuationWallTypeEstimate(modelSettings, measuredRadios)

// RSSI 誤差統計
totalRssiErrorStats_2_4GHz / 5GHz / 6GHz
totalWeightedMinus65RssiErrorStats_2_4GHz      // -65dBm 錨點加權誤差
totalWeightedMinus65RssiErrorStats_5GHz
totalWeightedMinus65RssiErrorStats_6GHz
totalWeightedMinus90RssiErrorStats_2_4GHz      // -90dBm 錨點加權誤差
totalWeightedMinus90RssiErrorStats_5GHz
totalWeightedMinus90RssiErrorStats_6GHz

// 反推 AP 屬性
estimatedTXPowerStats2_4GHz / 5GHz / 6GHz
txAntennaGainStats
rxAntennaGainStats

// 先驗機率（Bayesian）
setFrequencyBandPriorProbability(frequencyBand, priorProbabilityForBand)
```

## 2. Survey 資料流

```
Walking Test (NPv1 Mobile App)
   │
   ▼
 每個 GPS + floor 位置記錄:
   - 感測到所有 AP 的 BSSID + RSSI
   - 頻段、頻道、channel width
   - Timestamp
   │
   ▼
Backend: ML 模型
   ├── Input: 實測 RSSI 點 + 規劃資料（牆、zone、AP、天線）
   ├── Output: 
   │     - 每牆類型的修正衰減 dB
   │     - 每頻段 PLE 估計 (pleEstimate2_4GHz...)
   │     - 反推的真實 TX power (estimatedTXPowerStats*)
   │     - Attenuating Triangle Field (格化修正)
   │     - Survey Attenuating Triangle Field
   └── Metrics: totalRssiErrorStats, weightedErrorStats
   │
   ▼
Frontend 下載這份「校正包」
   │
   ▼
wasm 引擎使用 RegularTriangleGridAttenuationService 查詢
```

## 3. 核心最佳化問題

定義：給定 N 個實測點 $\{(p_k, ap_k, \text{RSSI}_k^{meas})\}$，找一組參數 $\Theta$ 使預測誤差最小：

$$
\Theta^* = \arg\min_\Theta \sum_k w_k \cdot \left( \text{RSSI}^{pred}_\Theta(ap_k \to p_k) - \text{RSSI}_k^{meas} \right)^2
$$

其中 $\Theta$ 包含：
- 每牆類型的 `attenuation_dB`
- 每頻段 `PLE`
- 每 AP 的真實 `TX power`（可能有偏差）
- Triangle Field 每格的修正值

$w_k$ 是**樣本權重**：
- `totalWeightedMinus65RssiErrorStats_*` → -65dBm 附近（關鍵可用邊界）加重權
- `totalWeightedMinus90RssiErrorStats_*` → -90dBm 附近（覆蓋邊界）加重權

```python
# ⚠️ 以下 sample_weight 實作為推測（非 wasm 實測）
# 證據：只確認 wasm 有 totalWeightedMinus65RssiErrorStats_* / totalWeightedMinus90RssiErrorStats_*
#       這兩類統計字串，推論其做法是在 -65 / -90 dBm 附近加重誤差懲罰
# 實際的 gaussian 參數 (mean / sigma) 及係數 (1.0 + 2.0 + 2.0) 均未在 wasm/index.js
# 中找到對應常數，僅為示意。要在複現時以實測 RMSE 比對調校
def sample_weight(measured_rssi):
    w_65 = gaussian(measured_rssi, mean=-65, sigma=5)
    w_90 = gaussian(measured_rssi, mean=-90, sigma=5)
    return 1.0 + 2.0*w_65 + 2.0*w_90  # 邊界點權重加倍（推測係數）
```

## 4. 最佳化策略（推測）

### 4.1 分階段：先全域，再局部

1. **Stage A (Global)**：只優化 PLE + TX power（少量參數，快）
   - 固定牆衰減為預設
   - 最小化總 MSE
2. **Stage B (Wall refinement)**：固定 Stage A 解，對每牆類型個別調 `attenuation_dB`
   - 只有同類型牆之間共享參數，不會過擬合個別牆
3. **Stage C (Triangle field)**：殘差投影到三角網格
   - 殘差 = measured - predicted(Stage B params)
   - 用 kriging 或最近鄰把殘差內插到三角網格
   - 存成 `AttenuatingTriangleField`

### 4.2 Bayesian 先驗

```cpp
setFrequencyBandPriorProbability(frequencyBand, priorProbabilityForBand)
```

暗示用 Bayesian 方式：
- Prior：材料的 ITU-R 標準衰減（已知分佈）
- Likelihood：觀測到的 RSSI 誤差
- Posterior：調整後的牆衰減 = MAP 估計

避免 survey 資料稀疏時過擬合到單一樣本。

## 5. AttenuatingTriangleField 格式

```graphql
fragment attenuatingTriangleFieldFields on AttenuatingTriangleField {
    id
    triangleField     # 網格 + 每格衰減 (假設 serialized)
    batchId           # 批次 ID，用於版本管理
    envLearningModel  # 關聯的 ML model id
}
```

**推測資料結構**：

```json
{
  "vertices": [[x1,y1],[x2,y2],...],
  "triangles": [[i,j,k], ...],
  "attenuation_db": {
    "2_4GHz": [att_tri_0, att_tri_1, ...],
    "5GHz": [...],
    "6GHz": [...]
  }
}
```

wasm 查詢：射線切每個三角形，該三角形的 att 乘以**穿越長度 / 三角形特徵長度**，累加。

### 5.1 為什麼分 `Attenuating` vs `SurveyAttenuating` 兩種

```
AttenuatingTriangleField            # 一般 env learning 結果
SurveyAttenuatingTriangleField      # 明確從 survey 產出（可切換 on/off 看差別）
```

設計：使用者可選擇是否使用 survey 校正；關閉時回到純模型。

## 6. 估計 AP 真實 TX 功率

實戰中：
- AP 規格 TX = 23 dBm，但實際環境功率（包含線損、啟用 EIRP cap）可能降到 18 dBm
- Survey 看到的 RSSI 比純模擬弱一致 3 dB → 反推實際 TX = 20 dBm

```cpp
estimatedTXPowerStats2_4GHz   // mean, variance
```

校正步驟：
1. 固定所有其他參數
2. 對每 AP 解最小二乘：`tx_offset = mean(measured_rssi - predicted_rssi)`
3. 過濾異常值（如一條 survey 經過該 AP 背面，gain 估錯）

## 7. 品質指標

```cpp
totalRssiErrorStats_*GHz              // 整體 RMSE
totalWeightedMinus65RssiErrorStats_*  // 關鍵閾值附近
totalWeightedMinus90RssiErrorStats_*  // 覆蓋邊界
```

**UI 顯示**：
- 綠：RMSE < 3 dB（模型校正良好）
- 黃：3-6 dB
- 紅：> 6 dB（需要更多 survey 或檢查牆設定）

## 8. 與原本 simulated mode 的差異

| Aspect | Simulated | With Env-Learning |
|---|---|---|
| PLE | 全域固定 | 每頻段各自校正 |
| 牆衰減 | ITU-R 查表 | 查表 + survey 微調 |
| 區域衰減 | 僅 UI 手動標記 | survey 反推未標記的衰減區 |
| AP TX | 規格值 | 反推實際值 |
| 誤差分布 | 均勻 | 不均（特定角落誤差大） |
| 更新速度 | 即時 | 需 server 跑 ML（異步） |

## 9. 複現實作骨架

```python
import numpy as np
from scipy.optimize import minimize

class EnvLearningEstimator:
    def __init__(self, map_data, ap_list):
        self.map = map_data
        self.aps = ap_list
        self.engine = RfEngine(map_data)

    def fit(self, survey_points, initial_params):
        """
        survey_points: [{ap_id, pos, measured_rssi, band}, ...]
        """
        def loss(theta):
            self.apply_params(theta)
            err_sq = 0
            for sp in survey_points:
                ap = self.find_ap(sp.ap_id)
                pred = self.engine.predict_rssi(ap, sp.pos, sp.band)
                w = self.sample_weight(sp.measured_rssi)
                err_sq += w * (pred - sp.measured_rssi)**2
            return err_sq

        # Stage A: PLE + TX only
        x0 = initial_params.ple_tx()
        res_a = minimize(loss, x0, method='L-BFGS-B')

        # Stage B: wall attenuations (with PLE/TX fixed)
        x0 = initial_params.walls_only()
        res_b = minimize(loss, x0, method='L-BFGS-B')

        # Stage C: triangle residuals
        residuals = self.compute_residuals(survey_points)
        triangle_field = self.krige_to_triangles(residuals)
        return {
            'ple': res_a.x[:3],
            'tx_offsets': res_a.x[3:],
            'wall_att': res_b.x,
            'triangle_field': triangle_field,
        }

    def sample_weight(self, rssi):
        w65 = np.exp(-(rssi + 65)**2 / 50)
        w90 = np.exp(-(rssi + 90)**2 / 50)
        return 1 + 2*w65 + 2*w90
```

## 10. 最小可行版本（MVP）建議

完整 env learning 太重，最小版本可做：

1. **Global PLE offset**：對每頻段簡單算 `mean(measured - predicted)` 當作 `bias_dB`，顯示時加回去
2. **per-AP TX offset**：每 AP 獨立 offset，比 PLE 更細
3. **residual heatmap**：純顯示 measured - predicted，讓使用者手動看哪裡模型錯

後續再加：
4. 牆類型校正（每 wallType 的 att_dB 微調）
5. Triangle field（需要穩定 survey 量）
