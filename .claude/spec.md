產品規格書 (OpenSpec)：Floorplan 網路平面圖編輯與分析模組

一、產品背景與目的
本模組為網路規劃工具的核心畫布 (Canvas)。
透過瀏覽器提供 2D/3D 平面圖模擬環境，
使用者可匯入實體空間平面圖，
建立具備 Z 軸 (高度) 概念的 2.5D/3D 物理環境模型，
並部署無線存取點 (AP)。

系統結合設備參數與物理障礙物，
動態即時運算無線訊號涵蓋範圍 (Heatmap)，
協助網路設計評估與優化。

二、平面圖導入與畫布管理 (Floor Plan & Canvas)

支援格式：
PDF（自動拆分多頁）、CAD、JPEG、PNG。

圖資匯入：
支援拖曳 (Drag & Drop) 匯入。
PDF 自動拆分為多樓層圖層。
可刪除不必要頁面並調整樓層名稱。

畫布預處理：
不透明度 (Opacity)
旋轉 (Rotation)
裁切 (Crop)
去色（轉灰階）

導覽模式：
滑鼠模式（縮放 / 平移）
觸控板模式
支援 2D / 3D 視角切換

比例尺設定：
AI 自動偵測比例尺 (Scale)
可手動繪製標尺覆蓋設定

三、環境建模 (Environment Modeling)

3.1 AI 自動化偵測
自動識別：
建築範圍 (Scoping / Scope Zone)
牆壁、門、電梯井
支援手動調整與修正

3.2 牆體與物件建模 (Wall & Object Modeling)
材質與衰減係數：
內建材質（磚牆、輕隔間、玻璃等）
每種材質具 dB 衰減值
支援自訂材質

高度設定 (Z-Axis)：
Top Height（頂部高度）
Bottom Height（底部高度）

應用：
可建立門、窗等懸空物體
支援 Fill top & bottom 自動補齊牆體

牆體操作：
支援手動繪製與編輯
支援快捷鍵切換材質

3.3 樓層孔洞與範圍 (Floor Holes & Scope)
樓層孔洞 (Void / Floor Hole)：
定義挑高或中庭區域
訊號可跨樓層穿透

掃描範圍：
In-Scope（計算區）
Out-of-Scope（排除區）

四、設備部署與樓層管理 (Device & Multi-floor)

4.1 設備屬性 (Device Properties)
座標系統：
(X, Y, Z)
Z 軸為安裝高度

AP 設定：
頻段（2.4 / 5 / 6 GHz）
發射功率

天線模式：
Omni（全向）
Directional（定向，含 Azimuth / Down-tilt）

安裝方式：
Ceiling（吸頂）
Wall（壁掛）

視覺回饋：
3D 視圖顯示高度差異

4.2 樓層對齊 (Multi-floor Alignment)
疊層對齊：
使用對齊點（樓梯 / 電梯）

樓板衰減：
設定材質與 dB 值
影響垂直訊號傳播

五、動態熱圖與計算邏輯 (Dynamic Heatmap)

即時更新條件：
移動 AP
調整 AP 高度
修改牆體材質或高度
調整頻段與功率

計算模型：
考慮 Z 軸高度差（3D 距離）
計算自由空間路徑損耗 (FSPL)

牆體阻擋：
根據材質衰減 dB
判斷高度範圍是否阻擋

多樓層傳播：
樓板衰減影響
Void 區域可直接穿透

視覺化：
Heatmap 即時渲染
顯示 dBm 強度（紅 / 黃 / 綠）

指標切換：
RSSI
SNR
CCI

六、RD 實作雛形 (Implementation / PoC)

Phase 1: Canvas Layer
圖資渲染與座標映射
支援 Pan / Zoom
建立比例尺轉換

Phase 2: 資料結構
牆面模型：
{ id, start_pt, end_pt, material_db_loss, top_height, bottom_height }

AP 模型：
{ id, pt_x, pt_y, pt_z, tx_power }

支援 UI 屬性調整

Phase 3: Heatmap Engine
採用 WebGL Fragment Shader
避免純 CPU 計算

距離模型：
3D 空間距離計算

Ray-casting：
判斷牆體交集
累加衰減

即時 Shader 渲染 Heatmap

七、系統特性與優勢

跨平台瀏覽器操作
多格式平面圖支援
AI 自動比例尺與牆體偵測
支援 2D / 3D 視覺化
支援多樓層設計與訊號穿透
支援自訂材質與快速操作
即時動態 Heatmap 計算
