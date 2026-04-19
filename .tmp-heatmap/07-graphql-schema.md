# 07. GraphQL 資料模型完整規格

> 從實際 GraphQL payload 抽取，這是「前端要什麼資料才能算 RF heatmap」的答案。

## 1. 頂層關聯圖

```
User
 └── Project (1:n)
      ├── HeatmapSettings (1:1)
      ├── ChannelSettings (1:1)
      ├── CapacitySettings (1:1)
      ├── Environment (PLE, 全域 1:1)
      ├── WallType[] (材料定義)
      ├── AttenuatingZoneType[] (區域類型)
      ├── Building (1:n)
      │    └── Map (樓層, 1:n)
      │         ├── Wall[] → WallType
      │         ├── AttenuatingZone[] → AttenuatingZoneType
      │         ├── AttenuatingField[] (手繪連續區)
      │         ├── AttenuatingTriangleField[] (ML 校正網格)
      │         ├── SurveyAttenuatingTriangleField[]
      │         ├── RaisedFloorZone[]
      │         ├── SlopedFloor[]
      │         ├── HoleInFloorZone[]
      │         ├── ScopeZone[] (heatmap 邊界)
      │         ├── CapacityZone[] (client 密度)
      │         ├── AccessPoint[]
      │         └── MeasuredAccessPoint[] (live)
      └── UserProjectUiStates
```

## 2. HeatmapSettings（RF 引擎主要輸入）

```graphql
type HeatmapSettings {
  id: ID!

  # 顯示
  opacityPercentage: Float
  raisedHeatmap: Boolean
  wifiRssiLegendShowAll: Boolean
  thresholds: [HeatmapThresholds]

  # 幾何
  clientHeightMeters: Float        # 預設 1.0
  cutoutDistanceMeters: Float      # 預設 50

  # 傳播
  diffractionLossDBPer90Deg: Float # 典型 6
  fullBuildingPropagation: Boolean # 跨樓層

  # 頻段底噪
  wifiNoiseFloor2_4GHz: Float      # 預設 -95
  wifiNoiseFloor5GHz: Float        # 預設 -95
  wifiNoiseFloor6GHz: Float        # 預設 -95

  # 閾值
  wifiInterferenceRssiLimitDBm: Float  # 低於此不算干擾源
  wifiNumApsRssiLimitDBm: Float        # AP 數量 heatmap 用
  bleNumApsRssiLimitDBm: Float
  wifiAssociationLimitDBm: Float       # AP 關聯邊界

  # Client 端 TX
  wifiClientTxPowerDBm: Float           # 預設 15
  bleClientTxPowerDBm: Float
  cellularClientTxPowerDBm: Float
  enoceanClientTxPowerDBm: Float
  uwbClientTxPowerDBmPerMHz: Float

  # UWB
  uwbBaseAccuracy: Float
  uwbRssiLimitDBm: Float

  # Cellular
  cellularCellAvgLoad: Float
  cellularDownlinkTrafficShare: Float
  cellularUserEquipment: String

  # Prediction 模式
  predictionModeSettingSimulated: Boolean
  predictionModeSettingLive: Boolean
  predictionModeAuto: Boolean

  # Measured data
  wifiMeasuredInterferenceSources: Boolean
  measuredChannelUtilizationAggregation: String

  # Heatmap 類型啟用開關
  wifiRequirementSettings: HeatmapRequirementSettings
}

type HeatmapRequirementSettings {
  primaryCoverageEnabled: Boolean
  secondaryCoverageEnabled: Boolean
  tertiaryCoverageEnabled: Boolean
  snrEnabled: Boolean
  dataRateEnabled: Boolean
  interferenceEnabled: Boolean
  uplinkEnabled: Boolean
  channelUtilizationEnabled: Boolean
}

type HeatmapThresholds {
  id: ID!
  technology: String   # wifi / ble / cellular
  heatmap: String      # coverage / snr / data_rate / ...
  labels: [String]     # ["Edge","Low","Decent","High"]
  values: [Float]      # [-85, -75, -70, -65]
}
```

## 3. Environment / WallType / Zone

```graphql
type Environment {
  name: String
  pathLossExponent: Float   # 全域預設 PLE
}

type WallType {
  id: ID!
  name: String
  color: String
  shortcutKey: String
  topEdge: Float            # m
  bottomEdge: Float
  width: Float              # 厚度 m
  reflectivity: Float
  attenuation: Float        # @ referenceFrequency
  materialClass: String     # enum-like
  deleted: Boolean
  defaultTypeId: ID
  transparencyEnabled: Boolean
  autoFillEnabled: Boolean
  # 隱含（複現時要有）:
  referenceFrequencyMHz: Float
  isConductor: Boolean
  iturModel_a / _b / _c / _d: Float
}

type AttenuatingZoneType {
  id: ID!
  name: String
  defaultType: String
  color: String
  shortcutKey: String
  topEdge: Float
  bottomEdge: Float
  attenuationDbPerMeter: Float
  ituRModelEnabled: Boolean
  transparencyEnabled: Boolean
  # 隱含:
  pathLossExponent: Float
}
```

## 4. Map / Wall / Zone 實例

```graphql
type Map {
  id: ID!
  urls: { alteredMapImage, mapImage }
  filetype: String
  name: String
  width: Float
  height: Float
  floorIndex: Int
  floorHeight: Float        # 樓層高度 m
  floorThickness: Float     # 地板厚度 m
  floorAttenuation: Float   # 地板穿透 dB
  floorAlignmentX/Y: Float
  wifi5GHzAutoChannelWidthMHz: Int
  wifi6GHzAutoChannelWidthMHz: Int
  scale: Scale
  mapDefaultPredictionSettings: {
    pathLossExponent: Float
  }
  maxChannelWidths: {
    wifi5GHzMaximumChannelWidthMHz: Int
    wifi6GHzMaximumChannelWidthMHz: Int
  }
  autoScaleStatus / autoWallsStatus / ...
}

type Wall {
  id: ID!
  start: { id, x, y }
  end: { id, x, y }
  materialId: ID     # → WallType
}

type AttenuatingZone {
  id: ID!
  typeId: ID        # → AttenuatingZoneType
  area: Polygon
}

type AttenuatingField {
  id: ID!
  area: Polygon
  attenuationDBPerMeter: Float
}

type AttenuatingTriangleField {
  id: ID!
  triangleField: String   # serialized mesh
  batchId: ID
  envLearningModel: ID
}

type RaisedFloorZone {
  id: ID!
  area: Polygon
  height: Float
  attenuationDbPerMeter: Float
  slabOnly: Boolean
}

type SlopedFloor {
  id: ID!
  area: Polygon
  attenuationDbPerMeter: Float
  crowdEnabled: Boolean
  drawStairs: Boolean
  slabOnly: Boolean
  crowdHeight: Float
  crowdAttenuationDbPerMeter: Float
}

type HoleInFloorZone {
  id: ID!
  area: Polygon
  type: String   # atrium / stairwell / ...
}
```

## 5. AccessPoint / Radio / Antenna

```graphql
type AccessPoint {
  id: ID!
  version: Int
  x: Float
  y: Float
  make: String
  model: String
  mount: String           # ceiling / wall / pole
  installHeight: Float    # m
  azimuth: Float          # 度
  elevation: Float
  roll: Float
  externalAntennaMake: String
  externalAntennaModel: String
  cachedAntennaId: ID      # → CachedAntenna
  radios: [Radio]
  cellularRadios: [CellularRadio]
  bleRadios: [BleRadio]
  uwbRadios: [UwbRadio]
  enoceanRadios: [EnoceanRadio]
  zigbeeRadios: [ZigbeeRadio]
  primaryTechnology: String
  color: String
  name: String
  number: Int
  powerConsumption: Float
  connectedInfraDeviceId: ID
  ethernetConnection: String
  perRadioOriented: Boolean
  bank: Int
  meshUpstreamAuto: Boolean
  meshUpstreamApId: ID
  meshRadioIndex: Int
}

type Radio {
  id: ID!
  band: { id, name, band }    # 2.4 / 5 / 6
  channel: Int
  txPower: Float              # dBm
  channelWidth: Int           # 20/40/80/160/320
  enabled: Boolean
  channelLocked: Boolean
  port: String
  streamCount: Int            # MIMO
  technology: String          # wifi6e / wifi7
  azimuth: Float
  elevation: Float
  installHeight: Float
  cachedAntennaId: ID
  externalAntennaMake: String
  externalAntennaModel: String
  mount: String
  roll: Float
  phy: String                  # 802.11ax / be
}

type CachedAntenna {
  id: ID!
  json: String     # 完整 3D pattern 序列化
}
```

## 6. ChannelSettings / CapacitySettings

```graphql
type ChannelSettings {
  automaticChannelAssignmentEnabled: Boolean
  afcEnabled: Boolean
  channel2_4GHzMode: String   # DISABLE_EXTRA / CONVERT_ALL / AUTO

  wifi2GHzChannelSettings: WifiBandChannelSettings
  wifi5GHzChannelSettings: WifiBandChannelSettings
  wifi6GHzChannelSettings: WifiBandChannelSettings

  cbrsEarfcnPool: String
  cellularChannelWidthMHz: Int
  cellularNumberOfChannels: Int
  cellularBand: String
  cellularNrScs: String
  cellularAssociationChangeDeltaDB: Float

  enoceanBand: String
  zigbeeBand: String
  uwbChannel: Int
}

type WifiBandChannelSettings {
  channelWidthMHz: Int
  primaryChannelPool: [Int]
  channelWidthAuto: Boolean
  allowedChannelWidths: [Int]
  channelWidthAutoAllowedInterferenceShare: Float
  allowedPrimaryChannels: [Int]
}

type CapacitySettings {
  id: ID!
  wifi2GhzClientLimit: Int
  wifi5GhzClientLimit: Int
  wifi6GhzClientLimit: Int
  cellularClientLimit: Int
  wifi6GhzCapableClientsPercentage: Float
}
```

## 7. UserProjectUiStates

```graphql
type UserProjectUiStates {
  selectedMeasuredHeatmap: String
  selectedMeasuredWifiBand: String
  selectedSsids: [String]
  selectedLiveSsids: [String]
  selectedHeatmap: String         # coverage/snr/data_rate/...
  selectedHeatmapWifiBands: [String]
  liveClientMaskingEnabled: Boolean
  buildingViewMode: String        # "2d" | "3d" — 僅影響 UI 視圖切換，不觸發 heatmap 重算；RF 計算永遠是 2D grid（見 04-heatmap-pipeline.md §6）
  buildingTransparencyEnabled: Boolean
  # ...
}
```

## 8. Mutations（會觸發重算）

```graphql
# 移動物件
mutation MoveSelectedItems($input: MoveSelectedItemsInput!) { ... }

# 修改 radio 參數
mutation modifyRadios($input: [RadioInput!]!) { ... }

# 自動頻寬切換
mutation setMapAutoChannelWidths($mapId: ID!, $widths: ...) { ... }

# 牆匯入
mutation MapWallImport($input: WallImportInput!) { ... }
```

所有 mutation 只回傳更新後的實體（不回 heatmap）→ 前端自動重算。

## 9. 查詢範例（供複現參考）

### 初始載入專案

```graphql
query getProjectById($id: ID!) {
  projectById(id: $id) {
    id name
    environment { ...environmentFields }
    wallTypes { ...wallTypeFields }
    attenuatingZoneTypes { ...attenuatingZoneTypeFields }
    heatmapSettings { ...heatmapSettings }
    channelSettings { ...channelSettings }
    capacitySettings { ...capacitySettingsFields }
    buildings { id name }
  }
}
```

### 載入單一樓層全部物件

```graphql
query mapObjects($mapId: ID!) {
  mapById(id: $mapId) {
    walls { ...wallFields }
    attenuatingZones { ...attenuatingZoneFields }
    attenuatingFields { ...attenuatingFieldFields }
    attenuatingTriangleFields { ...attenuatingTriangleFieldFields }
    surveyAttenuatingTriangleFields { ...surveyAttenuatingTriangleFieldFields }
    raisedFloorZones { ...raisedFloorZoneFields }
    slopedFloors { ...slopedFloorFields }
    holeInFloorZones { ...holeInFloorZoneFields }
    scopeZones { ... }
    capacityZones { ... }
  }
}

query MapAccessPoints($mapId: ID!) {
  mapById(id: $mapId) {
    accessPoints { ...accessPointFields }
  }
}

query MapWalls($id: ID!) {
  mapById(id: $id) {
    walls { ...wallFields }
    autoWalls
    autoMaterialWalls
  }
}
```

## 10. 複現建議：最小資料集

若要做 MVP 版本，先實作這些 type 就能跑：

必要：
- `WallType`（name, width, attenuation, ref_freq, itur_a/b/c/d, is_conductor）
- `Wall`（start, end, wallTypeId, top_height, bot_height）
- `AccessPoint`（x, y, z, azimuth, elevation, txPower, freqMHz, streamCount, antennaPattern）
- `HeatmapSettings`（至少 clientHeight, cutoutDist, diffractionLossDBPer90Deg, noise_floor）

加值：
- `AttenuatingZone` + `AttenuatingZoneType`
- `ScopeZone`（heatmap 範圍）

進階：
- `AttenuatingTriangleField`（env learning）
- 跨樓層所需的 `floorAttenuation / floorHeight / adjacentFloorAPs`
