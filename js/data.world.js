/* ============================================================
   创世引擎 · 世界数据（前端原型 Mock）
   数据结构严格对齐《创世契约.json》变量更新规则：
   世界 / 地图区块 / 文明 / 种族 / 超凡体系 / 收藏夹 / 大事记 / 门槛科技
   ============================================================ */
window.GE = window.GE || {};

GE.data = (function () {

  /* ---------- 世界 ---------- */
  const world = {
    状态: "运转中",
    纪元: { 纪元: "曙光纪元", 纪年: "第4纪元", 核心特性: "超光速壁垒将破，万邦仰望星空" },
    年数: 1247,
    能级: 268,                 // 中魔（251~300）
    能级档位: "中魔",
    空间形态: "单恒星系 · 多行星",
    核心法则: "质能守恒 · 灵能潮汐周期律",
    物质与能量: "恒星『曦阳』为主序黄矮星，灵能随潮汐每六十年涨落一次",
    恒星名: "曦阳",
    母星名: "盖亚"
  };

  /* ---------- 文明等级参照（0~9） ---------- */
  const civLevels = [
    { lv: 0, name: "原始",   desc: "本能与经验求存，尚无系统化工具与社会组织" },
    { lv: 1, name: "行星文明", desc: "基础工业与信息技术，全球通讯网络，复杂社会组织" },
    { lv: 2, name: "初星际",  desc: "电磁武器与护盾，缓慢星际航行，探测邻近恒星系" },
    { lv: 3, name: "星际文明", desc: "能量武器，超光速航行，跨星系联络与贸易" },
    { lv: 4, name: "跨星系",  desc: "不成熟虫洞技术，高级自动化，殖民进入扩张阶段" },
    { lv: 5, name: "星系帝国", desc: "成熟虫洞网络，戴森构造，版图以星系为单位" },
    { lv: 6, name: "恒星工程", desc: "大规模改造恒星系，初步触及维度操控边界" },
    { lv: 7, name: "星系级",  desc: "星系级工程，局部影响基本物理常数" },
    { lv: 8, name: "近神",   desc: "跨星系团统治，接近改写宇宙局部法则" },
    { lv: 9, name: "神话",   desc: "形态或已超越物质，已知等级的极限" }
  ];

  /* ---------- 能级参照 ---------- */
  const energyScale = [
    { min: 1,   max: 120, name: "无魔", desc: "肌肉与钢铁是力量的极限，超凡仅为不可复现的传说" },
    { min: 121, max: 250, name: "低魔", desc: "能量稀薄，唯有天赋异禀者借特殊功法触及超凡" },
    { min: 251, max: 300, name: "中魔", desc: "锻炼即可感应能量，修炼成为文明的一部分" },
    { min: 300, max: 999, name: "高魔 · 超魔", desc: "万物沐浴浓郁能量，诸神行走，传说不断书写" }
  ];

  /* ---------- 文明 ---------- */
  const civs = [
    {
      id: "dawn", name: "晨曦联邦", short: "晨曦", color: "#4fd2ff",
      level: 2, stage: "鼎盛", capital: "天枢港",
      文明阶段: "鼎盛", 社会形态: "联邦",
      起源: "旧纪元诸邦在能源危机中缔结《曦光盟约》，以理性与协商立国，率先挣脱大气层的桎梏。",
      政体及运作: "联邦议会制。十七座城邦各推举执政官组成星枢院，任期八年，重大决策需三分之二多数。下设天工、星海、民生三署分理科技、航天与内政。",
      思潮: "星际理性主义——相信文明的意义在于走向深空，视星空为集体信仰。",
      领袖及性格: "执政长 林深 · 沉着、克制、目光长远，近乎冷酷的务实主义者。",
      目前国策: {
        名称: "揽星计划",
        内容: "倾全国之力建造『望舒』轨道站与星链星座，铺设环盖亚卫星网；天工署预算提至四成，暂缓向地表诸国输出航天技术。",
        持续年数: 31
      },
      国民理念: "我们并非诞生于星空之下，而是为了回到星空之中。",
      军事与人口: "常备军九十万，以轨道打击平台与无人机群为核心；人口三亿两千万，七成聚居于东部沿海城邦带。",
      文明特质: "工程狂热 · 集体协商 · 技术保守主义（对外封锁航天）",
      发展计划: "十年内建成永久月球前哨，三十年内试制首艘跨星系探测舰『逐光号』。",
      科技树: {
        文明等级: 2, 下一阶段: 61,
        节点: {
          "火焰驯化":   { 层级: 1, 描述: "掌握火的使用与长期保存", 迭代: "1120年", 状态: "已解锁", 前置: "无", 进度: 100 },
          "文字刻印":   { 层级: 1, 描述: "以符号系统跨代记录知识", 迭代: "980年", 状态: "已解锁", 前置: "无", 进度: 100 },
          "熔岩冶金":   { 层级: 1, 描述: "熔炼矿石提取金属，奠定工业之基", 迭代: "760年", 状态: "已解锁", 前置: "火焰驯化", 进度: 100 },
          "蒸汽机枢":   { 层级: 1, 描述: "以蒸汽之力驱动机械，开启工业纪元", 迭代: "410年", 状态: "已解锁", 前置: "熔岩冶金", 进度: 100 },
          "电力网络":   { 层级: 1, 描述: "电网覆盖城邦，信息以光速流转", 迭代: "265年", 状态: "已解锁", 前置: "蒸汽机枢", 进度: 100 },
          "聚变之火":   { 层级: 2, 描述: "可控核聚变工程化，能源自此近乎无穷", 迭代: "88年", 状态: "已解锁", 前置: "电力网络", 进度: 100 },
          "电磁轨道炮": { 层级: 2, 描述: "以电磁力将弹丸加速至极致", 迭代: "54年", 状态: "已解锁", 前置: "电力网络", 进度: 100 },
          "化学火箭":   { 层级: 2, 描述: "挣脱引力的第一级阶梯", 迭代: "92年", 状态: "已解锁", 前置: "蒸汽机枢", 进度: 100 },
          "星链星座":   { 层级: 2, 描述: "环轨卫星网，覆盖全球的通讯之壳", 迭代: "31年", 状态: "已解锁", 前置: "化学火箭", 进度: 100 },
          "等离子护盾": { 层级: 2, 描述: "以约束等离子体偏转动能武器", 迭代: "12年", 状态: "研究中", 前置: "电磁轨道炮", 进度: 64 },
          "亚光速引擎": { 层级: 3, 描述: "聚变推进至光速的百分之一，星际航行的钥匙", 迭代: "6年", 状态: "研究中", 前置: "聚变之火", 进度: 38 },
          "曲速理论":   { 层级: 3, 描述: "压缩与膨胀时空的假想——通往光速壁垒彼岸的唯一假说", 迭代: "2年", 状态: "研究中", 前置: "亚光速引擎", 进度: 9 }
        }
      },
      stats: { 人口: 320, 军力: 78, 经济: 88, 稳定: 82, 科研: 94, 扩张: 70 },
      leaders: [
        {
          id: "linshen", name: "林深", title: "联邦执政长", role: "领袖",
          gender: "男", race: "人族", age: 58, lifespanMax: 96,
          bodyState: "康健 · 左臂旧伤阴雨天隐痛",
          personality: { code: "dHlRz", stability: "S", 注: "疏离 · 隐忍 · 从容 · 柔韧 · 执着",
            dims: [ {k:"亲疏",a:"亲",b:"疏",v:72},{k:"显隐",a:"显",b:"隐",v:80},{k:"急缓",a:"急",b:"缓",v:70},{k:"刚柔",a:"刚",b:"柔",v:62},{k:"执逸",a:"执",b:"逸",v:18} ] },
          abilities: [ {name:"战略",val:92},{name:"外交",val:74},{name:"学识",val:81},{name:"意志",val:95},{name:"魅力",val:58} ],
          background: "出身于天枢港造船世家，少年亲历『大断电』能源危机，目睹旧邦在黑暗中自相残杀。自此坚信唯有走向深空，文明才不必在囚笼中互噬。四十岁入主星枢院，以二十年磨一剑的耐心推动揽星计划。",
          motive: "在他有生之年，亲眼看见晨曦的旗帜插上另一颗恒星的光里。",
          isAgent: true, agentModel: "GE-Agent · 执政官人格 v3", agentStance: "稳健扩张 / 技术封锁"
        },
        {
          id: "suyan", name: "苏砚", title: "天工署首席", role: "关键人物 · 总设计师",
          gender: "女", race: "人族", age: 44, lifespanMax: 92,
          bodyState: "康健 · 长期伏案致颈椎劳损",
          personality: { code: "wOaGz", stability: "A", 注: "亲近 · 坦露 · 急切 · 刚硬 · 执着",
            dims: [ {k:"亲疏",a:"亲",b:"疏",v:22},{k:"显隐",a:"显",b:"隐",v:18},{k:"急缓",a:"急",b:"缓",v:20},{k:"刚柔",a:"刚",b:"柔",v:16},{k:"执逸",a:"执",b:"逸",v:12} ] },
          abilities: [ {name:"学识",val:97},{name:"战略",val:64},{name:"意志",val:88},{name:"创造",val:96},{name:"外交",val:41} ],
          background: "亚光速引擎理论奠基人。十二岁拆解家中反应堆被全城通缉，十八岁入天工署，二十六岁提出『曲率气泡』雏形假说。性如烈火，与星枢院的谨慎屡起冲突，却是揽星计划真正的引擎。",
          motive: "证明光速不是牢笼，而是一道尚未推开的门。",
          isAgent: true, agentModel: "GE-Agent · 工程师人格 v5", agentStance: "激进研发 / 冒险试制"
        },
        {
          id: "jianghan", name: "江寒", title: "星海署统帅", role: "关键人物 · 舰队司令",
          gender: "女", race: "人族", age: 51, lifespanMax: 94,
          bodyState: "康健 · 右眼为战术义眼",
          personality: { code: "DhLGz", stability: "S", 注: "疏离 · 隐忍 · 从容 · 刚硬 · 执着",
            dims: [ {k:"亲疏",a:"亲",b:"疏",v:76},{k:"显隐",a:"显",b:"隐",v:70},{k:"急缓",a:"急",b:"缓",v:66},{k:"刚柔",a:"刚",b:"柔",v:16},{k:"执逸",a:"执",b:"逸",v:22} ] },
          abilities: [ {name:"战略",val:95},{name:"军事",val:93},{name:"意志",val:90},{name:"外交",val:52},{name:"学识",val:61} ],
          background: "联邦轨道舰队第一任司令，曾以一己之力平定『环轨叛乱』。信奉『星空不怜悯犹豫者』。对地表诸国的窥探始终保持冰冷的戒备。",
          motive: "让联邦的轨道之上，永远只有联邦的旗帜。",
          isAgent: true, agentModel: "GE-Agent · 军人格 v4", agentStance: "轨道威慑 / 先发制人"
        }
      ],
      territorySeed: { lat: 18, lon: 40, weight: 1.35 },
      orbital: { satellites: 96, station: "望舒轨道站", ships: 3 }
    },

    {
      id: "aurel", name: "奥瑞利安帝国", short: "奥瑞", color: "#e6a948",
      level: 1, stage: "鼎盛", capital: "金辉城",
      文明阶段: "鼎盛", 社会形态: "帝制",
      起源: "崛起于中央富庶平原的古老王朝，历经十一次王朝更替而不灭，以铁与麦确立了大陆霸权。",
      政体及运作: "世袭帝制。皇帝之下设三省九卿，行省总督握有兵权，世家大族与皇权相互制衡。近年改革派与守旧派暗流涌动。",
      思潮: "大陆中心主义——视盖亚为世界唯一舞台，对联邦仰望星空的行为既轻蔑又忌惮。",
      领袖及性格: "皇帝 萧玦 · 雄才大略而多疑，恩威并施，深谙权术。",
      目前国策: {
        名称: "固陆强兵",
        内容: "扩编重装军团至一百二十万，沿北境修筑『铁脊』要塞链；重金收买联邦叛逃工程师，秘密筹建首座发射台。",
        持续年数: 14
      },
      国民理念: "大地承载一切，星辰不过是诸神钉在天幕上的钉饰。",
      军事与人口: "陆军一百二十万，重装骑士与符文火炮并举；人口五亿六千万，为诸国之最。",
      文明特质: "人口红利 · 陆权至上 · 对航天既渴望又恐惧",
      发展计划: "五年内建成帝国首座发射台，不让联邦独吞星空；同时压制国内改革派。",
      科技树: {
        文明等级: 1, 下一阶段: 74,
        节点: {
          "火焰驯化": { 层级: 1, 描述: "掌握火的使用与长期保存", 迭代: "1400年", 状态: "已解锁", 前置: "无", 进度: 100 },
          "农耕历法": { 层级: 1, 描述: "观天授时，水利灌溉，养育亿万之众", 迭代: "1200年", 状态: "已解锁", 前置: "无", 进度: 100 },
          "熔岩冶金": { 层级: 1, 描述: "熔炼矿石提取金属", 迭代: "900年", 状态: "已解锁", 前置: "火焰驯化", 进度: 100 },
          "符文火炮": { 层级: 1, 描述: "以铭文增幅的重型火炮，帝国的陆权之矛", 迭代: "180年", 状态: "已解锁", 前置: "熔岩冶金", 进度: 100 },
          "蒸汽机枢": { 层级: 1, 描述: "以蒸汽之力驱动机械", 迭代: "96年", 状态: "已解锁", 前置: "熔岩冶金", 进度: 100 },
          "电力网络": { 层级: 1, 描述: "电网初成，照亮皇都的夜晚", 迭代: "30年", 状态: "研究中", 前置: "蒸汽机枢", 进度: 71 },
          "发射台工程": { 层级: 2, 描述: "逆向自联邦叛逃者的图纸，帝国的登天野望", 迭代: "4年", 状态: "研究中", 前置: "电力网络", 进度: 23 }
        }
      },
      stats: { 人口: 560, 军力: 92, 经济: 76, 稳定: 64, 科研: 55, 扩张: 80 },
      leaders: [
        {
          id: "xiaojue", name: "萧玦", title: "帝国皇帝", role: "领袖",
          gender: "男", race: "人族", age: 47, lifespanMax: 88,
          bodyState: "康健 · 思虑过甚，夜不能寐",
          personality: { code: "DHLGZ", stability: "S", 注: "疏离 · 隐忍 · 从容 · 刚硬 · 执着",
            dims: [ {k:"亲疏",a:"亲",b:"疏",v:82},{k:"显隐",a:"显",b:"隐",v:82},{k:"急缓",a:"急",b:"缓",v:64},{k:"刚柔",a:"刚",b:"柔",v:14},{k:"执逸",a:"执",b:"逸",v:10} ] },
          abilities: [ {name:"权谋",val:96},{name:"军事",val:84},{name:"意志",val:90},{name:"魅力",val:78},{name:"学识",val:62} ],
          background: "幼年于冷宫长大，看尽世态炎凉。十七岁夺嫡登基，以雷霆手段清洗三姓世家，将帝国推向鼎盛。他不在乎星空，却无法容忍头顶有一片不属于他的天。",
          motive: "凡阳光所照，皆应为奥瑞利安之土——哪怕那光来自另一颗星。",
          isAgent: true, agentModel: "GE-Agent · 帝王人格 v6", agentStance: "陆权扩张 / 暗中追赶"
        },
        {
          id: "peiyin", name: "裴隐", title: "首席宫廷法师", role: "关键人物 · 钦天监正",
          gender: "男", race: "人族", age: 63, lifespanMax: 90,
          bodyState: "衰 · 灵能反噬致双目渐盲",
          personality: { code: "dHlgZ", stability: "A", 注: "疏离 · 隐忍 · 从容 · 柔韧 · 执着",
            dims: [ {k:"亲疏",a:"亲",b:"疏",v:66},{k:"显隐",a:"显",b:"隐",v:76},{k:"急缓",a:"急",b:"缓",v:74},{k:"刚柔",a:"刚",b:"柔",v:56},{k:"执逸",a:"执",b:"逸",v:16} ] },
          abilities: [ {name:"灵能",val:90},{name:"学识",val:85},{name:"权谋",val:72},{name:"意志",val:68},{name:"预见",val:81} ],
          background: "钦天监世守，三朝元老。他能从灵能潮汐中读到国运的涨落，是第一个警告皇帝『星辰亦可为兵器』的人。双目的代价，换来窥见未来的碎片。",
          motive: "在灵能彻底背弃这具身躯之前，为帝国留下一双能看见星空的眼。",
          isAgent: true, agentModel: "GE-Agent · 先知人格 v2", agentStance: "观星预警 / 灵能制衡"
        }
      ],
      territorySeed: { lat: 4, lon: -10, weight: 1.7 }
    },

    {
      id: "sylva", name: "希尔瓦娜联盟", short: "希尔", color: "#6fd08c",
      level: 1, stage: "发展", capital: "翠冠圣林",
      文明阶段: "发展", 社会形态: "联邦",
      起源: "栖居于世界树冠层的精灵诸部，在漫长的岁月中学会与森林同呼吸，以盟约而非刀剑维系秩序。",
      政体及运作: "长老议会制。七大精灵部族各遣长老共议联盟事务，德鲁伊教团执掌信仰与灵能传承，地位超然。",
      思潮: "自然共生主义——认为文明应是森林的一部分，而非征服者；警惕一切脱离大地的力量。",
      领袖及性格: "大长老 伊瑟兰 · 睿智、悲悯、深沉，以千年岁月丈量世事。",
      目前国策: {
        名称: "根脉守望",
        内容: "加固世界树的灵能根脉网络，培育德鲁伊接替者；对人类诸国的工业化扩张保持警戒，闭锁圣林边界。",
        持续年数: 58
      },
      国民理念: "森林记得每一片落叶，正如我们记得每一位祖先。",
      军事与人口: "林地游侠与树卫二十万，善御自然之力；人口八千万，散居于林冠诸城。",
      文明特质: "长寿智慧 · 灵能亲和 · 保守封闭",
      发展计划: "维系灵能根脉的存续，静观人类诸国的兴衰，在必要时守护最后的净土。",
      科技树: {
        文明等级: 1, 下一阶段: 33,
        节点: {
          "灵植栽培": { 层级: 1, 描述: "培育通灵植物，构筑活着的城郭", 迭代: "2400年", 状态: "已解锁", 前置: "无", 进度: 100 },
          "符文记录": { 层级: 1, 描述: "以生命符文镌刻记忆，传承千年", 迭代: "2200年", 状态: "已解锁", 前置: "无", 进度: 100 },
          "自然德鲁伊术": { 层级: 1, 描述: "沟通草木鸟兽，御使自然之力", 迭代: "1800年", 状态: "已解锁", 前置: "灵植栽培", 进度: 100 },
          "灵脉共鸣": { 层级: 1, 描述: "与世界树根脉共振，感知千里之外的生机", 迭代: "900年", 状态: "已解锁", 前置: "自然德鲁伊术", 进度: 100 },
          "生命编织": { 层级: 2, 描述: "重塑血肉与生机的形态，近乎造物", 迭代: "120年", 状态: "研究中", 前置: "灵脉共鸣", 进度: 47 }
        }
      },
      stats: { 人口: 80, 军力: 58, 经济: 62, 稳定: 88, 科研: 49, 扩张: 30 },
      leaders: [
        {
          id: "yiselan", name: "伊瑟兰", title: "联盟大长老", role: "领袖",
          gender: "女", race: "精灵族", age: 712, lifespanMax: 980,
          bodyState: "康健 · 千年岁月的疲惫沉淀于眼底",
          personality: { code: "dHLrY", stability: "S", 注: "疏离 · 隐忍 · 从容 · 柔韧 · 随遇而安",
            dims: [ {k:"亲疏",a:"亲",b:"疏",v:64},{k:"显隐",a:"显",b:"隐",v:72},{k:"急缓",a:"急",b:"缓",v:80},{k:"刚柔",a:"刚",b:"柔",v:70},{k:"执逸",a:"执",b:"逸",v:74} ] },
          abilities: [ {name:"智慧",val:97},{name:"灵能",val:92},{name:"外交",val:84},{name:"意志",val:86},{name:"预见",val:88} ],
          background: "亲历过上一纪元的焚林之劫，见过文明如秋叶般荣枯。她治下的联盟如深林般静谧，因为她比谁都清楚：最可怕的风暴，往往起于人类仰望星空时眼底的光。",
          motive: "让森林活过这一个千年，也活过下一个。",
          isAgent: true, agentModel: "GE-Agent · 长者人格 v7", agentStance: "守成观望 / 灵能自守"
        }
      ],
      territorySeed: { lat: -32, lon: 130, weight: 1.1 }
    },

    {
      id: "bronze", name: "铜须锻魂氏族", short: "铜须", color: "#d97b4f",
      level: 1, stage: "发展", capital: "熔心堡",
      文明阶段: "发展", 社会形态: "氏族",
      起源: "穴居于龙脊山脉地底的矮人氏族，以炉火与锤音为心跳，坚信金属中沉睡着大地的灵魂。",
      政体及运作: "氏族联盟。十二锻炉家族推举『炉火之王』统辖对外事务，族内事务由各家族长老自治，以锻造技艺论尊卑。",
      思潮: "锻造宿命论——相信每一件器物都承载着锻造者的灵魂，工艺即信仰。",
      领袖及性格: "炉火之王 巴尔刚 · 豪爽、固执、重信守诺，一诺千金的硬汉。",
      目前国策: {
        名称: "百炉竞煅",
        内容: "开放十二座祖传锻炉竞技，以符文冶金之术招揽四族能工巧匠；向奥瑞利安出口符文火炮，换取粮食与稀土。",
        持续年数: 22
      },
      国民理念: "锤起锤落之间，灵魂便有了新的形状。",
      军事与人口: "山卫与符文机甲十五万，守御地底长廊；人口六千万，聚居于山脉诸堡。",
      文明特质: "符文冶金 · 工匠至上 · 重商轻战",
      发展计划: "钻研灵能锻造之术，让器物拥有真正的灵魂；巩固与四族的匠艺贸易。",
      科技树: {
        文明等级: 1, 下一阶段: 41,
        节点: {
          "熔岩冶金": { 层级: 1, 描述: "熔炼矿石提取金属", 迭代: "1600年", 状态: "已解锁", 前置: "无", 进度: 100 },
          "石器铸形": { 层级: 1, 描述: "打磨石器制造工具与武器", 迭代: "1500年", 状态: "已解锁", 前置: "无", 进度: 100 },
          "符文铭刻": { 层级: 1, 描述: "在器物上刻录符文以附加超凡效果", 迭代: "800年", 状态: "已解锁", 前置: "石器铸形", 进度: 100 },
          "符文冶金": { 层级: 1, 描述: "以符文阵列精炼金属，铸就超凡之器", 迭代: "420年", 状态: "已解锁", 前置: "熔岩冶金", 进度: 100 },
          "灵能锻造": { 层级: 2, 描述: "将灵能注入金属，改变其物理特性", 迭代: "26年", 状态: "研究中", 前置: "符文冶金", 进度: 58 },
          "铭文巨像": { 层级: 2, 描述: "以符文阵列为骨架建造巨型傀儡", 迭代: "9年", 状态: "研究中", 前置: "符文铭刻", 进度: 31 }
        }
      },
      stats: { 人口: 60, 军力: 66, 经济: 72, 稳定: 76, 科研: 61, 扩张: 40 },
      leaders: [
        {
          id: "baergang", name: "巴尔刚", title: "炉火之王", role: "领袖",
          gender: "男", race: "矮人族", age: 186, lifespanMax: 320,
          bodyState: "康健 · 右臂因常年抡锤而比左臂粗壮一圈",
          personality: { code: "WOaGZ", stability: "S", 注: "亲近 · 坦露 · 急切 · 刚硬 · 执着",
            dims: [ {k:"亲疏",a:"亲",b:"疏",v:22},{k:"显隐",a:"显",b:"隐",v:16},{k:"急缓",a:"急",b:"缓",v:24},{k:"刚柔",a:"刚",b:"柔",v:12},{k:"执逸",a:"执",b:"逸",v:20} ] },
          abilities: [ {name:"锻造",val:97},{name:"军事",val:72},{name:"意志",val:90},{name:"魅力",val:74},{name:"权谋",val:38} ],
          background: "十二锻炉竞技史上最年轻的大满贯得主。他当上炉火之王那天说的第一句话是：『炉子烧得够旺，朋友自然来。』他不懂权术，但四族都愿意跟他做生意，因为他的锤子从不说谎。",
          motive: "锻出一件能流传一万年的器物，让后世提起铜须时先想到他的名字。",
          isAgent: true, agentModel: "GE-Agent · 工匠人格 v3", agentStance: "匠艺贸易 / 中立亲商"
        }
      ],
      territorySeed: { lat: 44, lon: -120, weight: 0.95 }
    },

    {
      id: "abyss", name: "深渊眷族", short: "深渊", color: "#7f8cf0",
      level: 1, stage: "萌芽", capital: "潮歌渊城",
      文明阶段: "萌芽", 社会形态: "部落",
      起源: "渊居深海巨渊的鲛人部族，在永夜与高压中淬炼出独特的灵能文明，陆上诸国对其知之甚少。",
      政体及运作: "母系部族联盟。由『潮母』统领各渊部族，以灵能歌谣传递政令与记忆，深潜祭祀执掌与深渊的沟通。",
      思潮: "深渊归一主义——相信深海是世界的子宫与坟墓，一切终将归于潮水。",
      领袖及性格: "潮母 涅芮 · 神秘、深沉、掌控欲强，视深海为不容亵渎的圣地。",
      目前国策: {
        名称: "听潮",
        内容: "派遣深潜祭祀聆听深渊深处的『低语』，绘制海沟灵脉图；对陆上的喧嚣保持距离，暗中积蓄力量。",
        持续年数: 9
      },
      国民理念: "潮水记得一切沉入其中的名字。",
      军事与人口: "潮卫与海兽骑乘八万，御深海巨兽为战；人口四千万，散居于海渊诸城。",
      文明特质: "深海灵能 · 神秘封闭 · 驭兽之术",
      发展计划: "解开深渊『低语』之谜，在陆上文明察觉之前，掌握深海的全部秘密。",
      科技树: {
        文明等级: 1, 下一阶段: 18,
        节点: {
          "灵能歌谣": { 层级: 1, 描述: "以灵能歌谣传递信息与记忆", 迭代: "1100年", 状态: "已解锁", 前置: "无", 进度: 100 },
          "驭兽之术": { 层级: 1, 描述: "驯化深海巨兽为坐骑与战力", 迭代: "900年", 状态: "已解锁", 前置: "无", 进度: 100 },
          "高压淬体": { 层级: 1, 描述: "以深海高压淬炼肉身，坚逾精钢", 迭代: "600年", 状态: "已解锁", 前置: "无", 进度: 100 },
          "深渊灵视": { 层级: 2, 描述: "直视深渊而不被疯狂吞噬的秘术", 迭代: "15年", 状态: "研究中", 前置: "灵能歌谣", 进度: 29 }
        }
      },
      stats: { 人口: 40, 军力: 52, 经济: 44, 稳定: 68, 科研: 38, 扩张: 34 },
      leaders: [
        {
          id: "neirui", name: "涅芮", title: "潮母", role: "领袖",
          gender: "女", race: "鲛人族", age: 96, lifespanMax: 240,
          bodyState: "康健 · 鳞片泛着深渊磷光",
          personality: { code: "DHlGZ", stability: "F", 注: "疏离 · 隐忍 · 从容 · 刚硬 · 执着 · 流动",
            dims: [ {k:"亲疏",a:"亲",b:"疏",v:80},{k:"显隐",a:"显",b:"隐",v:80},{k:"急缓",a:"急",b:"缓",v:70},{k:"刚柔",a:"刚",b:"柔",v:22},{k:"执逸",a:"执",b:"逸",v:16} ] },
          abilities: [ {name:"灵能",val:93},{name:"权谋",val:82},{name:"意志",val:88},{name:"神秘",val:90},{name:"外交",val:56} ],
          background: "史上最年轻的潮母，也是最接近深渊秘密的人。传说她能在梦中听见深渊的『低语』，并从中读出陆上文明尚未知晓的未来。她对陆地的兴趣，远比她表现出来的要深。",
          motive: "在陆上诸国把目光投向星空时，让深渊眷族成为深海唯一的主人。",
          isAgent: true, agentModel: "GE-Agent · 潮母人格 v2", agentStance: "深藏蓄势 / 深渊探秘"
        }
      ],
      territorySeed: { lat: -58, lon: -60, weight: 1.0 }
    }
  ];

  /* ---------- 种族 ---------- */
  const races = [
    { id:"ren", name:"人族", 寿命极限:"平均85岁，百岁为高寿，老而体衰",
      生理特征:"体态中等，适应力极强，繁衍旺盛，寿命短促却因此进取心切。",
      核心天赋:"均衡的学习能力与无与伦比的适应力，文明扩张最快的种族。",
      社会习俗:"重视血缘与地缘，善建城邦与国家，信仰多元，以文字记录历史。" },
    { id:"jingling", name:"精灵族", 寿命极限:"平均980岁，死前会化为荧光归于森林",
      生理特征:"身形颀长，耳尖目锐，感知敏锐，繁衍缓慢，与自然灵能天然亲和。",
      核心天赋:"天生的灵能亲和者，寿命悠长，记忆与智慧跨越千年。",
      社会习俗:"崇尚自然与艺术，以部族与长老制维系秩序，与世界树共生。" },
    { id:"airen", name:"矮人族", 寿命极限:"平均320岁，死前骨骼会逐渐金属化",
      生理特征:"身材矮壮，筋骨强健，耐力惊人，惧水畏火（锻造业依赖地火灵能）。",
      核心天赋:"对金属与符文有近乎直觉的理解，是举世无双的工匠。",
      社会习俗:"以氏族与锻炉为核心，重信守诺，以工艺论尊卑，好饮烈酒。" },
    { id:"jiaoren", name:"鲛人族", 寿命极限:"平均240岁，死后沉入深渊化为磷光",
      生理特征:"人身鱼尾，覆有磷光细鳞，可在万米深压下生存，上岸则行动迟缓。",
      核心天赋:"深海灵能亲和，能以歌谣传递灵能，驭使深海巨兽。",
      社会习俗:"母系部族，以潮母为尊，以灵能歌谣传承记忆，敬畏深渊。" },
    { id:"ling", name:"灵族", 寿命极限:"近乎不灭，唯灵能枯竭时消散",
      生理特征:"由纯粹灵能凝聚而成的意识体，无固定形态，可附于器物或血肉。",
      核心天赋:"纯粹灵能的化身，可自由操控能量形态，却受灵能潮汐涨落制约。",
      社会习俗:"游离于诸国之外，常被奉为神明或忌惮为妖魔，行踪诡秘。" }
  ];

  /* ---------- 超凡体系 ---------- */
  const transcendent = [
    { id:"lingneng", name:"灵能潮汐体系", 等级划分:"感气 → 通脉 → 凝核 → 化神 → 渡劫",
      体系特点:"以肉身感应天地灵能，随潮汐涨落而强弱。中魔世界的主流修炼之道。",
      升级条件:"吐纳灵能、淬炼经脉，需天赋与功法兼备，境界突破伴随灵能反噬之险。",
      等级差距:"每升一境，灵能储量与操控力增长数倍；化神境可短暂离体，渡劫境仅存在于传说。",
      超凡者数量:"诸国合计约十二万超凡者，多为感气、通脉两境，凝核以上不足千人。" },
    { id:"fuwen", name:"符文铭刻体系", 等级划分:"识纹 → 刻符 → 铸魂 → 通灵",
      体系特点:"以符文阵列将超凡之力固着于器物，矮人族独步天下的技艺。",
      升级条件:"需同时精通冶金与灵能，对符文的理解越深，器物所能承载的『灵魂』越强。",
      等级差距:"识纹者仅能为器物附魔，铸魂境可赋予器物初步灵性，通灵境传说可造出拥有自我的器物。",
      超凡者数量:"约三万符文工匠，铸魂境仅铜须氏族数位长老。" },
    { id:"shenyun", name:"深渊灵视体系", 等级划分:"听潮 → 窥渊 → 御渊 → 归一",
      体系特点:"鲛人族独门的秘术，直面深渊而不被疯狂吞噬，代价是逐渐失去『人』的形态。",
      升级条件:"深潜入更幽暗的海渊，聆听『低语』而保持神智；越深，所知越多，越不像人。",
      等级差距:"窥渊者可预知片段未来，御渊者能驭使深渊巨兽，归一境者已与深渊无异。",
      超凡者数量:"不足两千深潜祭祀，多为听潮境，归一境或已非人。" }
  ];

  /* ---------- 收藏夹 ---------- */
  const favorites = [
    { id:"suyan", name:"苏砚", civ:"dawn", 种族与身份:"人族 · 晨曦联邦天工署首席",
      超凡能力:"感气境（灵能非其所长，其力量在于头脑）",
      寿命与年龄:"44岁 / 预期92岁", 性格与动机:"性如烈火、执着如钢；毕生只为证明光速不是牢笼。",
      近况:"亚光速引擎点火试车在即，与星枢院的预算之争愈演愈烈。" },
    { id:"peiyin", name:"裴隐", civ:"aurel", 种族与身份:"人族 · 奥瑞利安钦天监正",
      超凡能力:"化神境（灵能反噬，双目渐盲）",
      寿命与年龄:"63岁 / 预期90岁", 性格与动机:"深沉隐忍、以预见护国；想在灵能背弃身躯前为帝国留下一双望星的眼。",
      近况:"从灵能潮汐中读到一个模糊的凶兆，却看不清它来自星空还是深渊。" },
    { id:"neirui", name:"涅芮", civ:"abyss", 种族与身份:"鲛人族 · 深渊眷族潮母",
      超凡能力:"窥渊境（可聆听深渊低语）",
      寿命与年龄:"96岁 / 预期240岁", 性格与动机:"神秘深沉、掌控欲强；要在陆上诸国仰望星空时独霸深海。",
      近况:"深渊的『低语』近来愈发清晰，其中反复出现一个她听不懂的词——『收割』。" }
  ];

  /* ---------- 大事记（编年，只增不删） ---------- */
  const chronicle = [
    { 年份:"第1纪元 · 元年", 纪元:"奇迹纪元", 类型:"创世", 事件概述:"曦阳点燃，盖亚自混沌星云中凝聚成型，灵能潮汐第一次漫过大地。" },
    { 年份:"第1纪元 · 214年", 纪元:"奇迹纪元", 类型:"种族", 事件概述:"人族、精灵、矮人相继走出蒙昧，最早的城邦在大河之畔点燃篝火。" },
    { 年份:"第2纪元 · 58年", 纪元:"皓月纪元", 类型:"文明", 事件概述:"精灵诸部于世界树冠层缔结盟约，希尔瓦娜联盟立。" },
    { 年份:"第2纪元 · 139年", 纪元:"皓月纪元", 类型:"战争", 事件概述:"第一次焚林之劫——人族诸邦为争夺土地纵火，精灵退守圣林，两族结怨千年。" },
    { 年份:"第3纪元 · 77年", 纪元:"混沌纪元", 类型:"战争", 事件概述:"大陆争霸战爆发，奥瑞利安以铁与麦逐一吞并诸邦，确立霸权。" },
    { 年份:"第3纪元 · 198年", 纪元:"混沌纪元", 类型:"灾难", 事件概述:"大断电——旧能源体系崩溃，诸邦在黑暗中自相残杀，晨曦诸邦于废墟缔结《曦光盟约》。" },
    { 年份:"第3纪元 · 251年", 纪元:"混沌纪元", 类型:"文明", 事件概述:"晨曦联邦立国，以理性与协商重建秩序，混沌纪元落幕。" },
    { 年份:"第4纪元 · 元年", 纪元:"曙光纪元", 类型:"纪元", 事件概述:"聚变之火点燃，能源自此近乎无穷，文明集体仰望星空，曙光纪元开启。" },
    { 年份:"第4纪元 · 31年", 纪元:"曙光纪元", 类型:"技术", 事件概述:"揽星计划启动，『望舒』轨道站奠基，星链星座开始铺设。" },
    { 年份:"第4纪元 · 88年", 纪元:"曙光纪元", 类型:"技术", 事件概述:"星链星座成网，环盖亚卫星之壳点亮，全球通讯再无死角。" },
    { 年份:"第4纪元 · 96年", 纪元:"曙光纪元", 类型:"暗流", 事件概述:"奥瑞利安秘密启动发射台工程，收买联邦叛逃工程师，登天野望初露。" },
    { 年份:"第4纪元 · 121年", 纪元:"曙光纪元", 类型:"超凡", 事件概述:"鲛人深潜祭祀在马里亚纳海渊深处首次听见深渊『低语』，潮母下令封锁消息。" }
  ];

  /* ---------- 门槛科技（文明跃迁关卡） ---------- */
  const thresholds = [
    { lv:"0→1", name:"持久改造", 能力:"对环境施加持久、可累积、跨代传承的改造",
      代价:"定居带来领土，领土带来第一场战争；文字制造了知识垄断者与无知者的分化。",
      status:{ dawn:"crossed", aurel:"crossed", sylva:"crossed", bronze:"crossed", abyss:"crossed" } },
    { lv:"1→2", name:"能源解放", 能力:"掌握能量密度远超生物化学的能源并工程化",
      代价:"能毁城的能量也能毁掉自己；这是第一道『文明可能自杀』的门槛。",
      status:{ dawn:"crossed", aurel:"stuck", sylva:"stuck", bronze:"stuck", abyss:"stuck" } },
    { lv:"2→3", name:"光速壁垒", 能力:"绕过、突破或无视光速限制，实现实用化的跨恒星系航行",
      代价:"最多文明死在上面——超光速是对时空结构做手术，失败即撕出永久空间裂缝。",
      status:{ dawn:"stuck", aurel:"locked", sylva:"locked", bronze:"locked", abyss:"locked" } },
    { lv:"3→4", name:"空间锚定", 能力:"创建持久稳定的人工空间通道，使跨星系旅行成为通勤",
      代价:"虫洞是双向的——你能过去，敌人也能过来，每一个虫洞都是可被入侵的门。",
      status:{ dawn:"locked", aurel:"locked", sylva:"locked", bronze:"locked", abyss:"locked" } },
    { lv:"4→5", name:"恒星级汲取", 能力:"直接利用一颗恒星的全部或大部分能量输出",
      代价:"控制恒星产出等于控制恒星系的生死，汲取阵管理权成为最高级政治问题。",
      status:{ dawn:"locked", aurel:"locked", sylva:"locked", bronze:"locked", abyss:"locked" } },
    { lv:"5→6", name:"恒星操纵", 能力:"主动干预恒星内部过程，改变其寿命、光谱乃至生死",
      代价:"操纵失败可能触发超新星爆发或坍缩为黑洞，影响范围数十光年。",
      status:{ dawn:"locked", aurel:"locked", sylva:"locked", bronze:"locked", abyss:"locked" } },
    { lv:"6→7", name:"法则干涉", 能力:"直接操控维度结构与物理常数，局部改写宇宙出厂设置",
      代价:"在有生命的区域改写常数，等同于对该区域所有生命判处死刑。",
      status:{ dawn:"locked", aurel:"locked", sylva:"locked", bronze:"locked", abyss:"locked" } },
    { lv:"7→8", name:"因果超越", 能力:"直接操控因果与时间，编辑事件之间的因果链条",
      代价:"最危险的力量——改写一个事件可能令整个因果网络级联崩溃。",
      status:{ dawn:"locked", aurel:"locked", sylva:"locked", bronze:"locked", abyss:"locked" } },
    { lv:"8→9", name:"？", 能力:"未知。没有可靠记录。",
      代价:"一种假说：代价就是『不再是文明』。",
      status:{ dawn:"locked", aurel:"locked", sylva:"locked", bronze:"locked", abyss:"locked" } }
  ];

  /* ---------- 太空天体（曦阳星系） ----------
     flags.landable 决定可否进入星球地图；flags.isPlayerHome 仅叙事/默认相机。
     home 字段保留兼容（= isPlayerHome），新代码请读 flags。 */
  const spaceBodies = [
    { id:"xiyang", name:"曦阳", type:"恒星", subtype:"黄矮星", color:"#ffd9a0", radius:26,
      orbit:null, flags:{ landable:false, surveyed:'none' },
      desc:"星系的心脏，主序黄矮星，灵能随其耀斑周期涨落。" },
    { id:"yanhe", name:"炎核星", type:"岩质行星", subtype:"干旱型", color:"#c98452", radius:5,
      orbit:{ a:150, e:0.06, inc:2, period:88, phase:0.5 },
      flags:{ landable:true, surveyed:'remote', colonized:false }, surfaceId:'yanhe:surface', surfaceSeed:20260721,
      climateProfile:{ hydrosphere:0.08, meanTemp:'hot', energyAffinity:0.15 },
      desc:"距曦阳最近的岩质行星，表面被炙烤成玻璃状的荒原。" },
    { id:"gaiya", name:"盖亚", type:"类地行星", subtype:"宜居", color:"#4fa8e0", radius:8,
      home:true, /* 兼容旧入口 */
      orbit:{ a:230, e:0.03, inc:0, period:365, phase:2.1 },
      flags:{ landable:true, isPlayerHome:true, surveyed:'surface', colonized:true },
      surfaceId:'gaiya:surface', surfaceSeed:20260723,
      climateProfile:{ hydrosphere:0.37, meanTemp:'temperate', energyAffinity:0.55 },
      desc:"文明的摇篮，蔚蓝的母星。星链之壳正环绕着它缓缓旋转。" },
    { id:"yinhui", name:"银辉", type:"卫星", subtype:"盖亚之月", color:"#c8ccd8", radius:3, parent:"gaiya",
      orbit:{ a:24, e:0.05, inc:5, period:27, phase:1.2 },
      flags:{ landable:true, surveyed:'orbital', colonized:false }, surfaceId:'yinhui:surface', surfaceSeed:20260724,
      climateProfile:{ hydrosphere:0.02, meanTemp:'cold', energyAffinity:0.08 },
      desc:"盖亚唯一的天然卫星，联邦计划在此建立首座永久前哨。" },
    { id:"cangqiong", name:"苍穹星", type:"气态巨星", subtype:"风暴型", color:"#d8a86a", radius:16,
      orbit:{ a:520, e:0.08, inc:1.3, period:4300, phase:4.0 }, ring:true,
      flags:{ landable:false, surveyed:'remote' },
      desc:"巨大的气态巨星，其永恒的猩红风暴之眼已凝视星系数千年。" },
    { id:"shuanghuan", name:"霜环星", type:"冰巨星", subtype:"环带型", color:"#8fd0e8", radius:11,
      orbit:{ a:820, e:0.05, inc:3.1, period:11000, phase:5.3 }, ring:true,
      flags:{ landable:false, surveyed:'remote' },
      desc:"苍白的冰巨星，一道纤薄的冰晶环带是它唯一的装饰。" },
    { id:"youxing", name:"幽星", type:"矮行星", subtype:"边陲", color:"#8a90a8", radius:2.6,
      orbit:{ a:1120, e:0.16, inc:9, period:26000, phase:0.9 },
      flags:{ landable:true, surveyed:'remote', colonized:false }, surfaceId:'youxing:surface', surfaceSeed:20260720,
      climateProfile:{ hydrosphere:0.05, meanTemp:'frigid', energyAffinity:0.04 },
      desc:"星系边陲的矮行星，孤寂地游荡在灵能微弱的黑暗之中。" },
    { id:"xiaoxingdai", name:"碎星带", type:"小行星带", subtype:"资源带", color:"#9aa2b8", radius:0,
      orbit:{ a:370, e:0.0, inc:1.6, period:2100, phase:0 },
      flags:{ landable:false, surveyed:'remote' },
      desc:"介于盖亚与苍穹星之间的小行星带，蕴藏着丰富的稀有矿藏。" },
    { id:"wangshu", name:"望舒轨道站", type:"空间站", subtype:"联邦前哨", color:"#6fe0f0", radius:2.2, parent:"gaiya",
      orbit:{ a:13.5, e:0.0, inc:28, period:1.6, phase:0 },
      flags:{ landable:false, surveyed:'surface' },
      desc:"晨曦联邦的轨道之心，揽星计划的神经中枢，星链星座自此处调度。" },
    { id:"shenyuanzhitong", name:"深渊之瞳", type:"黑洞", subtype:"史瓦西", color:"#000000", radius:7,
      orbit:{ a:1500, e:0.0, inc:-14, period:60000, phase:2.6 },
      flags:{ landable:false, surveyed:'remote' },
      desc:"星系边缘的流浪黑洞，一颗死去的恒星留下的凝视。没有人敢直视它太久。" }
  ];

  /* ---------- 文明关系 ---------- */
  const relations = [
    { a:"dawn", b:"aurel", state:"冷战对峙", reason:"轨道与陆权的根本对立，技术封锁与暗中追赶。" },
    { a:"aurel", b:"sylva", state:"旧怨未消", reason:"焚林之劫的千年积怨，互不信任。" },
    { a:"bronze", b:"aurel", state:"匠艺贸易", reason:"符文火炮换粮食稀土，各取所需。" },
    { a:"bronze", b:"dawn", state:"谨慎往来", reason:"矮人向联邦出口精金，但不愿卷入陆轨之争。" },
    { a:"abyss", b:"all", state:"神秘隔绝", reason:"深海文明自成一统，陆上对其知之甚少。" },
    { a:"sylva", b:"dawn", state:"警惕观望", reason:"精灵警惕联邦脱离大地的力量，却无力阻止。" }
  ];

  /* ---------- 遗留问题 / 暗线 ---------- */
  const legacies = [
    { text:"深渊的『低语』中反复出现『收割』一词，其含义无人知晓", when:"灵能潮汐下一次涨落之时", level:"critical" },
    { text:"联邦对航天技术的封锁，正将奥瑞利安推向孤注一掷的边缘", when:"帝国发射台落成之日", level:"warn" },
    { text:"苏砚的曲速理论若被证实，将同时点亮希望与战火", when:"亚光速引擎点火试车之后", level:"warn" },
    { text:"精灵的灵能根脉正在缓慢枯萎，世界树的衰老无人声张", when:"未来百年之内", level:"info" }
  ];

  /* ---------- 纪元因果 ---------- */
  const eraCausal = {
    承接:"混沌纪元留下了统一的大陆霸权与重建的联邦秩序，以及大断电留下的对能源的集体恐惧。",
    遗留:"曙光纪元或将留下两道悬而未决的命题——光速壁垒能否被推开，以及深渊究竟在低语什么。"
  };

  /* ---------- Agent 决策推演（多智能体联机核心） ---------- */
  const deduction = {
    lenses: ["政治", "军事", "经济", "科技", "思潮", "个人"],
    rounds: 4,
    pendingDecisions: [
      { civ:"dawn", leader:"林深", decision:"否决苏砚的曲速引擎提前点火申请，要求再验证三年", urgency:"高", stance:"稳健" },
      { civ:"aurel", leader:"萧玦", decision:"密令裴隐以灵能窥探联邦发射场，加速发射台工程", urgency:"高", stance:"激进" },
      { civ:"sylva", leader:"伊瑟兰", decision:"派遣德鲁伊使者出访铜须，探寻灵能根脉枯萎的解救之法", urgency:"中", stance:"守成" },
      { civ:"abyss", leader:"涅芮", decision:"增派深潜祭祀下潜至马里亚纳海渊最深处，执意听清『低语』", urgency:"高", stance:"冒险" },
      { civ:"bronze", leader:"巴尔刚", decision:"拒绝向奥瑞利安出售灵能锻造的核心技艺，守住底线", urgency:"低", stance:"中立" }
    ],
    log: [
      { round: 3, year: "第4纪元 · 121年", summary:"鲛人祭祀于海渊最深处听清『低语』片段——『收割』。涅芮下令封锁消息，深渊眷族暗中进入战备。",
        lenses: { 政治:"深渊封闭加剧", 军事:"深海力量暗中动员", 经济:"灵能珍珠减产", 科技:"深渊灵视突破", 思潮:"深渊归一主义升温", 个人:"涅芮愈发孤僻" } },
      { round: 2, year: "第4纪元 · 118年", summary:"奥瑞利安叛逃工程师身份暴露，晨曦联邦肃清内鬼，两国关系降至冰点。萧玦转而重金求助铜须。",
        lenses: { 政治:"陆轨对立激化", 军事:"帝国扩军", 经济:"黑市技术价涨", 科技:"图纸部分外流", 思潮:"帝国反星空情绪", 个人:"萧玦多疑加剧" } },
      { round: 1, year: "第4纪元 · 110年", summary:"苏砚完成曲率气泡理论雏形，星枢院以『风险未明』为由暂缓点火，联邦内部激进派与稳健派裂痕初现。",
        lenses: { 政治:"院内分歧公开", 军事:"江寒加强轨道戒备", 经济:"天工署预算倾斜", 科技:"曲速理论问世", 思潮:"星空信仰分化", 个人:"苏砚与林深生隙" } }
    ]
  };

  /* ---------- 纪元史 ---------- */
  const eras = [
    { name:"奇迹纪元", years:"持续 238 年", desc:"涌现奇迹的时代，非凡的创造力不断刷新想象的边界。" },
    { name:"皓月纪元", years:"持续 139 年", desc:"沐浴清辉的时代，澄澈的理性映照着温柔的守望。" },
    { name:"混沌纪元", years:"持续 251 年", desc:"血腥与死亡的时代，战争与毁灭是每日的主题。" },
    { name:"曙光纪元", years:"进行中 · 已 1247 年", desc:"超光速壁垒将破，万邦仰望星空的时代。", current:true }
  ];

  /* ---------- 共享目录（多星球表面复用） ---------- */
  const terrainCatalog = {
    ice:{ name:'冰原', color:'#e6eef6', elevation:'冰盖' }, tundra:{ name:'冻土', color:'#a8b294', elevation:'低地' },
    desert:{ name:'沙漠', color:'#dcc388', elevation:'盆地' }, plains:{ name:'平原', color:'#86ab6b', elevation:'低地' },
    forest:{ name:'森林', color:'#4f8458', elevation:'丘陵' }, hills:{ name:'丘陵', color:'#9a9a72', elevation:'高地' },
    mountain:{ name:'山脉', color:'#8d929c', elevation:'山地' }, coast:{ name:'海岸', color:'#2f6d88', elevation:'海平面' }, ocean:{ name:'海洋', color:'#14304a', elevation:'深海' }
  };
  const resourceCatalog = {
    food:{ name:'粮食', color:'#d8b76a', unit:'储量', icon:'wheat' }, biomass:{ name:'生物质', color:'#6fd08c', unit:'储量', icon:'tree' },
    materials:{ name:'石材建材', color:'#a7a09a', unit:'储量', icon:'grid' }, metals:{ name:'金属', color:'#d97b4f', unit:'储量', icon:'gem' },
    rareMinerals:{ name:'稀有矿物', color:'#8b7cf6', unit:'储量', icon:'sparkle' }, fuel:{ name:'燃料', color:'#e8a15c', unit:'储量', icon:'flask' },
    energy:{ name:'能源', color:'#5fd6e6', unit:'能量', icon:'bolt' }, essence:{ name:'灵质', color:'#b880e8', unit:'灵质', icon:'pulses' }
  };
  const buildingCatalog = {
    granary:{ name:'粮仓群', icon:'grid', outputs:{ food:4 }, capacity:{ food:90 } },
    forge:{ name:'符文锻炉', icon:'gem', outputs:{ metals:4, materials:1 }, capacity:{ metals:60 } },
    grove:{ name:'根脉庭园', icon:'tree', outputs:{ biomass:3, essence:2 } },
    port:{ name:'深水港', icon:'ship', outputs:{ food:1, fuel:1 }, capacity:{ fuel:50 } },
    extractor:{ name:'深层采掘站', icon:'flask', outputs:{ rareMinerals:3, fuel:2 } },
    reactor:{ name:'聚变反应堆', icon:'bolt', outputs:{ energy:6 }, capacity:{ energy:120 } }
  };

  /* ---------- 战略地图基线（盖亚；兼容 GE.data.strategicMap 旧引用） ---------- */
  const strategicMap = {
    schemaVersion: 1,
    id: 'gaiya:surface',
    bodyId: 'gaiya',
    topology: { kind: 'icosahedron-dual', frequency: 64, seed: 20260723, planetRadiusKm: 6371, nominalTileWidthKm: 120 },
    climateProfile: { hydrosphere: 0.37, meanTemp: 'temperate', energyAffinity: 0.55 },
    regions: [
      { id:'tian-shu-coast', name:'天枢海岸', color:'#4fd2ff', lat:18, lon:40, radius:30, description:'东部暖流海岸与联邦城邦带。' },
      { id:'jin-hui-plain', name:'金辉平原', color:'#e6a948', lat:4, lon:-10, radius:34, description:'河网密布、铁与麦丰沛的中央平原。' },
      { id:'cui-guan-forest', name:'翠冠圣林', color:'#6fd08c', lat:-32, lon:130, radius:36, description:'世界树根脉覆盖的古老林海。' },
      { id:'long-ji-range', name:'龙脊山脉', color:'#d97b4f', lat:44, lon:-120, radius:30, description:'地火、矿脉与矮人锻炉构成的高山地带。' },
      { id:'chao-ge-abyss', name:'潮歌深渊', color:'#7f8cf0', lat:-58, lon:-60, radius:32, description:'深海裂谷与鲛人渊城所在的永夜海域。' },
      { id:'bei-jing-tundra', name:'北境冻原', color:'#b6c8de', lat:72, lon:15, radius:38, description:'冰封苔原、极光与古老遗迹交织的北境。' },
      { id:'chi-sha-basin', name:'赤沙盆地', color:'#d68b52', lat:-12, lon:80, radius:28, description:'高温干旱的红砂盆地，蕴藏燃料与灵晶。' },
      { id:'xi-yang-isles', name:'西洋群岛', color:'#5fa6c4', lat:12, lon:-150, radius:30, description:'火山岛弧与海上贸易航道。' }
    ],
    terrainCatalog, resourceCatalog, buildingCatalog,
    capitalSeeds: { dawn:{ lat:18, lon:40 }, aurel:{ lat:4, lon:-10 }, sylva:{ lat:-32, lon:130 }, bronze:{ lat:44, lon:-120 }, abyss:{ lat:-58, lon:-60 } },
    claimRadius: { dawn:16, aurel:21, sylva:15, bronze:12, abyss:18 }
  };

  /* ---------- 各 landable 天体的表面定义（SurfaceRegistry 源） ---------- */
  const bodySurfaces = {
    'gaiya:surface': strategicMap,
    'yinhui:surface': {
      schemaVersion: 1,
      id: 'yinhui:surface',
      bodyId: 'yinhui',
      topology: { kind: 'icosahedron-dual', frequency: 32, seed: 20260724, planetRadiusKm: 1737, nominalTileWidthKm: 80 },
      climateProfile: { hydrosphere: 0.02, meanTemp: 'cold', energyAffinity: 0.08 },
      regions: [
        { id:'yue-hai', name:'静海盆地', color:'#c8ccd8', lat:10, lon:20, radius:40, description:'平坦的玄武岩海，联邦前哨候选址。' },
        { id:'yue-ji', name:'银冕高地', color:'#a8b0c0', lat:-25, lon:-90, radius:38, description:'撞击坑密布的古老高地。' },
        { id:'yue-an', name:'永夜极冠', color:'#e8eef6', lat:78, lon:0, radius:42, description:'永久阴影坑，可能藏有水冰。' },
        { id:'yue-yao', name:'曜斑谷地', color:'#9aa8b8', lat:5, lon:140, radius:36, description:'放射状裂谷与稀有矿物露头。' }
      ],
      terrainCatalog, resourceCatalog, buildingCatalog,
      // 无人殖民：无首都种子 → 全无主；勘察后可落前哨
      capitalSeeds: {},
      claimRadius: {}
    },
    'yanhe:surface': {
      schemaVersion: 1,
      id: 'yanhe:surface',
      bodyId: 'yanhe',
      topology: { kind: 'icosahedron-dual', frequency: 32, seed: 20260721, planetRadiusKm: 4880, nominalTileWidthKm: 100 },
      climateProfile: { hydrosphere: 0.08, meanTemp: 'hot', energyAffinity: 0.15 },
      regions: [
        { id:'yan-glass', name:'琉璃荒原', color:'#c98452', lat:0, lon:0, radius:45, description:'被曦阳烤熔又重新固化的玻璃荒漠。' },
        { id:'yan-rift', name:'焦痕裂谷', color:'#a85a32', lat:30, lon:100, radius:40, description:'深裂谷暴露出下层金属矿脉。' },
        { id:'yan-shadow', name:'永影盆地', color:'#8a6048', lat:-40, lon:-120, radius:38, description:'极地永夜区，勉强可作庇护所。' },
        { id:'yan-ridge', name:'熔脊山脉', color:'#d4a070', lat:55, lon:-40, radius:35, description:'火山脊与硫磺喷口。' }
      ],
      terrainCatalog, resourceCatalog, buildingCatalog,
      capitalSeeds: {},
      claimRadius: {}
    },
    'youxing:surface': {
      schemaVersion: 1,
      id: 'youxing:surface',
      bodyId: 'youxing',
      topology: { kind: 'icosahedron-dual', frequency: 16, seed: 20260720, planetRadiusKm: 1180, nominalTileWidthKm: 90 },
      climateProfile: { hydrosphere: 0.05, meanTemp: 'frigid', energyAffinity: 0.04 },
      regions: [
        { id:'you-core', name:'幽核盆地', color:'#8a90a8', lat:5, lon:30, radius:50, description:'矮行星主盆地，灵能微弱。' },
        { id:'you-rim', name:'边尘环带', color:'#6a7088', lat:-50, lon:-80, radius:48, description:'稀疏的尘冰沉积带。' }
      ],
      terrainCatalog, resourceCatalog, buildingCatalog,
      capitalSeeds: {},
      claimRadius: {}
    }
  };

  return { world, civLevels, energyScale, civs, races, transcendent, favorites,
           chronicle, thresholds, spaceBodies, relations, legacies, eraCausal, deduction, eras,
           strategicMap, bodySurfaces, terrainCatalog, resourceCatalog, buildingCatalog };
})();
