# QA Report — DJI Osmo Action 4 · 3D 拆解实验室

日期：2026-10-25  
交付物：`index.html`（单文件，2,618,760 B）  
结论：**PASS**（无阻塞缺陷；本会话的残余风险均来自“无法运行浏览器进行最终视觉检查”）

## 已执行验证

| 检查 | 结果 |
| --- | --- |
| `node --check`（app / ui / model / parts-data / bundle / tools） | 7/7 通过 |
| `tools/test_model_node.js` | 通过：11 parts / 177 meshes / 45,930 tris / 93 materials，0 errors |
| `tools/test_app_node.js` @1440×900 | 通过：boot → select → explode(10/10 + 11 labels) → assemble(0/10)，0 errors |
| `tools/test_app_node.js` @1366×768 / 900×1000 / 834×1112 / 390×844 | 通过（移动端按设计只显示选中部件标签） |
| `tools/build_page.py` 确定性重建 | 通过；连续两次构建一致 |
| `tools/validate_page.py` | 通过：5 个内联经典脚本 + 1 个内联样式；无外部 `src/href` 依赖；无占位符；源码逐字内嵌 |
| UI 模块独立测试 | 通过：全部契约方法、8 个回调、移动端抽屉、键盘导航、hover 清除、busy/progress、destroy |
| 模型契约检查 | 通过：177/177 拾取网格带 partId；11 个部件组 identity；anchor 不可见不可拾取；body fadeMaterials 正常；update/dispose 幂等 |

## 需求覆盖

| 需求 | 实现 |
| --- | --- |
| DJI Action 4 外观与摄像头等核心部件 | 程序化机身、可替换保护镜、155° 超广角镜头、1/1.3″ CMOS、双屏、主板、电池、散热、顶部按键、磁吸底座 |
| 点击部件拆解动画 | 单击部件（或清单/详情按钮）沿设定方向拆解；再次点击复位；全部拆解/组装 |
| 自由旋转缩放 | OrbitControls（拖拽/滚轮/右键平移/触控），自动旋转、复位视角、全屏 |
| 部件详情 | 右栏显示类别、中英文名、说明、4 项参数、拆解状态与 CTA |
| 深色科技背景 | 空间渐变、程序化环境反射、地面网格/圆环、粒子、PBR 灯光、Bloom、ACES |
| 拆解发光高亮 | 部件 accent 自发光 + additive halo + reticle + 选中高亮，随动画增强 |
| 部件名称/参数标注 | 3D 投影标签 + 引导线；拆解后显示 11 个部件标签；选中部件参数在右栏完整呈现 |
| 仅 Three.js/HTML/CSS/JS，无外部模型 | Three.js r186 已内联；全部几何/屏幕 UI/图标/字体回退均为代码生成 |
| 部件清单、参数说明、操作引导 | 左栏清单 + 进度、右栏概览/详情、底部快捷提示、首次引导卡 |

## Lead 在 QA 后修复的问题

1. 统一响应式断点为 900px（app 与 UI 一致），修复 821–900px 平板布局冲突。
2. 标签层 z-index 降至 UI 面板之下，避免手机抽屉打开时标签遮挡/截获点击；拆解状态仍显示 11 个标签。
3. 机身中框（core）详情 CTA 与 3D 点击改为有意义的「全部拆解/全部组装」切换，不再是死操作。
4. busy 提示改为「结构联动中 / SYNCING ASSEMBLY」。
5. WebGL 初始化错误不再被通用 boot catch 覆盖。
6. Escape 同步清除 UI 行 hover；最终构建已包含全部修复。

## 残余风险

- 本会话无法启动浏览器/WebGL（安全策略），因此最终光照、Bloom 强度、真实手势与启动时序未做人工视觉验收。
- 已用几何软件投影检查体块比例（模型经历一次镜头/前屏比例修正）；实际材质与屏幕 UI 需在浏览器中打开 `index.html` 最终确认。
- 建议桌面端使用 Chrome/Edge，并开启硬件加速。

## 推荐

**Ship。** 直接双击 `index.html` 即可离线使用，无需服务器。
