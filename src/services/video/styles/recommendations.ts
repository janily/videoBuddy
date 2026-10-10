import {listStyles} from './registry';

/** What each style is good at, in words a director (and a user) can match against a brief.
 * `goodFor` is shown to the director model; `keywords` drive the deterministic UI suggestion. */
export interface StyleFit{goodFor:string;mood:string;keywords:string[];swatch:[string,string,string]}

export const styleFits:Record<string,StyleFit>={
 'art-deco':{swatch:["#101e1c","#e7c884","#567264"],goodFor:'高端品牌、酒店餐厅、周年庆典、复古发布会、颁奖',mood:'华丽、隆重、复古',keywords:['高端','奢华','酒店','庆典','周年','颁奖','晚宴','复古','品牌','开业','珠宝','香水']},
 'ascii-crt':{swatch:["#08130d","#84e08b","#315f3b"],goodFor:'程序员话题、黑客/安全、开源项目、命令行工具、复古电脑',mood:'极客、冷静、怀旧',keywords:['程序','代码','开发','黑客','安全','终端','命令行','开源','极客','服务器','linux','编程','api']},
 'backrooms':{swatch:["#1c1b13","#c4bb7b","#69664d"],goodFor:'悬疑短片、都市怪谈、密室解谜、恐怖氛围预告',mood:'诡异、压抑、悬疑',keywords:['悬疑','恐怖','怪谈','诡异','惊悚','密室','解谜','灵异','神秘']},
 'blueprint':{swatch:["#123d68","#d7e9ec","#75adcc"],goodFor:'工程原理、产品结构拆解、建筑设计、机械/硬件介绍',mood:'精确、理性、专业',keywords:['工程','结构','原理','机械','建筑','设计图','硬件','图纸','零件','制造','发明','拆解']},
 'brick-toy':{swatch:["#e5c38d","#bd4939","#5e9490"],goodFor:'儿童教育、亲子内容、玩具与积木、轻松的小故事、团队建设',mood:'童趣、明快、手作感',keywords:['积木','玩具','儿童','亲子','搭建','拼装','乐高','幼儿园','手工','孩子']},
 'cel-anime-80s':{swatch:["#242847","#eaa3af","#70bfda"],goodFor:'热血故事、青春怀旧、机甲/科幻冒险、音乐MV',mood:'热血、怀旧、霓虹',keywords:['动漫','热血','青春','机甲','冒险','怀旧','80年代','霓虹','mv','少年','英雄']},
 'crayon-book':{swatch:["#f4efe3","#345f89","#e8a84c"],goodFor:'儿童故事、睡前故事、亲子教育、温柔的小品、公益宣传',mood:'温柔、童趣、手绘',keywords:['睡前','童话','绘本','儿童','孩子','小猫','小狗','动物','亲子','幼儿','故事','宝宝','温柔']},
 'dark-keynote':{swatch:["#0e111b","#e9eefc","#a393fa"],goodFor:'科技产品发布、软件/App介绍、SaaS功能演示、创业路演',mood:'高级、克制、科技感',keywords:['发布','发布会','产品','app','软件','saas','科技','功能','新版本','创业','路演','ai','智能']},
 'dataviz':{swatch:["#f5f0e5","#244d7b","#d04f40"],goodFor:'数据报告、年度总结、调研结果、趋势分析、财报解读',mood:'清晰、可信、理性',keywords:['数据','统计','报告','趋势','增长','年度','总结','调研','财报','占比','图表','百分比','分析']},
 'engraving':{swatch:["#eee5d2","#3d3227","#9f7550"],goodFor:'历史人物、博物学/科学史、经典文学、学术讲座',mood:'古典、严谨、学术',keywords:['历史','古代','科学史','博物','植物','动物图鉴','人物传记','经典','学术','百科','文献']},
 'game-show':{swatch:["#ffe164","#24223d","#e85c85"],goodFor:'知识竞答、活动预热、节日互动、抽奖与综艺式宣传',mood:'热闹、欢快、节奏感',keywords:['竞答','问答','抽奖','综艺','活动','比赛','游戏','节日','互动','挑战','闯关']},
 'glass-product':{swatch:["#090f1b","#d8f4fd","#7eb6dd"],goodFor:'硬件/消费电子、美妆与香水、高端产品展示、材质卖点',mood:'精致、通透、高级',keywords:['产品','手机','耳机','手表','硬件','香水','美妆','护肤','瓶','玻璃','材质','设计感']},
 'halftone-dossier':{swatch:["#e9debf","#252624","#b84736"],goodFor:'真相揭秘、案件复盘、品牌故事、调查报道、复古海报感宣传',mood:'复古、戏剧化、报刊感',keywords:['揭秘','案件','调查','真相','档案','复盘','新闻','报道','内幕','历史事件']},
 'hd-2d':{swatch:["#172d38","#f8d798","#5f9787"],goodFor:'游戏宣传、奇幻冒险故事、城镇/地图介绍、像素怀旧',mood:'奇幻、精致、怀旧',keywords:['游戏','奇幻','冒险','rpg','像素','城镇','地图','勇者','魔法','王国']},
 'hologram-hud':{swatch:["#06171f","#66e9e4","#247986"],goodFor:'科幻概念、智能硬件参数、汽车/无人机、未来科技展示',mood:'未来、冷峻、精密',keywords:['科幻','未来','参数','规格','汽车','无人机','机器人','芯片','全息','智能','航天','黑科技']},
 'impasto':{swatch:["#eac367","#264e67","#c45635"],goodFor:'艺术展览、情感叙事、名人故事、季节与风景',mood:'浓烈、艺术、有温度',keywords:['艺术','油画','画展','展览','风景','情感','季节','名人','梵高','印象派']},
 'ink-wash':{swatch:["#f0eadb","#222c28","#b74738"],goodFor:'国风文化、诗词、茶道、中医养生、山水旅游、传统节气',mood:'空灵、写意、东方',keywords:['国风','水墨','诗词','古诗','茶','中医','山水','书法','节气','禅','传统文化','武侠','中国风']},
 'iso-infographic':{swatch:["#edf2ec","#34594c","#e1ac53"],goodFor:'流程讲解、系统架构、城市/工厂运作、商业模式、供应链',mood:'清晰、有序、全局视角',keywords:['流程','系统','架构','运作','原理','供应链','物流','工厂','城市','模式','步骤','机制','信息图']},
 'living-screencast':{swatch:["#e4edf4","#253e52","#689ca0"],goodFor:'软件操作教程、App上手指南、网站功能演示、SaaS引导',mood:'亲切、直观、实用',keywords:['教程','操作','演示','上手','界面','网站','app','使用方法','功能介绍','录屏','新手']},
 'lowpoly-island':{swatch:["#dceee8","#447d73","#d88c53"],goodFor:'旅游目的地、城市/园区介绍、游戏化说明、环保主题',mood:'轻快、可爱、立体',keywords:['旅游','岛','园区','小镇','城市','环保','生态','地图','度假','露营']},
 'microgame':{swatch:["#f34664","#25284e","#fde368"],goodFor:'快节奏挑战、短视频互动、多要点速览、年轻人活动',mood:'疯狂、好玩、快节奏',keywords:['挑战','快闪','小游戏','速览','好玩','年轻','脑洞','整活','派对']},
 'midcentury-toon':{swatch:["#e6cfa4","#354747","#c26448"],goodFor:'生活小知识、安全/礼仪教育、职场培训、复古广告',mood:'轻松、复古、亲切',keywords:['小知识','科普','安全','礼仪','培训','入职','生活','习惯','复古广告','家居']},
 'one-line':{swatch:["#f8f5ed","#313d39","#bb785a"],goodFor:'品牌理念、极简故事、情绪短片、婚礼与纪念',mood:'极简、优雅、流动',keywords:['极简','理念','品牌','情绪','爱情','婚礼','纪念','连接','成长','一生']},
 'paper-lantern':{swatch:["#172f37","#f5d197","#779e99"],goodFor:'传统节日（中秋、元宵、春节）、民俗故事、温暖的夜景故事',mood:'温暖、梦幻、东方',keywords:['中秋','元宵','灯','春节','民俗','节日','月亮','团圆','夜晚','祝福']},
 'paper-popup':{swatch:["#d9c4aa","#396856","#d79a61"],goodFor:'品牌故事、儿童科普、旅行回忆、产品诞生历程',mood:'惊喜、手作、温馨',keywords:['立体书','翻页','品牌故事','旅行','回忆','手作','历程','惊喜','礼物']},
 'papercut-red':{swatch:["#f5e9d2","#b83532","#d96e4a"],goodFor:'春节、婚庆、喜事、民间吉祥文化、非遗剪纸',mood:'喜庆、吉祥、传统',keywords:['春节','新年','过年','婚礼','喜事','福','剪纸','吉祥','非遗','年画','拜年']},
 'pictogram-motion':{swatch:["#c7ddd9","#214f4b","#71aaa0"],goodFor:'体育赛事、运动项目介绍、规则说明、活动日程',mood:'动感、清晰、节拍感',keywords:['体育','运动','比赛','奥运','马拉松','健身','规则','赛事','日程','项目']},
 'pixel-rpg':{swatch:["#202540","#f4d9a3","#76ab86"],goodFor:'游戏风宣传、成长/升级故事、任务式教程、团队招募',mood:'怀旧、有趣、闯关感',keywords:['像素','游戏','升级','任务','闯关','招募','成长','打怪','存档','复古游戏']},
 'risograph':{swatch:["#f2e9d5","#d85c54","#3778a0"],goodFor:'独立品牌、文创与市集、活动海报、音乐节、设计工作室',mood:'文艺、潮流、手作印刷',keywords:['文创','市集','独立','设计','工作室','音乐节','海报','潮流','杂志','zine']},
 'rubber-hose':{swatch:["#dfddce","#252b2a","#8a8b81"],goodFor:'幽默广告、复古喜剧、轻松的品牌吉祥物故事',mood:'滑稽、欢乐、复古',keywords:['幽默','搞笑','喜剧','吉祥物','复古卡通','爵士','欢乐','卡通']},
 'scifi-toon':{swatch:["#56655d","#f1df83","#83bd82"],goodFor:'科幻脑洞、搞笑科普、团队日常、平行世界设定',mood:'荒诞、幽默、科幻',keywords:['科幻','外星','平行世界','脑洞','搞笑','传送门','宇宙','荒诞']},
 'shadow-puppet':{swatch:["#e8c98e","#5c3321","#b5582d"],goodFor:'民间故事、戏曲、历史典故、非遗文化',mood:'古朴、神秘、戏剧性',keywords:['皮影','戏曲','民间故事','典故','神话','非遗','传说','西游']},
 'silent-film':{swatch:["#1e211f","#d7d7c8","#777d73"],goodFor:'老故事新讲、品牌百年历史、怀旧喜剧、经典桥段致敬',mood:'怀旧、幽默、黑白',keywords:['默片','老电影','百年','历史','怀旧','黑白','卓别林','经典','复古']},
 'silkscreen-poster':{swatch:["#e9d9ae","#263f47","#d16c42"],goodFor:'旅游目的地宣传、城市推广、户外活动、展会海报',mood:'鲜明、大胆、海报感',keywords:['旅游','城市','目的地','景点','户外','徒步','展会','海报','国家公园','出行']},
 'spy-titles':{swatch:["#eccc71","#202a2e","#b3503b"],goodFor:'活动开场、片头、悬念预告、品牌发布倒计时',mood:'酷、悬念、节奏强',keywords:['片头','开场','预告','间谍','悬念','倒计时','特工','神秘嘉宾']},
 'stained-glass':{swatch:["#252e39","#dc9b58","#497eaa"],goodFor:'宗教与建筑文化、史诗故事、婚礼仪式、光影主题',mood:'庄重、神圣、绚丽',keywords:['教堂','建筑','史诗','神圣','仪式','光','彩窗','中世纪','信仰']},
 'swiss-motion':{swatch:["#f1efe7","#202b2a","#d85038"],goodFor:'企业介绍、设计说明、观点陈述、数据要点、招聘',mood:'专业、简洁、有力',keywords:['企业','公司','介绍','观点','宣言','设计','招聘','要点','演讲','专业','品牌形象']},
 'tilt-shift':{swatch:["#a6c4a6","#f3ead4","#bd7556"],goodFor:'城市风光、交通与生活节奏、旅游宣传、建筑工地进度',mood:'可爱、俯瞰、生活感',keywords:['城市','街道','交通','风光','俯瞰','航拍','微缩','生活节奏','车流']},
 'ukiyoe':{swatch:["#eadbb8","#25465a","#b75b41"],goodFor:'日本文化、海洋与自然、旅行、和风品牌',mood:'雅致、平面、东方',keywords:['日本','和风','浮世绘','海浪','富士','樱花','海洋','旅行','神奈川']},
 'urban-sketch':{swatch:["#f4ecdd","#514236","#9fae98"],goodFor:'城市漫步、旅行日记、咖啡店/小店介绍、建筑与街区',mood:'随性、文艺、生活感',keywords:['咖啡','咖啡店','小店','街区','旅行日记','速写','城市漫步','建筑','探店','书店','日常']},
 'watercolor':{swatch:["#f3eddf","#658d8b","#ba7758"],goodFor:'自然科普、植物与花艺、旅行手账、温柔的品牌故事',mood:'清新、柔和、有书卷气',keywords:['水彩','植物','花','自然','手账','清新','花艺','森林','鸟','季节']},
 'whiteboard':{swatch:["#f8faf5","#304b57","#d97859"],goodFor:'知识讲解、课程概念、商业分析、方法论、培训课件',mood:'清楚、循序渐进、讲课感',keywords:['讲解','知识','科普','课程','概念','方法','学习','培训','原理','教育','课件','为什么','怎么']},
 'woodcut':{swatch:["#e8dfc8","#252b25","#bc5943"],goodFor:'严肃议题、历史与社会、劳动/匠人故事、有力量感的宣言',mood:'厚重、有力、黑白对比',keywords:['匠人','劳动','社会','严肃','力量','版画','历史','宣言','农耕','工业']},
};

/** Director-facing catalog entry: enough to recommend, nothing the model could mistake for instructions. */
export function styleCatalogEntries(ids?:readonly string[]){
 return listStyles().filter(style=>!ids||ids.includes(style.id)).map(style=>({id:style.id,nameZh:style.nameZh,nameEn:style.nameEn,category:style.categoryZh,look:style.technicalReviewFocus,goodFor:styleFits[style.id]?.goodFor,mood:styleFits[style.id]?.mood}));
}

/** Deterministic suggestion from what the user has said so far. Ties keep catalog order. */
export function recommendStyles(text:string,limit=3,allowed?:readonly string[]){
 const haystack=text.toLocaleLowerCase();
 if(!haystack.trim())return [];
 return listStyles()
  .filter(style=>!allowed||allowed.includes(style.id))
  .map((style,index)=>({style,index,score:(styleFits[style.id]?.keywords||[]).reduce((sum,keyword)=>sum+(haystack.includes(keyword.toLocaleLowerCase())?keyword.length>1?2:1:0),0)}))
  .filter(item=>item.score>0)
  .sort((a,b)=>b.score-a.score||a.index-b.index)
  .slice(0,limit)
  .map(item=>item.style);
}

/** Search includes user-facing uses, mood and matching keywords. */
export function searchStyleFits(query:string){const q=query.trim().toLocaleLowerCase();return listStyles().filter(style=>[style.nameZh,style.nameEn,style.id,styleFits[style.id]?.goodFor,styleFits[style.id]?.mood,...(styleFits[style.id]?.keywords||[])].some(value=>value?.toLocaleLowerCase().includes(q)))}
