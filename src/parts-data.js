/* ============================================================
   DJI Osmo Action 4 — shared part database
   Single source of truth for the 3D model, HUD and labels.
   Coordinates: X = width, Y = height, Z = depth (lens faces +Z)
   ============================================================ */
(function () {
  'use strict';

  window.ACTION4_META = {
    product: 'DJI Osmo Action 4',
    productCN: '大疆 Osmo Action 4',
    tagline: '运动相机 · 结构拆解实验室',
    edition: 'TEARDOWN / 01',
    dimensions: '70.5 × 44.2 × 32.8 mm',
    weight: '145 g',
    headline: [
      { label: '影像传感器', value: '1/1.3″', note: 'CMOS' },
      { label: '超广角视场', value: '155°', note: 'f/2.8' },
      { label: '最高视频', value: '4K / 120', note: 'fps' },
      { label: '裸机防水', value: '18 m', note: 'IP68' }
    ],
    quickSpecs: [
      { label: '感光元件', value: '1/1.3 英寸 CMOS' },
      { label: '镜头', value: '155° 超广角 / f/2.8' },
      { label: '视频规格', value: '4K/120fps · 10-bit D-Log M' },
      { label: '增稳系统', value: 'RockSteady 3.0 / HorizonSteady' },
      { label: '屏幕', value: '2.25″ 后屏 + 1.4″ 前屏' },
      { label: '电池', value: '1770mAh 耐低温电池' },
      { label: '防护', value: '18m 防水 / -20°C 耐低温' },
      { label: '尺寸重量', value: '70.5 × 44.2 × 32.8 mm / 145 g' }
    ]
  };

  /* explode: translation of the part from its assembled position
     anchor: rough local label anchor (model may refine it) */
  window.ACTION4_PARTS = [
    {
      id: 'body',
      no: '01',
      name: '机身中框',
      en: 'Main Chassis',
      category: '结构 / STRUCTURE',
      color: '#aeb7c2',
      accent: '#f6a63c',
      anchor: [1.2, -1.75, 0.9],
      explode: [0, 0, 0],
      core: true,
      short: '一体化防护骨架',
      specs: [
        { label: '机身尺寸', value: '70.5 × 44.2 × 32.8 mm' },
        { label: '整机重量', value: '145 g' },
        { label: '防护等级', value: '18 m 裸机防水' },
        { label: '工作温度', value: '-20°C ~ 45°C' }
      ],
      desc: '一体化高刚性中框为全部核心部件提供基准与保护，机身原生支持 18 米防水与 -20°C 耐低温，是整台 Action 4 的结构与密封基础。'
    },
    {
      id: 'lensCover',
      no: '02',
      name: '可替换保护镜',
      en: 'Lens Protective Cover',
      category: '光学 / OPTICS',
      color: '#9fd8e8',
      accent: '#63e6ff',
      anchor: [-1.75, 0.2, 2.32],
      explode: [-0.7, -0.25, 4.0],
      short: '旋拧式光学保护盖',
      specs: [
        { label: '镜片材质', value: '高强度光学玻璃' },
        { label: '表面镀膜', value: '疏水 / 疏油' },
        { label: '拆装方式', value: '旋拧快拆' },
        { label: '维护特性', value: '可独立更换' }
      ],
      desc: '镜头最外侧的可替换保护镜，承担抗刮、抗冲击与防水密封。表面疏水疏油镀膜可快速清洁，旋拧结构让户外受损后的更换无需拆机。'
    },
    {
      id: 'lens',
      no: '03',
      name: '超广角镜头模组',
      en: 'Ultra-Wide Lens',
      category: '光学 / OPTICS',
      color: '#6fc9ff',
      accent: '#4fdcff',
      anchor: [-1.75, 0.2, 1.95],
      explode: [-1.0, 0.95, 3.0],
      short: '155° 超广角 · f/2.8',
      specs: [
        { label: '视场角', value: '155° 超广角' },
        { label: '最大光圈', value: 'f/2.8' },
        { label: '镜组结构', value: '多片非球面镜组' },
        { label: '对焦方式', value: '固定焦点 · 泛焦' }
      ],
      desc: '超广角定焦光学模组，以 155° 视场和 f/2.8 大光圈覆盖运动场景。非球面镜片在控制畸变的同时，保证从中心到边缘的解析力。'
    },
    {
      id: 'sensor',
      no: '04',
      name: '影像传感器',
      en: '1/1.3″ CMOS Sensor',
      category: '影像 / IMAGING',
      color: '#7ef0c8',
      accent: '#48ffc5',
      anchor: [-0.35, 0.15, 1.3],
      explode: [-2.25, 2.0, 1.25],
      short: '1/1.3″ CMOS · 2.4μm',
      specs: [
        { label: '传感器尺寸', value: '1/1.3 英寸 CMOS' },
        { label: '等效像素尺寸', value: '2.4 μm' },
        { label: '色彩深度', value: '10-bit D-Log M' },
        { label: '低光能力', value: '高感光像素合并' }
      ],
      desc: '1/1.3 英寸大底传感器是 Action 4 画质跃升的核心。更大的感光面积与 2.4μm 等效像素尺寸，让暗光画面更纯净，并保留 10-bit D-Log M 调色空间。'
    },
    {
      id: 'frontScreen',
      no: '05',
      name: '前置副屏',
      en: 'Front Screen',
      category: '显示 / DISPLAY',
      color: '#ffcf7d',
      accent: '#ffb84d',
      anchor: [1.95, 0.2, 1.8],
      explode: [2.55, 1.65, 1.15],
      short: '1.4″ · 323 ppi',
      specs: [
        { label: '屏幕尺寸', value: '1.4 英寸' },
        { label: '像素密度', value: '323 ppi' },
        { label: '触控', value: '支持触控操作' },
        { label: '用途', value: '自拍取景 / 状态显示' }
      ],
      desc: '前置高亮副屏专为自拍与 vlog 取景设计，可在正面直接确认构图与录制状态。与后屏组成双屏交互系统，湿手也能完成基本操作。'
    },
    {
      id: 'rearScreen',
      no: '06',
      name: '后置触控屏',
      en: 'Rear Touchscreen',
      category: '显示 / DISPLAY',
      color: '#ffb15e',
      accent: '#ff9f43',
      anchor: [0, 0.15, -1.75],
      explode: [0.35, 0.25, -3.55],
      short: '2.25″ · 326 ppi',
      specs: [
        { label: '屏幕尺寸', value: '2.25 英寸' },
        { label: '像素密度', value: '326 ppi' },
        { label: '触控特性', value: '湿手触控 / 防指纹' },
        { label: '盖板玻璃', value: '高强度钢化玻璃' }
      ],
      desc: '2.25 英寸高清触控主屏，负责取景、参数调节与回放。表面覆盖高强度玻璃并支持湿手触控，在运动和水下场景中依然可靠。'
    },
    {
      id: 'mainboard',
      no: '07',
      name: '主控电路板',
      en: 'Mainboard',
      category: '计算 / COMPUTE',
      color: '#8ed87c',
      accent: '#78ff9c',
      anchor: [0.4, -0.35, 0.0],
      explode: [-3.1, -1.15, 0.55],
      short: 'SoC · Wi-Fi · USB-C',
      specs: [
        { label: '核心处理器', value: '低功耗影像 SoC' },
        { label: '无线连接', value: 'Wi-Fi / 蓝牙' },
        { label: '外部接口', value: 'USB-C（充电 / 数据）' },
        { label: '存储扩展', value: 'microSD 卡槽' }
      ],
      desc: '高集成度主控板承载影像处理 SoC、双屏驱动、无线连接与存储管理。紧凑的板级堆叠把旗舰运动相机的算力压缩进 32.8mm 的机身厚度。'
    },
    {
      id: 'battery',
      no: '08',
      name: '1770mAh 电池',
      en: 'Extreme Battery',
      category: '能源 / POWER',
      color: '#ffd066',
      accent: '#ffbe2e',
      anchor: [2.7, -0.8, 0.2],
      explode: [3.15, -1.35, 0.35],
      short: '1770mAh · 耐低温',
      specs: [
        { label: '电池容量', value: '1770 mAh' },
        { label: '最长续航', value: '约 160 分钟' },
        { label: '低温工作', value: '-20°C 可用' },
        { label: '安装方式', value: '侧开仓快拆' }
      ],
      desc: '1770mAh 耐低温电池通过侧开仓快速更换，在 -20°C 环境下仍可稳定供电。高能量密度电芯与紧凑仓体设计平衡了续航、重量与机身尺寸。'
    },
    {
      id: 'thermal',
      no: '09',
      name: '散热模组',
      en: 'Thermal Module',
      category: '热管理 / THERMAL',
      color: '#ff9f7e',
      accent: '#ff6b4a',
      anchor: [-2.0, 1.2, -0.4],
      explode: [-2.9, 1.9, -1.25],
      short: '铜质均热板 + 铝鳍片',
      specs: [
        { label: '导热结构', value: '铜质均热板' },
        { label: '散热鳍片', value: '高密度铝鳍片' },
        { label: '辅助材料', value: '石墨烯导热层' },
        { label: '设计目标', value: '4K 连续录制不降频' }
      ],
      desc: '多层热管理结构把 SoC 与传感器产生的热量快速导出。铜质均热板负责横向扩散，铝制鳍片扩大换热面积，实现长时间 4K 录制的稳定性能。'
    },
    {
      id: 'topControls',
      no: '10',
      name: '顶部按键与麦克风',
      en: 'Top Controls & Mics',
      category: '交互 / CONTROL',
      color: '#cfd7e2',
      accent: '#ff5c5c',
      anchor: [-2.2, 2.45, 0.25],
      explode: [-0.2, 2.9, 0.35],
      short: '快门 · QS · 收音',
      specs: [
        { label: '快门范围', value: '1/8000 – 5 s' },
        { label: '实体按键', value: '快门 / QS 快切' },
        { label: '收音系统', value: '立体声麦克风阵列' },
        { label: '状态提示', value: '录音指示灯' }
      ],
      desc: '顶部集成了快门、QS 快速切换键与收音开孔。快门键带防误触环形护圈，QS 键可在预设模式之间快速切换，运动中可以盲操作。'
    },
    {
      id: 'mount',
      no: '11',
      name: '磁吸快拆底座',
      en: 'Magnetic Quick-Release',
      category: '安装 / MOUNT',
      color: '#b6c3d1',
      accent: '#7fe7ff',
      anchor: [0, -2.55, 0.1],
      explode: [0.1, -2.75, 0.3],
      short: '磁吸定位 · 快速锁止',
      specs: [
        { label: '安装接口', value: '磁吸快拆底座' },
        { label: '扩展接口', value: '1/4″ 螺纹转接' },
        { label: '安装方向', value: '横拍 / 竖拍快切' },
        { label: '锁止结构', value: '机械卡扣 + 磁吸定位' }
      ],
      desc: '底部磁吸快拆底座通过磁吸预定位与机械卡扣锁止，实现一秒装卸。可横竖快速切换，兼容丰富的 DJI 运动相机配件生态。'
    }
  ];
})();
