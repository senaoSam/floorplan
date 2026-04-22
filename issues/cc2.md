對照七點規格，我找到幾處不一致與潛在 bug：

1. 繞射公式傳入參數錯誤（最可疑）
propagation.js:69：return Math.abs(knifeEdgeLossDb(-v))

你規格是 v = h · √(…)，直接代進 knife-edge 公式。這裡卻是傳 -v 再取絕對值，雙重反號會讓數值分支跑錯。Lee 近似是分段函數，v 跟 -v 不對稱（v≤-1 傳回 0，v>0 才有損失）。正確寫法應該是 knifeEdgeLossDb(v)，不加負號也不取 abs。這會讓被遮蔽點的繞射貢獻算錯。

2. ITU 路徑損失指數寫死成 5 GHz 辦公室 (N=31)
propagation.js:31 用 ITU_N_OFFICE_5G = 31 套在所有頻段。ITU-R P.1238 的 N 本來就是頻率+環境相關（2.4G 辦公室 ≈ 28、5G ≈ 31、6G ≈ 31–33）。既然第一點強調「不再寫死 5 GHz」，PL 的衰減指數也該隨 band 切換，否則 2.4 GHz AP 的室內衰減被高估。

3. 反射損失被重複計一次
propagation.js:119-121：反射振幅已用 pathPhasor(..., Math.PI) 帶 π 相位，但幅度又透過 reflLossDb = -20·log₁₀(rFactor) 當成額外 dB 扣在 plRef 上。這其實是正確的（把 |Γ|·roughness 反映到功率），但規格第 3 點寫的是「複數電壓 = √(P_rx)·e^(j(kd+φ))」——反射係數應該乘在振幅上而不是換成 dB 再從功率扣掉。兩種寫法只要係數一致結果相同，但目前 gammaMag = |Γ|·(0.5+0.5cosθ) 已經包含 obliquity，又在 roughness 上再乘一次，需要確認是否和你規格第 3 點的公式一致（你的式子是 R = |Γ|·(0.5+0.5cosθ)·e^(−2(kσcosθ)²)，這個實作是對的，不是 bug）。

4. Scope 遮罩語意倒反（跟規格第 7 點不符）
規格：「In-scope 多邊形外 + Out-of-scope 多邊形內 的網格點不計算」。
buildScenario.js:169-177 實作是「in-scope 外就 false、out-scope 內就 false」——這其實是對的（return true 表示「會計算」）。沒問題，誤報。