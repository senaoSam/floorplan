# 09. 原始證據與反向工程記錄

> 本文件保留所有推論的原始證據，供驗證或深入。

## 1. wasm 基本資訊

- 檔案：`https://us.hamina.com/assets/hamina-DzbGwBcv.wasm`
- 大小：6,438,916 bytes (~6.4 MB)
- 編譯器：**Emscripten** (C++ → wasm)
- 證據：
  - 路徑字串 `/emsdk/emscripten/system/lib/libcxxabi/src/...`
  - 函式名 `emscripten_runtime_keepalive_push` 等 export
  - 支援 pthread (`_emscripten_thread_init`, `emscripten_num_logical_cores`)
- 符號未 strip（可讀）

## 2. 幾何庫：Boost.Geometry

證據（wasm 中 mangled name 含）：
```
N5boost8geometry5model2d39point_xyz  # 3D point
N5boost8geometry5model2d28point_xy   # 2D point
N5boost8geometry7segment              # 線段
cartesian                              # cartesian coord system
```

→ 確認使用 Boost.Geometry 做所有空間運算。

## 3. Dominant Path 相關符號

### 核心類別

```
DominantPathAccelerationStructure
DominantPathAccelerationStructureDerivedImpl<OrderIndex 0>
DominantPathAccelerationStructureDerivedImpl<OrderIndex 1>
DominantPathAccelerationStructureDerivedImpl<OrderIndex 2>
```

### 關鍵方法

```
DominantPathAccelerationStructure::estimatePathLoss
  (pImpl is null error message)
DominantPathAccelerationStructureDerivedImpl<N>::pathLossOnSegment
```

### 路徑損耗組成（debug 名稱）

```
Path Loss
Base Loss
FSPL Distance Loss dB
Distance Path Loss dB (ple2)
Known Attenuation dB
Known Wall Attenuation dB
Known Zone Attenuation dB
Ray Attenuation Zone Loss
Ray Attenuating Triangle Loss
Ray Attenuating Obstacle Loss
Attenuation Zone Loss dB/m
Attenuating Triangle Loss dB/m
Attenuating Obstacle Loss dB/m
LOS Attenuation Y
Predicted RSSI
Measured RSSI
```

### 支援服務

```
WallAttenuationProvider
ZoneAttenuationService
ZoneAttenuationService::distanceLossDB
RegularTriangleGridAttenuationService
RegularTriangleGridAttenuationService::forEachRayPieceAtFrequency
RegularTriangleGridAttenuationService::distanceLossDB
ObstacleContainer
ObstacleTypeHeightAttenuationModel
BuildingPropagationService
PredictionService
PredictionService::addWallPathLoss
PredictionParameters
PredictionWorkspace
PredictionDebugStatistics
```

## 4. API 函式簽章

完整從 wasm 抽出的 RF 相關 embind 函式：

### 全域設定
```
setPathLossExponent(pathLossExponent)
setDefaultPathLossExponent(pathLossExp)
setHeatmapEnabledWifiFrequencyBands(wifi2_4GHz, wifi5GHz, wifi6GHz)
setHeatmapSettings(heatmapSettings)
setHeatmapSelectedRadioIds(selectedRadioIds)
```

### 牆
```
addWallTypeITURModel(
    wallTypeId, attenuationDB, referenceFrequencyMHz,
    wallTopHeightM, wallBottomHeightM,
    isConductor, iturmodel_a, iturmodel_b, iturmodel_c, iturmodel_d)
```

### 區域
```
addAttenuatingZoneType(
    zoneTypeId, topHeightM, bottomHeightM,
    pathLossExp, attenuationDBPerM)

addAttenuatingZoneTypeITURModel(
    zoneTypeId, topHeightM, bottomHeightM,
    pathLossExp, attenuationDBPerM,
    referenceFrequencyMHz, isConductor,
    iturmodel_a, iturmodel_b, iturmodel_c, iturmodel_d)

addAttenuatingZoneWithLogLDMaxAttenuationModel(
    zoneID, zoneWktMultiPolygon, topHeightM, bottomHeightM,
    pathLossExp, attenuationDBPerM,
    maxLDAttenuationDB, subLevel, storageType)

appendRaisedFloorZone(
    zoneID, zoneWktMultiPolygon, topAltitudeM, bottomAltitudeM,
    attenuationDBPerM, maxLDAttenuationDB, pathLossExponent)
addRaisedFloorZone(...)

addSlopedAttenuatingZone(
    zoneID, zoneWktMultiPolygon, topAltitudeM, bottomAltitudeM,
    attenuationDBPerM, pathLossExponent,
    topSlopeX, topSlopeY, topOriginOffset,
    bottomSlopeX, bottomSlopeY, bottomOriginOffset)
addSlopedFloorZone(...)
appendSlopedAttenuatingZone(...)
appendSlopedFloorZone(...)

setAttenuatingZoneTypes(attenuatingZoneTypes)
setAttenuatingZones(mapId, attenuatingZones)
setAutoAttenuatingZones(mapId, autoAttenuatingZones)
```

### 天線
```
addAntenna(
    antennaTypeId, azimuthPattern, elevationPattern,
    x_axis_vector, z_axis_vector,
    interpolationMethod, numberOfAntennaElements)

addAntennaFromArray(
    antennaTypeId, gains, thetaSize,
    x_axis_vector, z_axis_vector,
    interpolationMethod, numberOfAntennaElements)

addAntennaWithPlanes(
    antennaTypeId, xyPlane, xyPlaneThetaAngleDegrees,
    yzPlane, zxPlane, x_axis_vector, z_axis_vector,
    interpolationMethod, numberOfAntennaElements)

addMultiPlaneAntenna(
    antennaTypeId, x_axis_vector, z_axis_vector,
    interpolationMethod, numberOfAntennaElements)

addElevationPlaneForMultiPlaneAntenna(
    antennaTypeId, elevationPattern, elevationPlanePhiDegrees)

addAzimuthPlaneForMultiPlaneAntenna(
    antennaTypeId, azimuthPattern, azimuthPlaneThetaDegrees)

addWifiAntennaFor(radio, frequencyBand, antennaTypeId)
```

### Radio
```
addGenericRadio(accessPoint, accessPointRadioId, positionMeters,
    radioName, technology, frequencyBand, channelNumber,
    transmitPowerDBm, sensitivityLimitDBm, antennaTypeId,
    x_axis_vector, z_axis_vector)

addWifiRadio(..., channelWidth, channelCenterFrequencyIndex0,
    channelCenterFrequencyIndex1, primaryChannel,
    transmitPowerDBm, sensitivityLimitDBm, antennaTypeId,
    x_axis_vector, z_axis_vector, phy, mimoSupport,
    meshUpstreamRadioId)

addWifiRadioWithResourceContainer(resourceContainer, ...)

addBluetoothRadio(...)
addCellularFR1NRRadio(..., numerology, cyclicPrefix, ...,
    mimoSupport, maxModulationSupported, supportLTECoexistence)
addCellularLTERadio(..., mimoSupport, maxModulationSupported)
```

### 頻道
```
addTDDChannel(channelNumber, frequencyMHz)
addFDDChannel(channelNumber, downlinkFrequencyMHz, uplinkFrequencyMHz)
addWifiChannel(frequencyBand, channelWidth,
    channelCenterFrequencyIndex0, channelCenterFrequencyIndex1,
    primaryChannel)
addCellularChannelSet(frequencyBand, channelWidth, numberOfChannels)

setAllowedFrequencyRange(minAllowedFrequencyMHz, maxAllowedFrequencyMHz)
addFrequencyRangePSDLimit(lowFrequency, highFrequency, maxPsdDBmPerMHz)
getMaxAllowedEirpDBm(centerFrequencyMHz, channelWidthMHz)

setMaximumSelectableChannelWidth(frequencyBand, channelWidth)
getNumberOfWifiChannels(frequencyBand, channelWidth)
getRepresentativeWifiChannel(frequencyBand)

setBandPreference(frequencyBand, highSignalLimitDBm)
setBandPreferenceWithPriority(frequencyBand, highSignalLimitDBm, priority)
setBandBoost(frequencyBand, signalLimitDBm, signalBoostDeltaDB)
setFrequencyBandPriorProbability(frequencyBand, priorProbabilityForBand)
setSupportedLegacyFrequencyBands(supports24GHz, supports5GHz)
```

### Channel Optimizer
```
setChannelOptimiserInput(accessPointContainer, activeMapId, extent,
    fraMode, primaryRssiLimitDBm, channelScheme, pathLossExp,
    predictionMode, options)

ChannelOptimiser::doSelectWifiChannelsInBand(
    freqBand, channelWidth, workspace, radios, radiosToModify,
    DoSelectWifiChannelsMode)

ChannelOptimiser::selectWifiRadiosToDisableBasedOnCoverage(
    freqBand, primaryRssiLimitDBm, radios, workspace)
```

### Interference
```
getMutualWifiInterference(frequencyBand, rssiLimit)
getWifiInterference(frequencyBand, associationLimitDBm, rssiLimit,
    useClientSignals, useMutualSignals)
```

### Survey / Env Learning
```
getSurveyAttenuationWallTypeEstimate(modelSettings, measuredRadios)

EnvLearningWallZoneAttenuationEstimator
AbstractSurveyAttenuationEstimator
AttenuatingObjectPresenceEvaluator

targetAttenuationZoneIds
targetAttenuationZoneTypeIds_

queryRssiTimeseries(bssids)

// 誤差統計
totalRssiErrorStats_2_4GHz / 5GHz / 6GHz
totalWeightedMinus65RssiErrorStats_2_4GHz / 5GHz / 6GHz
totalWeightedMinus90RssiErrorStats_2_4GHz / 5GHz / 6GHz
estimatedTXPowerStats2_4GHz / 5GHz / 6GHz
txAntennaGainStats
rxAntennaGainStats
```

### Capacity
```
wifi2GhzClientLimit
wifi5GhzClientLimit
wifi6GhzClientLimit
wifi6GhzCapableClientsPercentage
staticNoiseFloor20MHz2_4GHz / 5GHz / 6GHz
minDatarateMbps_2_4GHz / 5GHz / 6GHz
channelWidthAutoMinAllowedRelativeFitness5GHz / 6GHz
```

### 2.4 GHz 特殊模式
```
DISABLE_EXTRA_2_4GHZ
CONVERT_ALL_EXTRA_2_4GHZ_TO_5GHZ
AUTO_EXTRA_2_4_GHZ_TO_5GHZ
```

### Heatmap Settings 欄位
```
diffractionLossDBPer90Deg
fullBuildingPropagation
wifiNoiseFloor2_4GHz / 5GHz / 6GHz
pathLossExponent
pleEstimate2_4GHz / 5GHz / 6GHz
frequencyMHz
topologyPolygonEpsilon
```

## 5. 錯誤訊息（揭露內部結構）

```
"DominantPathAccelerationStructure::estimatePathLoss: pImpl is null"
"Unsupported heatmapType: {}"
"Unsupported measuredHeatmapType: {}"
"Missing antenna gain estimator type: ..."
"Unknown SurveyAttenuationMode: ..."
"Undefined antennaTypeId"
"UNDEFINED_ATTENUATION_ZONE_TYPE"
"UNDEFINED_ATTENUATION_ZONE"
"getCurrentHeatmapType"
"setChannelOptimiserInput(...)"
```

## 6. GraphQL 證據

### 主要 query 清單（初始載入觀察到）

```
setActiveSession, session, me,
externalAntennaMakeModels, accessPointMakeModels, accessPointMounts,
InitializeOrUpdatedUserAccount, listProjects, projectsOwners,
listTeamDetails, pendingNotifications, peekMapCreationProgress,
meWithFreeTierEntitiesRemaining, getProjectById,
sharedLiveAccessByProjectId, listTeams, invitationsByProjectId,
userRolesByProjectId, VendorSettings,
mapDownload, mapObjects, MapAccessPoints, getProjectReports,
getProjectCablingById, MapWalls, CapacitySettings, getReferenceMap,
getBuildingMapsByIds, MapWallImport, MapDominantColors,
ProjectNetworkInfraDeviceLinks

# Mutations
MoveSelectedItems, setMapAutoChannelWidths, modifyRadios
```

### 關鍵觀察

- **沒有 `computeHeatmap`、`getRssiGrid`、`predictCoverage` 類 query**
  → 結論：heatmap 計算在前端 wasm 完成
- 前端 GraphQL 只拉「輸入」：projects + maps + walls + zones + APs + antennas + settings
- Mutation 只回傳更新後的實體
- 唯一後端 heatmap 路徑：`/api/MapImage/{projectId}/{mapId}?dc=...&rc=...` 回 PNG（推論：僅匯出或分享連結用）

### HeatmapSettings 完整欄位（verbatim）

```graphql
id
opacityPercentage
clientHeightMeters
cutoutDistanceMeters
diffractionLossDBPer90Deg
raisedHeatmap
fullBuildingPropagation
cellularCellAvgLoad
cellularDownlinkTrafficShare
cellularUserEquipment
cellularClientTxPowerDBm
wifiClientTxPowerDBm
bleClientTxPowerDBm
uwbClientTxPowerDBmPerMHz
wifiNoiseFloor2_4GHz
wifiNoiseFloor5GHz
wifiNoiseFloor6GHz
wifiInterferenceRssiLimitDBm
wifiNumApsRssiLimitDBm
bleNumApsRssiLimitDBm
wifiMeasuredInterferenceSources
predictionModeSettingSimulated
predictionModeAuto
predictionModeSettingLive
wifiAssociationLimitDBm
wifiRssiLegendShowAll
enoceanClientTxPowerDBm
uwbBaseAccuracy
uwbRssiLimitDBm
thresholds
wifiRequirementSettings
measuredChannelUtilizationAggregation
```

## 7. 網路流量觀察

- 主要 API endpoint：`https://us.hamina.com/graphql`
- Auth: Clerk (`clerk.hamina.com`)
- Sentry 用於 error tracking
- wasm 延遲載入 (初始 HTML 2.6KB → JS bundle 載完才請求 wasm)

## 8. 未解之謎（技術分析 時沒完全挖到的）

1. **ITU-R 係數預設表** — wasm 裡有沒有硬編 concrete/drywall 等材料的 a/b/c/d？沒找到明確證據；可能由前端上傳。
2. **繞射具體公式** — `diffractionLossDBPer90Deg` 是線性還是非線性映射？符號只有參數名，實作細節在機器碼中。
3. **MIMO 處理** — `streamCount` 的使用方式是簡單 log10 加成還是查表？
4. **Triangle field 序列化格式** — `triangleField` 是 binary blob 還是 JSON？GraphQL schema 只標 String。
5. **Reflection** — `WallType.reflectivity` 的實際用途（Dominant Path 理論不做反射，但此欄位存在）
6. **EIRP 演算** — 若天線 gain 15 dBi + tx 30 dBm，會不會自動 clip 到法規上限？

若要完全複製，以上需要實測或靜態反組譯 wasm 機器碼。
