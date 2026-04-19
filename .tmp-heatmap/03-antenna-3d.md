# 03. 3D 天線方向圖建模

## 1. 天線資料模型

### 1.1 GraphQL

```graphql
fragment accessPointFields on AccessPoint {
    id x y
    installHeight          # 安裝高度 (m)
    azimuth                # 水平旋轉角 (度)
    elevation              # 俯仰角 (度)
    roll                   # 翻滾角
    mount                  # mount 型態 (ceiling/wall/pole)
    cachedAntennaId        # 指向 CachedAntenna.json（完整 3D pattern）
    externalAntennaMake externalAntennaModel
    radios { ... }
    perRadioOriented       # 各 radio 獨立方向？
}

fragment radioFields on Radio {
    id band channel txPower channelWidth
    technology azimuth elevation installHeight
    cachedAntennaId externalAntennaMake externalAntennaModel
    mount roll
    streamCount            # MIMO 流數
}
```

### 1.2 wasm API（多種天線建構方式）

```cpp
// 1. 雙平面（azimuth 切面 + elevation 切面）
addAntenna(antennaTypeId, azimuthPattern, elevationPattern,
           x_axis_vector, z_axis_vector,
           interpolationMethod, numberOfAntennaElements);

// 2. 完整 2D 陣列（θ, φ） — 最精確
addAntennaFromArray(antennaTypeId, gains, thetaSize,
                    x_axis_vector, z_axis_vector,
                    interpolationMethod, numberOfAntennaElements);

// 3. 三平面 (XY + YZ + ZX)
addAntennaWithPlanes(antennaTypeId, xyPlane, xyPlaneThetaAngleDegrees,
                     yzPlane, zxPlane,
                     x_axis_vector, z_axis_vector,
                     interpolationMethod, numberOfAntennaElements);

// 4. 任意多平面
addMultiPlaneAntenna(antennaTypeId, x_axis_vector, z_axis_vector,
                     interpolationMethod, numberOfAntennaElements);
addElevationPlaneForMultiPlaneAntenna(antennaTypeId, elevationPattern,
                                       elevationPlanePhiDegrees);
addAzimuthPlaneForMultiPlaneAntenna(antennaTypeId, azimuthPattern,
                                     azimuthPlaneThetaDegrees);
```

## 2. 座標系與方向

### 2.1 天線局部座標系

每顆天線有自己的 local frame：
- `x_axis_vector` — 水平前向
- `z_axis_vector` — 垂直向上
- y 由右手定則得出

**Azimuth (φ)**：繞 z 軸，從 x 軸開始；範圍 [0°, 360°)
**Elevation (θ)**：從 xy 平面起算（非從 z 軸），範圍 [-90°, +90°]（或用 polar θ = 90° - elev）

天線在世界中方向：
1. AP 本身 `azimuth/elevation/roll`（AP 姿態）
2. 天線 local frame 再疊一層 `x_axis_vector / z_axis_vector`
3. 若 `perRadioOriented`，每個 radio 有獨立方向（三頻段 MIMO 各自方向）

### 2.2 從 AP 到目標點的方向計算

```cpp
Vec3 dirWorld = normalize(targetPoint - apPosition);
Mat3 antennaFrame = buildFrame(ap.azimuth, ap.elevation, ap.roll);
Vec3 dirLocal = antennaFrame.inverse() * dirWorld;

double phi = atan2(dirLocal.y, dirLocal.x);      // azimuth
double theta = asin(dirLocal.z);                  // elevation
double gainDBi = lookupAntennaGain(antennaTypeId, theta, phi, freqMHz);
```

## 3. Gain Pattern 插值

### 3.1 雙平面法 (addAntenna)

只有兩條 gain 曲線：
- `azimuthPattern[i]`：i 從 0 到 N-1，對應 φ 從 0° 到 360°
- `elevationPattern[j]`：j 從 0 到 M-1，對應 θ 從 -90° 到 +90°

**合成 3D gain（近似，廠商規格書標準做法）**：

$$
G(\theta, \phi) = G_{az}(\phi) + G_{el}(\theta) - G_{ref}
$$

其中 `G_ref` 是兩條 pattern 相交點的 gain（通常為天線 bore sight 或 max gain）。單位 dBi。

### 3.2 完整 2D 陣列 (addAntennaFromArray)

`gains[i * thetaSize + j]` = G(φ_i, θ_j)；用 bilinear 插值：

```cpp
double gainAt(double phi, double theta) {
    int i = floor(phi / dPhi), j = floor(theta / dTheta);
    double u = (phi - i*dPhi) / dPhi;
    double v = (theta - j*dTheta) / dTheta;
    return (1-u)*(1-v)*G[i][j] + u*(1-v)*G[i+1][j]
         + (1-u)*v*G[i][j+1] + u*v*G[i+1][j+1];
}
```

### 3.3 多平面法 (Multi-Plane)

每條 elevation plane 有 `elevationPlanePhiDegrees`（它在哪個 azimuth 上切的），每條 azimuth plane 有 `azimuthPlaneThetaDegrees`（它在哪個 elevation 上切的）。

對任意 (θ, φ)：
1. 找相鄰的兩條 elevation planes (φ₁ < φ < φ₂)，取各自 G(θ)
2. 對 φ 插值
3. 類似對 azimuth planes 做對應插值
4. 融合兩結果

這做法避免「只有兩條 plane 精度不夠」且比「完整 2D」輕量。

### 3.4 `interpolationMethod`

wasm 參數，推測選項：
- `NEAREST` — 最近鄰
- `LINEAR` — 線性插值
- `CUBIC` — 平滑但貴
- `SPHERICAL` — 球面插值，適合極點附近

實作建議：預設 `LINEAR`，高品質模式 `CUBIC`。

## 4. MIMO / Stream 處理

```
radioFields.streamCount       # e.g. 2, 4, 8
cellularRadioFields.streamCountUplink / streamCountDownlink
mimoSupport                   # addWifiRadio
```

**簡化處理**（NPv1 推測做法）：
- 不做逐 stream 向量仿真
- 用 **MIMO gain bonus** 查表：

$$
G_{MIMO}(\text{streams}) = 10 \log_{10}(\text{streams}) \text{ dB}
$$

加在 `txPower` 或作為獨立項，用於 data rate 計算。

## 5. 波束賦型 (Beamforming)

沒有明確 API 叫 beamforming，但有：
- `perRadioOriented` — 每 radio 可單獨方向
- `bank` — 天線組，推測是 sector AP 的組別

**推論**：NPv1 不做動態 beamforming 仿真，僅靜態方向圖。進階使用者可拆成多個 radio 各自方向來近似 sector。

## 6. 頻段天線配對

```cpp
addWifiAntennaFor(radio, frequencyBand, antennaTypeId);
```

**同一顆 AP 的不同頻段可用不同天線 pattern**。如兩路天線：
- 2.4 GHz 用全向（`antennaTypeId=dipole`）
- 5 GHz 用方向性（`antennaTypeId=patch`）

在 heatmap 計算時，每個 radio 查自己的 `cachedAntennaId`。

## 7. 接收端天線

```
HeatmapSettings.wifiClientTxPowerDBm     # 上行 client TX
HeatmapSettings.bleClientTxPowerDBm
HeatmapSettings.uwbClientTxPowerDBmPerMHz
```

**接收端用等向性天線假設** (0 dBi)，不考慮手持裝置的實際方向。這是合理簡化——使用者裝置方向隨機。

## 8. EIRP 與限制

```cpp
getMaxAllowedEirpDBm(centerFrequencyMHz, channelWidthMHz)
addFrequencyRangePSDLimit(lowFrequency, highFrequency, maxPsdDBmPerMHz)
```

**EIRP (等效等向輻射功率)** = `txPower + antennaGain`

法規限制：
- FCC/CE 對各頻段有 EIRP 上限（如 5GHz UNII-1 = 30 dBm）
- `PSD (dBm/MHz)` 限制：頻寬越寬，總 EIRP 可越高但每 MHz 密度不變

**AFC (Automatic Frequency Coordination)**：
```
HeatmapSettings.afcEnabled      # 6 GHz 專用
ApAfcRequestParameters
ApAfcResponseData
```
6GHz Wi-Fi 6E/7 在戶外必須查詢 AFC 伺服器取得「此地可用頻道 + 每頻道 EIRP 上限」，NPv1 整合這套。

## 9. 複現實作骨架

```cpp
struct AntennaPattern {
    enum Mode { TwoPlane, Full2D, MultiPlane };
    Mode mode;
    std::vector<double> azPattern;     // dBi
    std::vector<double> elPattern;
    std::vector<double> full2D;        // N_phi × N_theta
    struct Plane { double angle; std::vector<double> pattern; };
    std::vector<Plane> elPlanes;       // multi-plane
    std::vector<Plane> azPlanes;
    double peakGainDBi;

    double gainAt(double thetaDeg, double phiDeg) const;
};

struct AccessPoint {
    Vec3 position;
    Quat orientation;     // 由 az/el/roll 構成
    double txPowerDBm;
    double freqMHz;
    int antennaTypeId;
    int streamCount;
};

double computeEirp(const AccessPoint& ap, Vec3 targetWorld,
                   const AntennaPattern& pat) {
    Vec3 localDir = ap.orientation.inverse() * (targetWorld - ap.position).normalize();
    double theta = asin(localDir.z) * 180/PI;
    double phi = atan2(localDir.y, localDir.x) * 180/PI;
    if (phi < 0) phi += 360;
    double gain = pat.gainAt(theta, phi);
    double mimoBonus = 10.0 * log10(ap.streamCount);
    return ap.txPowerDBm + gain + mimoBonus;
}
```
