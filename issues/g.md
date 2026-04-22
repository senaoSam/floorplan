有，最明顯有問題的是 1、3、4、6；5 也有一個很大的實作陷阱。
2 跟 7 則比較像是合理的工程 heuristic。

1. 路徑損失：max(Friis, ITU-R P.1238) 這個組合不太對。
P.1238 本質上是site-general 室內平均路損模型；ITU 文件明講它的距離損失係數已經隱含單樓層內牆體、障礙物與其他損失機制，而且也說若做 site-specific 模型，可以改成顯式逐牆計損，而不是把牆損再疊在 site-general 的距離項上。換句話說，你現在如果又用 P.1238、又逐牆加 dbLoss，再取較悲觀值，會有雙重計損風險。更重要的是，P.1238 的 N 不是固定 31；它是依場景與頻段選的參數，不是通用常數。

比較乾淨的做法只有兩條路：
A. Friis / 幾何擴散 + 顯式牆體/開口/反射/繞射；
B. P.1238 作為平均大尺度模型，那就不要再把每道牆當 deterministic loss 一道一道加。
若你現在要做 ray-based deterministic 模型，我會建議走 A，不要把 P.1238 混進同一條 path 的 deterministic budget。

2. 牆體穿透：L_wall · sec(θ) 基本可用，但它是 heuristic，不是嚴格電磁邊界解。
用與法線夾角的 sec(θ) 來放大斜入射穿透損失，在工程上很常見，sec 加上上限也能避免 grazing incidence 爆掉；這點我不會說有問題。真正要小心的是：
你說「門窗則用 opening.material.dbLoss 取代該段牆」，這只有在射線真的穿過 opening polygon 時才成立；若只是穿到「有門窗的那面牆」但交點不在開口範圍內，就不能直接用較低損失替代整段牆。這是幾何判定問題，不是公式問題。

3. 一階鏡面反射：你把幾個不同層級的東西混在一起了。
問題有三個：
第一，|Γ| 不應只由材質決定；它還跟入射角、極化、材料的複數介電常數/導電率有關。ITU-R P.2040 提供的正是材料電特性資料，反射/穿透係數應由那些參數推導，而不是每種材質給一個固定 |Γ| 常數。

第二，你再乘上一個 (0.5 + 0.5 cos θ_i)，很可能把角度依賴重複算了一次。因為 Fresnel 反射本來就已經隨角度變。除非你明確把它定義為「額外的散射/鏡面 lobing 經驗項」，否則這一項物理意義不乾淨。

第三，反射不一定固定引入 π 相位。
反射相位應該來自複數 Fresnel 係數本身；不同極化、不同介質、不同角度，反射係數的相位都可能不同。把所有反射一律加 π，會把多路徑干涉的位置算錯。P.2040 的材料參數就是為了這種反射/透射建模準備的。

所以這一點我會改成：
Γ(θ, pol, ε_r, σ_cond) 直接做成複數係數，粗糙度衰減若要保留，再額外乘 roughness factor；但不要再外掛一個沒有明確校準依據的 cosine taper。

4. UTD Knife-Edge 繞射：這點名稱和方法都對不上。這是你清單裡最需要修的。
你寫的是「UTD Knife-Edge」，但後面用的 v 參數與 Lee/knife-edge loss，其實是Fresnel/knife-edge 類近似，不是完整的 UTD wedge diffraction。ITU-R P.526 也把 knife-edge、有限寬屏幕、矩形開口等情況分開處理；它甚至明說有限寬屏幕的平均/最小繞射損失是用多個 knife-edge 貢獻再組合，而不是一句「端點 + Lee 近似 = UTD」。

更直接地說：
你現在對「每個牆端點 corner」算 knife-edge，實際上是在拿薄刀口近似建築角點/楔形邊緣。這可以當 heuristic，但不能叫 UTD。
所以你要二選一：
A. 改名成「corner knife-edge approximation」，承認它是近似；
B. 真的實作 UTD wedge coefficient。

另外，你只在「直射被擋時」才開繞射，也會漏掉一些在遮蔽邊界附近仍有顯著貢獻的 diffracted path；工程上可接受，但要知道這是速度/精度取捨，不是完整物理。

5. 多路徑相干疊加：概念對，但你若只用單一中心頻率，Wi-Fi 會被你算得太深衰落。
把每條 path 轉成複數電壓再相加，這件事本身是對的。
真正的坑是：Wi-Fi 不是單頻 CW，而是有 20/40/80/160 MHz 甚至更寬的 OFDM 訊號。你若只用「中心頻率的一個 k」做相干加總，再把結果當整個 channel 的 RSSI/SINR，會把窄頻 null 當成整個頻道都 null，通常會過度誇張頻率選擇性衰落。P.1238 也把 multipath delay 視為高資料率的重要通道特性，而不是只有平均路損。

比較好的做法是：
對頻道內多個頻點或多個 OFDM 子載波取樣，做
H(f)=Σ a_n e^{-j2πfτ_n}，
再對整個 occupied bandwidth 做功率平均，最後再映射成 RSSI / 有效 SNR。
不然第 5 點會在寬頻 Wi-Fi 上產生不穩定且過深的 coverage 洞。

6. 同頻 SINR 聚合：頻譜重疊判斷是對的，但干擾模型太「非 Wi-Fi」。
只把真的頻譜重疊的 AP 放進干擾分母，方向是對的，因為 20/40/80/160 MHz 的 occupied bandwidth 不同，不能只看 band 名稱。

但有兩個問題：
第一，RSSI 取最強 AP = client 一定 associate 到它 這件事不總是成立。真實 client 還會受最小 RSSI 門檻、band steering、BSS load、roaming policy 等影響；所以這比較像 RF-side best server map，不是完整 association model。

第二，也是更大的問題：Wi-Fi 同頻 AP 不等於永遠當成連續干擾源。
802.11 有 CCA/CSMA/CA，同信道重疊很多時候反映成airtime contention / defer，不一定是「同時發射、直接進 SINR 分母」的連續加總。你這樣做會把 co-channel Wi-Fi 懲罰得太重，尤其在同廠同網域、同 ESS 的室內 AP 部署。
所以第 6 點比較適合叫做 instantaneous RF SINR upper-bound pessimistic interference model，不適合直接拿來代表實際吞吐。

另外，noise floor = -95 dBm 也不應固定；熱噪聲功率遵循 kTB，會隨接收頻寬改變，1 Hz 噪聲密度再加上接收機 NF 才是較合理的 noise floor。NI 的說明就直接寫了噪聲功率是 kTB，因此噪聲與頻寬成正比。

7. Scope 遮罩：這點沒有問題。
把 in-scope 外、out-of-scope 內直接標成 NaN，再在 shader discard 成透明，是正確而且乾淨的可視化做法。這反而是 7 點裡面最沒爭議的一點。

我會給你的結論是：

必改：#1、#4、#6
建議改：#3、#5
可保留：#2、#7

最精簡的修正版方向是：

拿掉 max(Friis, P1238)，改成 Friis + 顯式 deterministic losses
反射改用複數 Fresnel 係數，不要固定 π 相位
把 #4 改名為 corner knife-edge approximation，或真的上 UTD wedge
#5 改成多頻點/子載波平均，不要只用中心頻率
#6 把 noise floor 改成 bandwidth-dependent，並把 Wi-Fi 干擾分成「PHY overlap」和「MAC contention」兩層