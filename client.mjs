// song-info/client.mjs — 歌曲资料 v2.0.0
// 播放页进度条右侧信息按钮 → 打开「歌曲资料」面板页签。
// 数据源（在模组管理设置中选择）：
//   默认「公开检索」：按顺序检索公开来源，命中后停止继续请求
//   「AI 检索」：把歌曲信息发给 OpenAI 兼容接口（DeepSeek 等），返回结构化资料
// 仅在面板打开时查询；成功结果按歌曲+歌手缓存。
const INFO_SVG =
  '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>';

const WIKI_ZH = "https://zh.wikipedia.org/w/api.php";
const WIKI_EN = "https://en.wikipedia.org/w/api.php";
const MB_API = "https://musicbrainz.org/ws/2/recording/?fmt=json&limit=3&query=";
const BAKE = "https://baike.baidu.com/item/";
const CACHE_KEY = "si-cache-v2";
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 仅成功结果缓存 30 天
const API_KEY_STORAGE = "si-api-key";
const CACHE_MAX_BYTES = 420 * 1024; // 为宿主 1 MB storage 留出余量

// 所有网络请求经同一队列串行发出，避免快速切歌造成并发请求洪峰。
let networkTail = Promise.resolve();
let lastNetworkStart = 0;
function limitedFetch(folium, url, options) {
  const run = networkTail.then(async () => {
    const wait = Math.max(0, 450 - (Date.now() - lastNetworkStart));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    lastNetworkStart = Date.now();
    return folium.net.fetch(url, options || {});
  });
  networkTail = run.catch(() => {});
  return run;
}

const enc = encodeURIComponent;
const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const unent = (s) =>
  String(s || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

// 常用繁体 → 简体 映射（公开检索模式无 AI 时的离线简繁转换，覆盖高频字）
const T2S = {
  "這": "这", "說": "说", "話": "话", "們": "们", "國": "国", "為": "为", "麼": "么", "個": "个",
  "時": "时", "間": "间", "裡": "里", "嗎": "吗", "沒": "没", "對": "对", "來": "来", "從": "从",
  "後": "后", "發": "发", "會": "会", "學": "学", "東": "东", "車": "车", "電": "电", "點": "点",
  "開": "开", "關": "关", "門": "门", "問": "问", "題": "题", "還": "还", "過": "过", "當": "当",
  "應": "应", "樣": "样", "現": "现", "讓": "让", "誰": "谁", "聽": "听", "樂": "乐", "華": "华",
  "風": "风", "雲": "云", "馬": "马", "魚": "鱼", "鳥": "鸟", "龍": "龙", "萬": "万", "與": "与",
  "於": "于", "並": "并", "兩": "两", "幾": "几", "體": "体", "戰": "战", "師": "师", "軍": "军",
  "產": "产", "業": "业", "實": "实", "寶": "宝", "寫": "写", "讀": "读", "記": "记", "認": "认",
  "識": "识", "謝": "谢", "請": "请", "講": "讲", "論": "论", "議": "议", "評": "评", "詞": "词",
  "詩": "诗", "語": "语", "譯": "译", "試": "试", "設": "设", "計": "计", "論": "论", "許": "许",
  "證": "证", "訴": "诉", "調": "调", "讓": "让", "訪": "访", "該": "该", "誰": "谁", "謂": "谓",
  "買": "买", "賣": "卖", "錢": "钱", "銀": "银", "鐵": "铁", "鋼": "钢", "銅": "铜", "鉛": "铅",
  "長": "长", "張": "张", "劉": "刘", "陳": "陈", "楊": "杨", "黃": "黄", "週": "周", "歲": "岁",
  "曆": "历", "曆": "历", "歷": "历", "舊": "旧", "新": "新", "變": "变", "愛": "爱", "懷": "怀",
  "戀": "恋", "情": "情", "感": "感", "願": "愿", "驚": "惊", "歡": "欢", "慶": "庆", "廣": "广",
  "廟": "庙", "鄉": "乡", "縣": "县", "鎮": "镇", "陽": "阳", "陰": "阴", "隊": "队", "險": "险",
  "驗": "验", "觀": "观", "視": "视", "覺": "觉", "觸": "触", "該": "该", "說": "说", "讀": "读",
  "課": "课", "語": "语", "習": "习", "練": "练", "劇": "剧", "戲": "戏", "臺": "台", "燈": "灯",
  "熱": "热", "煙": "烟", "燒": "烧", "畫": "画", "盡": "尽", "絕": "绝", "結": "结", "給": "给",
  "經": "经", "績": "绩", "繼": "继", "續": "续", "繩": "绳", "網": "网", "線": "线", "編": "编",
  "織": "织", "組": "组", "約": "约", "級": "级", "紀": "纪", "紅": "红", "綠": "绿", "紫": "紫",
  "藍": "蓝", "纖": "纤", "緻": "致", "純": "纯", "紙": "纸", "終": "终", "紹": "绍", "經": "经",
  "統": "统", "總": "总", "聯": "联", "聖": "圣", "聞": "闻", "職": "职", "聲": "声", "聽": "听",
  "臉": "脸", "腳": "脚", "腦": "脑", "腸": "肠", "髒": "脏", "讚": "赞", "謝": "谢", "邊": "边",
  "達": "达", "遠": "远", "還": "还", "進": "进", "遷": "迁", "遲": "迟", "選": "选", "郵": "邮",
  "醫": "医", "釀": "酿", "釋": "释", "錄": "录", "鎖": "锁", "錯": "错", "鎮": "镇", "鏡": "镜",
  "鐘": "钟", "鏈": "链", "錄": "录", "閉": "闭", "閃": "闪", "閣": "阁", "閱": "阅", "隻": "只",
  "雙": "双", "難": "难", "離": "离", "雜": "杂", "雙": "双", "雲": "云", "雷": "雷", "電": "电",
  "靈": "灵", "靜": "静", "響": "响", "頭": "头", "類": "类", "顯": "显", "館": "馆", "餅": "饼",
  "飲": "饮", "飯": "饭", "餃": "饺", "飽": "饱", "餘": "余", "餓": "饿", "驚": "惊", "鳥": "鸟",
  "鳴": "鸣", "麥": "麦", "麵": "面", "黃": "黄", "黑": "黑", "齊": "齐", "齒": "齿", "齡": "龄",
  "龍": "龙", "龜": "龟", "點": "点", "黨": "党", "內": "内", "兩": "两", "冊": "册", "刪": "删",
  "創": "创", "剛": "刚", "別": "别", "刪": "删", "劍": "剑", "勵": "励", "動": "动", "務": "务",
  "勝": "胜", "勞": "劳", "勢": "势", "區": "区", "協": "协", "單": "单", "參": "参", "葉": "叶",
  "藝": "艺", "蘇": "苏", "蘭": "兰", "處": "处", "號": "号", "雖": "虽", "師": "师", "帶": "带",
  "幫": "帮", "幹": "干", "府": "府", "庫": "库", "庭": "庭", "廢": "废", "廠": "厂", "彈": "弹",
  "強": "强", "歸": "归", "複": "复", "復": "复", "機": "机", "權": "权", "樓": "楼", "標": "标",
  "樣": "样", "樹": "树", "橋": "桥", "檢": "检", "槍": "枪", "槳": "桨", "樂": "乐", "樓": "楼",
  "標": "标", "權": "权", "欄": "栏", "欖": "榄", "歡": "欢", "殘": "残", "殺": "杀", "毀": "毁",
  "氣": "气", "氧": "氧", "氫": "氢", "遊": "游", "運": "运", "過": "过", "道": "道", "違": "违",
  "遲": "迟", "遷": "迁", "選": "选", "邏": "逻", "醫": "医", "鎮": "镇", "鏡": "镜", "鐘": "钟",
  "錯": "错", "鏈": "链", "錄": "录", "鐘": "钟", "閒": "闲", "間": "间", "陽": "阳", "陰": "阴",
  "隊": "队", "隨": "随", "雜": "杂", "難": "难", "電": "电", "雲": "云", "雷": "雷", "霧": "雾",
  "震": "震", "霍": "霍", "霜": "霜", "霞": "霞", "霸": "霸", "露": "露", "響": "响", "頁": "页",
  "頂": "顶", "項": "项", "順": "顺", "須": "须", "預": "预", "頒": "颁", "頓": "顿", "頗": "颇",
  "領": "领", "顆": "颗", "題": "题", "額": "额", "類": "类", "顯": "显", "風": "风", "颱": "台",
  "飛": "飞", "飲": "饮", "館": "馆", "餅": "饼", "餓": "饿", "驚": "惊", "骨": "骨", "體": "体",
  "髮": "发", "鬥": "斗", "鬧": "闹", "鰻": "鳗", "鳳": "凤", "鴻": "鸿", "鵬": "鹏", "麗": "丽",
  "麵": "面", "麻": "麻", "麼": "么", "黑": "黑", "齊": "齐", "齒": "齿", "齡": "龄", "龍": "龙",
  "龜": "龟", "點": "点", "黨": "党", "儂": "侬", "倫": "伦", "偉": "伟", "傳": "传", "傷": "伤",
  "傾": "倾", "僑": "侨", "價": "价", "儀": "仪", "億": "亿", "優": "优", "儲": "储", "兒": "儿",
  "兌": "兑", "內": "内", "兩": "两", "冊": "册", "刪": "删", "創": "创", "剛": "刚", "別": "别",
  "劍": "剑", "勵": "励", "動": "动", "務": "务", "勝": "胜", "勞": "劳", "勢": "势", "區": "区",
  "協": "协", "單": "单", "參": "参", "葉": "叶", "藝": "艺", "蘇": "苏", "蘭": "兰", "處": "处",
  "號": "号", "雖": "虽", "帶": "带", "幫": "帮", "幹": "干", "庫": "库", "廢": "废", "廠": "厂",
  "彈": "弹", "強": "强", "歸": "归", "複": "复", "復": "复", "機": "机", "權": "权", "樓": "楼",
  "標": "标", "樹": "树", "橋": "桥", "檢": "检", "槍": "枪", "樂": "乐", "欄": "栏", "欖": "榄",
  "殘": "残", "殺": "杀", "毀": "毁", "氣": "气", "氫": "氢", "遊": "游", "運": "运", "違": "违",
  "邏": "逻", "閒": "闲", "隨": "随", "霧": "雾", "頂": "顶", "項": "项", "順": "顺", "須": "须",
  "預": "预", "頒": "颁", "頓": "顿", "頗": "颇", "領": "领", "顆": "颗", "額": "额", "颱": "台",
  "飛": "飞", "髮": "发", "鬥": "斗", "鬧": "闹", "鳳": "凤", "鴻": "鸿", "鵬": "鹏", "麗": "丽",
  "麻": "麻",
};

// 繁体 → 简体（离线）
function tw2s(text) {
  let out = "";
  for (const ch of String(text || "")) out += T2S[ch] || ch;
  return out;
}

// 检测是否含繁体字（离线映射命中）
function hasTrad(text) {
  for (const ch of String(text || "")) if (T2S[ch]) return true;
  return false;
}

// 语言目标规范化：Folia 的 locale → 翻译目标语言码
function normTarget(locale) {
  const l = String(locale || "").toLowerCase();
  if (l.startsWith("zh")) return l.includes("tw") || l.includes("hant") ? "zh-TW" : "zh-CN";
  if (l.startsWith("en")) return "en";
  if (l.startsWith("ja")) return "ja";
  if (l.startsWith("ko")) return "ko";
  if (l.startsWith("id") || l.startsWith("in")) return "id";
  return l.slice(0, 2);
}

// 文本是否已是目标语言
function isTargetLang(text, target) {
  const t = String(text || "");
  const hasHan = /[\u4e00-\u9fff]/.test(t);
  const hasKana = /[\u3040-\u30ff]/.test(t);
  if (target === "en") return !hasHan && !hasKana;
  if (target === "ja") return hasKana && !hasHan;
  if (target === "ko") return /[\uac00-\ud7af]/.test(t) && !hasHan;
  if (target === "zh-TW") return hasHan && hasTrad(t) && !hasKana;
  if (target === "zh-CN") return hasHan && !hasTrad(t) && !hasKana && !/[A-Za-z]{3,}/.test(t);
  return !hasHan && !hasKana;
}

// 粗略检测源语言（日文假名优先，避免日文混合文本被误判为中文）
function detectSrc(text) {
  const t = String(text || "");
  const hasHan = /[\u4e00-\u9fff]/.test(t);
  const hasKana = /[\u3040-\u30ff]/.test(t);
  const hasEn = /[A-Za-z]{3,}/.test(t);
  if (hasKana) return "ja";
  if (hasHan) return hasTrad(t) ? "zh-TW" : "zh-CN";
  if (hasEn) return "en";
  return "zh-CN";
}

// 公开检索模式的翻译：目标语言跟随软件语言（跟随系统时即系统语言）；
// 繁体→简体 用内置映射离线转换（实际转换了才用）；其他组合调免费翻译接口（无需密钥）；
// 源与目标相同或接口报错时回退原文，绝不把接口错误文本当翻译显示。
async function translateForPublic(folium, text, target, keepOriginal, allowRemoteTranslation) {
  const orig = String(text || "").trim();
  if (!orig) return orig;
  const tgt = normTarget(target);
  if (isTargetLang(orig, tgt)) return orig;

  // zh-CN 目标 + 繁体中文源（无日文假名）→ 离线简繁转换（仅当确有转换）
  if (tgt === "zh-CN" && hasTrad(orig) && !/[\u3040-\u30ff]/.test(orig)) {
    const t2s = tw2s(orig);
    if (t2s !== orig) return keepOriginal ? orig + "\n（简体翻译：" + t2s + "）" : t2s;
  }

  // 其他语言翻译默认关闭；开启后最多发送 1800 字原文到 MyMemory。
  const src = detectSrc(orig);
  if (src === tgt || allowRemoteTranslation !== true) return orig;
  const pair = src + "|" + tgt;
  try {
    const r = await limitedFetch(folium,
      "https://api.mymemory.translated.net/get?q=" + enc(orig.slice(0, 1800)) + "&langpair=" + enc(pair),
      { timeoutMs: 12000 }
    );
    if (r.ok) {
      const j = r.json();
      const statusOk = j.responseStatus == null || Number(j.responseStatus) === 200;
      const tr = statusOk && j.responseData && j.responseData.translatedText;
      if (tr && String(tr).trim() && !/MYMEMORY WARNING|PLEASE SELECT|INVALID LANGUAGE/i.test(String(tr))) {
        return keepOriginal ? orig + "\n（翻译：" + unent(String(tr)) + "）" : unent(String(tr));
      }
    }
  } catch (e) {
    folium.log.warn("translate failed", String((e && e.message) || e));
  }

  // 失败回退：zh-CN 目标时至少离线转简体（确有转换），否则显示原文
  if (tgt === "zh-CN") {
    const t2s = tw2s(orig);
    if (t2s !== orig) return keepOriginal ? orig + "\n（简体翻译：" + t2s + "）" : t2s;
  }
  return orig;
}

// ---------- 数据源 ----------

// 主流 AI 服务商预设（OpenAI 兼容接口，选预设自动带默认模型；自定义需手动填地址/模型）。
// 定义在模块顶层，供顶层 aiLookup / publicLookup 使用。
const AI_PRESETS = {
  deepseek: { base: "https://api.deepseek.com", model: "deepseek-chat" },
  openai: { base: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  moonshot: { base: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  zhipu: { base: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
  qwen: { base: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  doubao: { base: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-1-5-pro-32k-250115" },
  hunyuan: { base: "https://api.hunyuan.cloud.tencent.com/v1", model: "hunyuan-lite" },
  ollama: { base: "http://localhost:11434/v1", model: "qwen2.5:7b" },
};
const resolveAI = (cfg) => {
  const p = cfg && cfg.aiPreset && AI_PRESETS[cfg.aiPreset];
  return {
    base: p ? p.base : String((cfg && cfg.aiBaseUrl) || ""),
    model: p ? p.model : String((cfg && cfg.aiModel) || ""),
  };
};

// 百度百科词条摘要（meta description）
async function baikeIntro(folium, title) {
  if (!title) return null;
  try {
    const r = await limitedFetch(folium, BAKE + enc(title), { headers: { Accept: "text/html" }, timeoutMs: 20000 });
    if (!r.ok) return null;
    const html = r.text();
    const m = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ||
      html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i);
    const d = m ? unent(m[1]) : "";
    return d.length >= 15 ? d : null;
  } catch (e) {
    folium.log.warn("baikeIntro failed", String((e && e.message) || e));
    return null;
  }
}

// 维基百科词条导言（回退源）
async function wikiIntro(folium, title, api) {
  if (!title) return null;
  try {
    const r = await limitedFetch(folium,
      api + "?action=query&format=json&prop=extracts&explaintext=1&exintro=1&redirects=1&titles=" + enc(title)
    );
    if (!r.ok) return null;
    const j = r.json();
    const pages = (j.query && j.query.pages) || {};
    const page = Object.values(pages)[0];
    if (!page || page.missing) return null;
    return page.extract ? truncate(page.extract.replace(/\s+/g, " ").trim(), 650) : null;
  } catch (e) {
    folium.log.warn("wikiIntro failed", String((e && e.message) || e));
    return null;
  }
}

// MusicBrainz 录音：专辑 / 年份
async function mbRecording(folium, title, artist) {
  if (!title) return null;
  const clean = (s) => String(s || "").replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
  try {
    const q = 'recording:"' + clean(title) + '"' + (artist ? ' AND artist:"' + clean(artist) + '"' : "");
    const r = await limitedFetch(folium, MB_API + enc(q), { timeoutMs: 20000 });
    if (!r.ok) return null;
    const j = r.json();
    const rec = (j.recordings || [])[0];
    if (!rec) return null;
    const rel = rec.releases && rec.releases[0];
    return {
      album: rel ? rel.title : null,
      year: (rec["first-release-date"] || "").slice(0, 4) || null,
    };
  } catch (e) {
    folium.log.warn("mbRecording failed", String((e && e.message) || e));
    return null;
  }
}

// 豆瓣音乐搜索：取第一条结果（标题 / 歌手·流派·年份 / 简介），中文音乐覆盖最全
async function doubanIntro(folium, query) {
  if (!query) return null;
  try {
    const r = await limitedFetch(folium, "https://www.douban.com/search?cat=1003&q=" + enc(query), { headers: { Accept: "text/html" }, timeoutMs: 15000 });
    if (!r.ok) return null;
    const html = r.text();
    const m = html.match(/<div class="result">[\s\S]*?<h3>[\s\S]*?<a[^>]*>([^<]*)<\/a>[\s\S]*?<span class="subject-cast">([^<]*)<\/span>[\s\S]*?<p>([\s\S]*?)<\/p>/);
    if (!m) return null;
    const t = unent(m[1]);
    const cast = unent(m[2]);
    const intro = unent(m[3].replace(/<[^>]+>/g, ""));
    const s = [t, cast, intro].filter(Boolean).join("。").replace(/\s+/g, " ").trim();
    return s.length >= 10 ? truncate(s, 500) : null;
  } catch (e) {
    folium.log.warn("doubanIntro failed", String((e && e.message) || e));
    return null;
  }
}

// 萌娘百科词条摘要（ACG 向补充源，MediaWiki extract API）
async function moegirlIntro(folium, title) {
  if (!title) return null;
  try {
    const r = await limitedFetch(folium,
      "https://zh.moegirl.org.cn/api.php?action=query&prop=extracts&exintro&explaintext&format=json&titles=" + enc(title),
      { timeoutMs: 15000 }
    );
    if (!r.ok) return null;
    const j = r.json();
    const pages = (j.query && j.query.pages) || {};
    const page = Object.values(pages)[0];
    if (!page || page.missing || !page.extract) return null;
    const s = page.extract.replace(/\s+/g, " ").trim();
    return s.length >= 10 ? truncate(s, 500) : null;
  } catch (e) {
    folium.log.warn("moegirlIntro failed", String((e && e.message) || e));
    return null;
  }
}

// 聚合搜索：常规检索未收录时，用多个变体关键词（歌名 / 歌名+歌手 / 歌手名 / 专辑名）
// 对豆瓣、萌娘、维基、百度做多路检索，把所有命中的片段聚合为上下文。
async function aggregateSearch(folium, artist, title, mb) {
  const queries = [];
  const push = (q) => {
    q = String(q || "").replace(/\s+/g, " ").trim();
    if (q && !queries.includes(q)) queries.push(q);
  };
  push(title);
  if (title && artist) push(title + " " + artist);
  if (mb && mb.album) push(mb.album);
  // 最多两种查询词；任一数据源命中即停止，不再把同一首歌扩展成多路抓取。
  for (const q of queries.slice(0, 2)) {
    const sources = [
      ["豆瓣音乐", () => doubanIntro(folium, q)],
      ["萌娘百科", () => moegirlIntro(folium, q)],
      ["维基百科（中文）", () => wikiIntro(folium, q, WIKI_ZH)],
      ["维基百科（英文）", () => wikiIntro(folium, q, WIKI_EN)],
      ["百度百科", () => baikeIntro(folium, q)],
    ];
    for (const [name, get] of sources) {
      const value = await get();
      if (value) return name + "（" + q + "）：" + truncate(value, 650);
    }
  }
  return "";
}

// AI 检索：OpenAI 兼容 chat/completions。
// RAG 增强：先实时抓取公开资料（豆瓣音乐/萌娘百科/维基/百度百科）作为上下文；
// 翻译目标跟随软件语言（target），keepOriginal 控制是否保留原文（模组管理开关）。
async function aiLookup(folium, cfg, artist, title, target, keepOriginal) {
  const ai = resolveAI(cfg);
  const base = String(ai.base || "").replace(/\/+$/, "");
  const model = String(ai.model || "");
  if (!base || !model || !cfg.apiKey) {
    return { error: "请先配置 AI 服务商和模型，并在「AI API 密钥」设置中保存密钥" };
  }

  // ---- RAG：检索公开资料作为上下文（顺序：豆瓣音乐 → 萌娘百科 → 维基 zh/en → 百度百科）----
  let ctx = "";
  let aggregated = false;
  try {
    const parts = [];
    const a = artist ? await doubanIntro(folium, artist) : null;
    const am = !a && artist ? await moegirlIntro(folium, artist) : null;
    const aw = !a && !am && artist ? await wikiIntro(folium, artist, WIKI_ZH) : null;
    const awEn = !a && !am && !aw && artist ? await wikiIntro(folium, artist, WIKI_EN) : null;
    const ak = !a && !am && !aw && !awEn && artist ? await baikeIntro(folium, artist) : null;
    const s = title ? await doubanIntro(folium, title) : null;
    const sm = !s && title ? await moegirlIntro(folium, title) : null;
    const sw = !s && !sm && title ? await wikiIntro(folium, title, WIKI_ZH) : null;
    const swEn = !s && !sm && !sw && title ? await wikiIntro(folium, title, WIKI_EN) : null;
    const sk = !s && !sm && !sw && !swEn && title ? await baikeIntro(folium, title) : null;
    const mb = title ? await mbRecording(folium, title, artist) : null;
    if (a) parts.push("歌手资料（豆瓣音乐）：" + truncate(a, 600));
    if (am) parts.push("歌手资料（萌娘百科）：" + truncate(am, 400));
    if (aw) parts.push("歌手资料（维基百科）：" + truncate(aw, 600));
    if (awEn) parts.push("歌手资料（维基百科 EN）：" + truncate(awEn, 600));
    if (ak) parts.push("歌手资料（百度百科）：" + truncate(ak, 600));
    if (s) parts.push("歌曲资料（豆瓣音乐）：" + truncate(s, 600));
    if (sm) parts.push("歌曲资料（萌娘百科）：" + truncate(sm, 400));
    if (sw) parts.push("歌曲资料（维基百科）：" + truncate(sw, 600));
    if (swEn) parts.push("歌曲资料（维基百科 EN）：" + truncate(swEn, 600));
    if (sk) parts.push("歌曲资料（百度百科）：" + truncate(sk, 600));
    if (mb) {
      if (mb.album) parts.push("专辑：" + mb.album);
      if (mb.year) parts.push("发行年份：" + mb.year);
    }
    ctx = parts.join("\n");

    // 歌曲资料缺失（热门歌常见：部分源被反爬拒时只有歌手资料）→ 进入 AI 聚合搜索：
    // 多变体关键词多路检索全部资料源，搜不到也让 AI 用知识补全歌曲字段
    const songCtxEmpty = !s && !sm && !sw && !swEn && !sk && !(mb && mb.album);
    if (songCtxEmpty) {
      const agg = await aggregateSearch(folium, artist, title, mb);
      if (agg && agg.trim()) ctx = (ctx ? ctx + "\n" : "") + agg;
      aggregated = true;
    }
  } catch (e) {
    folium.log.warn("rag fetch failed", String((e && e.message) || e));
  }

  const hasCtx = ctx.trim().length > 0;
  const tgtLang = normTarget(target);
  const langName = { "zh-CN": "简体中文", "zh-TW": "繁體中文", en: "English", ja: "日本語", ko: "한국어", id: "Bahasa Indonesia" }[tgtLang] || tgtLang;
  const keepTxt = keepOriginal !== false
    ? "任何部分不是" + langName + "时（如繁体、英文、日文、粤语等），一律保留原文，并在原文下方另起一行附上" + langName + "翻译，格式为\"原文\"后换行\"（翻译：……）\"，逐条对应；"
    : "将内容统一翻译成" + langName + "，不保留原文；";
  const endpoint = /\/chat\/completions$/.test(base) ? base : base + "/chat/completions";
  const sys = hasCtx
    ? "你是音乐资料助手。下面提供【检索资料】片段（来自豆瓣音乐/萌娘百科/维基百科/百度百科，可能不完整或为空）。" +
      "回答规则：① 翻译规则是最重要的硬性要求：" + keepTxt +
      "② 优先依据资料；资料未支持的细节不要编造，不确定的字段使用空字符串，并明确区分事实与推测；" +
      "③ 只输出一个 JSON 对象，不要输出其他内容，不要用 markdown 代码块。字段：{song:{album, year, origin, content}, artist:{name, bio, honors, career}}。" +
      "album 专辑名、year 发行年份、origin 歌曲出处背景（作词作曲、首发专辑/节目等）、content 歌曲内容介绍（主题、歌词大意、故事情节）；" +
      "bio 歌手简介一段、honors 主要荣誉、career 代表经历/代表作。全部字段都尽量填写，正文统一使用" + langName + "。"
    : "你是音乐资料助手。未检索到该歌手/歌曲的任何资料，请根据你自己的知识回答。" +
      "回答规则：① 翻译规则是最重要的硬性要求：" + keepTxt +
      "② 不要编造事实；不确定的字段使用空字符串，避免猜测性细节；" +
      "③ 只输出一个 JSON 对象，不要输出其他内容，不要用 markdown 代码块。字段：{song:{album, year, origin, content}, artist:{name, bio, honors, career}}。" +
      "album 专辑名、year 发行年份、origin 歌曲出处背景、content 歌曲内容介绍；bio 歌手简介一段、honors 主要荣誉、career 代表经历/代表作。正文统一使用" + langName + "为主。";
  const user =
    (hasCtx ? "【检索资料】\n" + ctx + "\n\n请根据以上资料整理" : "请整理") +
    ' 歌曲《' + title + '》 - 歌手：' + artist + ' 的资料并输出 JSON。';
  try {
    const r = await limitedFetch(folium, endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + cfg.apiKey,
      },
      body: JSON.stringify({
        model: model,
        temperature: typeof cfg.aiTemperature === "number" ? cfg.aiTemperature : 0.7,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
      }),
      timeoutMs: 45000,
    });
    if (!r.ok) return { error: "AI 接口返回 " + r.status + "，请检查接口地址 / 密钥 / 配额" };
    const j = r.json();
    const content = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
    const clean = content.replace(/```[a-z]*/gi, "").replace(/```/g, "").trim();
    const first = clean.indexOf("{");
    const last = clean.lastIndexOf("}");
    if (first < 0 || last <= first) return { error: "AI 返回内容无法解析" };
    const obj = JSON.parse(clean.slice(first, last + 1));

    // 兜底翻译：模型若不遵循提示词、字段仍是非目标语言（日文/英文原文等），
    // 渲染前逐字段检测并翻译到目标语言，保证界面语言与软件一致。
    const tgt = normTarget(target);
    const looksTarget = (s, t) => {
      const x = String(s);
      if (!x.trim()) return true;
      if (t === "en") return !/[\u3040-\u30ff\u4e00-\u9fff]/.test(x);
      if (t === "ja") return /[\u3040-\u30ff]/.test(x);
      if (t === "ko") return /[\uac00-\ud7af]/.test(x);
      if (t === "zh-TW") return /[\u4e00-\u9fff]/.test(x) && hasTrad(x) && !/[\u3040-\u30ff]/.test(x);
      if (t === "zh-CN") return /[\u4e00-\u9fff]/.test(x) && !/[\u3040-\u30ff]/.test(x);
      return !/[\u3040-\u30ff\u4e00-\u9fff]/.test(x);
    };
    const fix = async (v) => {
      const s = String(v || "").trim();
      if (!s) return v;
      if (s === "未知" || s.toLowerCase() === "unknown") return v;
      if (looksTarget(s, tgt)) {
        // zh-CN 目标 + 繁体中文 → 转简体（确有转换才用）
        if (tgt === "zh-CN" && hasTrad(s)) {
          const tr = await translateForPublic(folium, s, tgt, keepOriginal !== false, cfg.useMyMemory === true);
          return tr;
        }
        return v;
      }
      return await translateForPublic(folium, s, tgt, keepOriginal !== false, cfg.useMyMemory === true);
    };
    if (obj && typeof obj === "object") {
      const song = obj.song || {};
      const art = obj.artist || {};
      obj.song = {
        album: await fix(song.album),
        year: song.year,
        origin: await fix(song.origin),
        content: await fix(song.content),
      };
      obj.artist = {
        name: await fix(art.name),
        bio: await fix(art.bio),
        honors: await fix(art.honors),
        career: await fix(art.career),
      };
    }
    const sourceMatches = ctx.match(/豆瓣音乐|萌娘百科|维基百科(?: EN)?|百度百科|MusicBrainz/g) || [];
    return { ai: obj, generatedByAi: !hasCtx, aiAggregated: !!hasCtx && aggregated, sources: [...new Set(sourceMatches)] };
  } catch (e) {
    folium.log.warn("aiLookup failed", String((e && e.message) || e));
    return { error: "AI 查询失败（网络或解析错误），请稍后重试" };
  }
}

// 公开源查询：顺序 豆瓣音乐 → 萌娘百科 → 维基(zh/en) → 百度百科；专辑年份用 MusicBrainz 补充；
// 全部检索不到时若已配置 AI，则用 AI 兜底生成并标记 generatedByAi（界面显示告示）。
// 翻译目标跟随软件语言（target），keepOriginal 控制是否保留原文。
async function publicLookup(folium, artist, title, cfg, target, keepOriginal) {
  const findFirst = async (query) => {
    if (!query) return { text: null, source: null };
    const sources = [
      ["豆瓣音乐", () => doubanIntro(folium, query)],
      ["萌娘百科", () => moegirlIntro(folium, query)],
      ["维基百科（中文）", () => wikiIntro(folium, query, WIKI_ZH)],
      ["维基百科（英文）", () => wikiIntro(folium, query, WIKI_EN)],
      ["百度百科", () => baikeIntro(folium, query)],
    ];
    for (const [source, get] of sources) {
      const text = await get();
      if (text) return { text, source };
    }
    return { text: null, source: null };
  };
  const artistResult = await findFirst(artist);
  const songResult = await findFirst(title);
  const mb = title ? await mbRecording(folium, title, artist) : null;
  const artistIntro = artistResult.text ? await translateForPublic(folium, artistResult.text, target, keepOriginal, cfg && cfg.useMyMemory === true) : null;
  const songIntro = songResult.text ? await translateForPublic(folium, songResult.text, target, keepOriginal, cfg && cfg.useMyMemory === true) : null;
  const empty = !artistIntro && !songIntro && !(mb && (mb.album || mb.year));
  const ai = resolveAI(cfg || {});
  const hasAI = !!ai.base && !!ai.model && !!(cfg && cfg.apiKey);
  if (empty && hasAI) {
    const g = await aiLookup(folium, cfg, artist, title, target, keepOriginal);
    if (g && g.ai && !g.error) return { artistIntro: null, songIntro: null, mb: null, ai: g.ai, error: null, generatedByAi: !!g.generatedByAi, aiAggregated: !!g.aiAggregated, sources: g.sources || [] };
    if (g && g.error) return g;
  }
  if (empty) return { error: "未找到相关资料。网络不可用或来源未收录时不会缓存失败结果。" };
  return {
    artistIntro, songIntro, mb, ai: null, error: null, generatedByAi: false,
    artistSource: artistResult.source, songSource: songResult.source,
    sources: [...new Set([artistResult.source, songResult.source, mb && "MusicBrainz"].filter(Boolean))],
  };
}

// ---------- 缓存 ----------

async function loadCache(folium) {
  try {
    const v = await folium.storage.get(CACHE_KEY);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

async function saveCache(folium, cache) {
  try {
    const keys = Object.keys(cache).sort((a, b) => (cache[a].ts || 0) - (cache[b].ts || 0));
    const sizeEstimate = () => JSON.stringify(cache).length * 3; // UTF-8 保守估算
    while (keys.length > 120 || sizeEstimate() > CACHE_MAX_BYTES) {
      if (!keys.length) break;
      delete cache[keys.shift()];
    }
    await folium.storage.set(CACHE_KEY, cache);
  } catch (e) {
    folium.log.warn("cache save failed", String((e && e.message) || e));
  }
}

const truncate = (s, n) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, "") + "…" : s);

const CSS_TEXT = `
.si-root{color:var(--folium-primary,#e8e8ec);font-family:var(--folium-font,system-ui);min-width:0;}.si-root .si-body{display:flex;flex-direction:column;gap:10px;}
.si-root .si-load{font-size:12px;opacity:.6;padding:16px 0;text-align:center;}
.si-root .si-none{font-size:12px;opacity:.55;padding:10px 0;line-height:1.5;}
.si-root .si-err{font-size:12px;color:#f87171;padding:10px 0;line-height:1.5;}
.si-root .si-warn{font-size:11px;color:#fbbf24;background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.32);border-radius:8px;padding:7px 10px;line-height:1.5;}
.si-root .si-head{border-bottom:1px solid rgba(128,128,128,.16);padding-bottom:8px;}
.si-root .si-song{font-size:16px;font-weight:700;word-break:break-word;line-height:1.3;}
.si-root .si-artist{font-size:12px;opacity:.65;margin-top:3px;word-break:break-word;line-height:1.4;}
.si-root .si-src{font-size:10px;opacity:.45;margin-top:4px;}
.si-root .si-meta{font-size:11px;opacity:.75;padding:6px 10px;background:rgba(128,128,128,.09);border-radius:8px;line-height:1.5;word-break:break-word;}
.si-root .si-sec{background:rgba(128,128,128,.06);border:1px solid rgba(128,128,128,.13);border-radius:10px;padding:9px 11px;min-width:0;}
.si-root .si-sec-t{font-size:11px;opacity:.55;font-weight:700;letter-spacing:.03em;margin-bottom:5px;}
.si-root .si-sec-b{font-size:12px;line-height:1.6;word-break:break-word;}
.si-root .si-foot{font-size:10px;opacity:.38;text-align:center;}
.si-root .si-regen{margin-top:2px;align-self:center;border:1px solid rgba(139,92,246,.45);background:rgba(139,92,246,.14);color:inherit;border-radius:8px;padding:6px 16px;font-size:12px;cursor:pointer;}
.si-root .si-regen:hover{background:rgba(139,92,246,.28);}
`;

export default function activate(folium) {
  if (folium.env.context !== "main") return undefined;

  // 当前软件 UI 语言（翻译目标跟随它；"跟随系统"时宿主 locale 即系统语言）
  let curLocale = "zh-CN";

  // 普通设置只保存非敏感偏好；API 密钥单独存入 folium.storage，不进入视觉配置导入/导出。
  let cfgParams = null;
  try {
    const settingsHandle = folium.registries.settingsSections.register({
      id: "ai-config",
      label: { "zh-CN": "资料查询", en: "Info lookup" },
      description: {
        "zh-CN": "公开检索按需查询豆瓣音乐、萌娘百科、维基百科、百度百科及 MusicBrainz；只有打开歌曲资料面板时才发起查询。AI 功能关闭时不会调用 AI。开启 MyMemory 翻译后，最多 1800 字资料原文（可能含歌名/歌手等内容）会发送给 api.mymemory.translated.net；默认关闭。AI 查询会把歌曲/歌手信息及检索到的资料发送到你选择的 AI 服务商，请只使用你信任的服务商。API 密钥在下方独立密钥设置中输入并保存在模组 folium.storage，不进入视觉配置导出；升级后请重新输入密钥。",
        en: "Sources are queried on demand only while the Song Info panel is open. MyMemory translation is off by default; when enabled, up to 1,800 characters of source text may be sent to api.mymemory.translated.net. AI queries send song/artist details and retrieved excerpts to your selected provider. Store the API key in the separate secret panel; it is kept in this mod's folium.storage and is not included in visual-config exports. Re-enter the key after upgrading.",
      },
      settings: [
        { key: "source", type: "select", label: { "zh-CN": "数据源", en: "Source" }, defaultValue: "baike", options: [
          { value: "baike", label: { "zh-CN": "公开检索", en: "Public lookup" } },
          { value: "ai", label: { "zh-CN": "AI 检索", en: "AI lookup" } },
        ]},
        { key: "aiPreset", type: "select", label: { "zh-CN": "AI 服务商", en: "AI provider" }, defaultValue: "custom", options: [
          { value: "deepseek", label: { "zh-CN": "DeepSeek 深度求索", en: "DeepSeek" } },
          { value: "openai", label: { "zh-CN": "OpenAI（GPT）", en: "OpenAI (GPT)" } },
          { value: "moonshot", label: { "zh-CN": "Kimi 月之暗面", en: "Kimi (Moonshot)" } },
          { value: "zhipu", label: { "zh-CN": "智谱 GLM", en: "Zhipu GLM" } },
          { value: "qwen", label: { "zh-CN": "通义千问（阿里）", en: "Qwen (Alibaba)" } },
          { value: "doubao", label: { "zh-CN": "豆包（火山方舟）", en: "Doubao (Volcengine)" } },
          { value: "hunyuan", label: { "zh-CN": "腾讯混元", en: "Tencent Hunyuan" } },
          { value: "ollama", label: { "zh-CN": "Ollama（本地）", en: "Ollama (local)" } },
          { value: "custom", label: { "zh-CN": "自定义（手动填接口/模型）", en: "Custom (manual)" } },
        ]},
        { key: "keepOriginal", type: "boolean", label: { "zh-CN": "保留原文", en: "Keep original" }, description: { "zh-CN": "翻译时同时显示原文与译文；关闭后只显示译文。", en: "Show source text alongside translation." }, defaultValue: true },
        { key: "useMyMemory", type: "boolean", label: { "zh-CN": "启用 MyMemory 在线翻译（会发送资料文本）", en: "Enable MyMemory translation (sends source text)" }, description: { "zh-CN": "默认关闭。开启后，非简繁转换的资料文本最多 1800 字会发送至 MyMemory。", en: "Off by default. Up to 1,800 characters may be sent to MyMemory." }, defaultValue: false },
        { key: "aiBaseUrl", type: "text", label: { "zh-CN": "接口地址（自定义）", en: "API base URL (custom)" }, placeholder: "选预设后可留空；自定义填 OpenAI 兼容地址", defaultValue: "" },
        { key: "aiModel", type: "text", label: { "zh-CN": "模型（自定义）", en: "Model (custom)" }, placeholder: "选预设已带默认模型；自定义时填模型名", defaultValue: "" },
        { key: "aiTemperature", type: "number", label: { "zh-CN": "温度", en: "Temperature" }, defaultValue: 0.7, min: 0, max: 2, step: 0.1 },
      ],
    });
    cfgParams = settingsHandle.settings;
  } catch (e) {
    folium.log.warn("settings register failed", String((e && e.message) || e));
  }

  // 独立的密码输入面板；密钥只写入 folium.storage，输入框不回显已保存密钥。
  try {
    folium.registries.settingsSections.register({
      id: "api-secret",
      label: { "zh-CN": "AI API 密钥（本机保存）", en: "AI API key (local)" },
      description: { "zh-CN": "密钥不在此处明文回显，也不会写入视觉配置。folium.storage 是本地存储，并非操作系统加密密钥库；请勿共享本机配置/数据文件。", en: "The key is not echoed or exported with visual settings. folium.storage is local storage, not an OS-encrypted keychain." },
      settings: [],
      settingsPanel: (container, ctx) => {
        const wrap = document.createElement("div");
        wrap.className = "si-secret-panel";
        wrap.style.cssText = "display:flex;flex-direction:column;gap:8px;padding:8px 0;";
        const input = document.createElement("input");
        input.type = "password"; input.autocomplete = "new-password"; input.spellcheck = false;
        input.placeholder = (ctx && ctx.locale || "").startsWith("en") ? "Paste API key, then Save" : "粘贴 API 密钥后点击保存";
        input.style.cssText = "box-sizing:border-box;width:100%;padding:8px 10px;border:1px solid var(--folium-border, #777);border-radius:8px;background:var(--folium-surface, transparent);color:inherit;";
        const status = document.createElement("div"); status.style.cssText = "font-size:12px;opacity:.7;";
        const buttons = document.createElement("div"); buttons.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;";
        const makeButton = (label) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.style.cssText = "padding:6px 12px;border:1px solid var(--folium-border, #777);border-radius:7px;background:transparent;color:inherit;cursor:pointer;"; return b; };
        const save = makeButton((ctx && ctx.locale || "").startsWith("en") ? "Save key" : "保存密钥");
        const clear = makeButton((ctx && ctx.locale || "").startsWith("en") ? "Delete key" : "删除密钥");
        save.addEventListener("click", async () => {
          const key = input.value.trim();
          if (!key) { status.textContent = "请先输入密钥；留空不会覆盖现有密钥。"; return; }
          try { await folium.storage.set(API_KEY_STORAGE, key); input.value = ""; status.textContent = "密钥已保存到本机模组存储（不会回显）。"; }
          catch (e) { status.textContent = "保存失败，请检查模组存储权限。"; folium.log.warn("API key save failed", String((e && e.message) || e)); }
        });
        clear.addEventListener("click", async () => {
          try { await folium.storage.delete(API_KEY_STORAGE); input.value = ""; status.textContent = "已删除本机保存的密钥。"; }
          catch (e) { status.textContent = "删除失败。"; folium.log.warn("API key delete failed", String((e && e.message) || e)); }
        });
        buttons.append(save, clear); wrap.append(input, buttons, status); container.appendChild(wrap);
        return () => wrap.remove();
      },
    });
  } catch (e) { folium.log.warn("secret settings register failed", String((e && e.message) || e)); }

  // 不再随切歌后台预加载；只在用户打开歌曲资料面板时查询。
  const inflight = new Map(); // 同一歌曲只保留一个查询任务
  const getApiKey = async () => {
    try { return String((await folium.storage.get(API_KEY_STORAGE)) || ""); }
    catch (e) { folium.log.warn("API key read failed", String((e && e.message) || e)); return ""; }
  };
  let cacheMigrationPromise = null;
  const migrateLegacyCache = () => {
    if (!cacheMigrationPromise) cacheMigrationPromise = (async () => {
      try {
        const legacy = await folium.storage.get("si-cache");
        if (legacy && typeof legacy === "object") {
          const current = await loadCache(folium);
          for (const [key, entry] of Object.entries(legacy)) {
            const d = entry && entry.data;
            const useful = d && !d.error && (d.ai || d.artistIntro || d.songIntro || (d.mb && (d.mb.album || d.mb.year)));
            if (useful && !current[key]) current[key] = entry;
          }
          await saveCache(folium, current);
          // 旧缓存可能含未截断的长正文；迁移后删除旧键，避免占用 1 MB storage 配额。
          await folium.storage.delete("si-cache");
        }
      } catch (e) { folium.log.warn("legacy cache migration failed", String((e && e.message) || e)); }
    })();
    return cacheMigrationPromise;
  };
  const lookupAndCache = async (cfg, artist, title, source, force) => {
    const cacheKey = source + "\u0001" + artist + "\u0001" + title;
    if (!force && inflight.has(cacheKey)) return inflight.get(cacheKey);
    const p = (async () => {
      await migrateLegacyCache();
      const cache = await loadCache(folium);
      const hit = cache[cacheKey];
      const usefulHit = hit && hit.data && !hit.data.error && (hit.data.ai || hit.data.artistIntro || hit.data.songIntro || (hit.data.mb && (hit.data.mb.album || hit.data.mb.year)));
      if (!force && usefulHit && Date.now() - hit.ts < CACHE_TTL) return hit.data;
      const effectiveCfg = { ...(cfg || {}), apiKey: await getApiKey() };
      let data = null;
      if (effectiveCfg.source === "ai") data = await aiLookup(folium, effectiveCfg, artist, title, curLocale, effectiveCfg.keepOriginal);
      else data = await publicLookup(folium, artist, title, effectiveCfg, curLocale, effectiveCfg.keepOriginal);
      if (data && !data.error) {
        cache[cacheKey] = { ts: Date.now(), data, source };
        await saveCache(folium, cache);
      }
      return data;
    })().catch((e) => {
      folium.log.warn("lookup failed", String((e && e.message) || e));
      return { error: "查询失败，请检查网络连接后重试。失败结果不会缓存。" };
    }).finally(() => inflight.delete(cacheKey));
    inflight.set(cacheKey, p);
    return p;
  };

  // 播放页进度条右侧的信息按钮
  folium.registries.progressButtons.register({
    id: "song-info-btn",
    slot: "progress.trailing",
    order: 400,
    hideWhenCollapsed: true,
    mount: (container, ctx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.title = "查看歌曲资料";
      btn.style.cssText =
        "display:flex;align-items:center;justify-content:center;width:26px;height:26px;border:0;background:transparent;color:" +
        (ctx.getColors ? ctx.getColors().text : "inherit") +
        ";cursor:pointer;border-radius:6px;padding:0;";
      btn.innerHTML = INFO_SVG;
      btn.addEventListener("click", () => {
        folium.ui.openPlayerPanel("song-info");
      });
      container.appendChild(btn);

      // 迷你播放条（窗口极窄/极矮）时不显示按钮，恢复尺寸后自动回来。
      const isMini = () => window.innerWidth < 600 || window.innerHeight < 220;
      const applyMini = () => { btn.style.display = isMini() ? "none" : ""; };
      applyMini();
      window.addEventListener("resize", applyMini);

      return () => {
        window.removeEventListener("resize", applyMini);
        btn.remove();
      };
    },
  });

  // 面板页签：歌曲资料
  // 记忆上次面板高度：宿主在挂载前已清空容器，挂载瞬间拿不到上个页签的实时高度；
  // 用上次 song-info 显示时的面板高度作为过渡起点，避免从 0/占位高度塌缩。
  let lastPanelH = 0;
  folium.registries.playerPanelTabs.register({
    id: "song-info",
    label: { "zh-CN": "歌曲资料", en: "Song info" },
    order: 100,
    mount: (container, ctx) => {
      // 捕获当前软件 UI 语言（翻译目标跟随它）
      curLocale = (ctx && ctx.locale) || navigator.language || curLocale;
      // 挂载瞬间优先取容器当前高度（宿主若保留了上个页签高度则用它），否则用记忆高度
      const hPrev = container.offsetHeight || lastPanelH || 0;
      const root = document.createElement("div");
      root.className = "si-root";
      const style = document.createElement("style");
      style.textContent = CSS_TEXT;
      root.appendChild(style);
      const body = document.createElement("div");
      body.className = "si-body";
      root.appendChild(body);
      container.appendChild(root);
      // 锁定过渡起点高度，避免先塌缩再过渡
      if (hPrev > 0) root.style.height = hPrev + "px";
      // 页签挂载：内容先隐藏（动画由 applyContent 控制，资料就绪后淡入显示），占位参与布局
      body.style.opacity = "0";
      body.innerHTML = '<div class="si-load">正在查询资料…</div>';

      let curKey = null;
      let curCacheKey = null;

      // 内容替换：先隐藏 → 测高 → 高度平滑过渡（速度恒定）→ 淡入显示。
      // 过渡期间 body 裁剪溢出，保证新内容不会在高度过渡中提前溢出可见。
      const applyContent = (html) => {
        // 锁定当前高度（动画起点：挂载时的占位高度或当前内容高度），并隐藏内容
        const h0 = root.offsetHeight || 0;
        root.style.transition = "none";
        root.style.height = h0 + "px";
        body.style.transition = "none";
        body.style.opacity = "0";
        body.style.overflow = "hidden";
        body.innerHTML = html;
        const h1 = body.offsetHeight; // 新内容高度
        const show = () => {
          // 内容淡入
          body.style.transition = "opacity .18s ease";
          body.style.opacity = "1";
          const done = () => {
            body.style.transition = "";
            body.style.opacity = "";
            body.style.overflow = "";
            root.style.height = "";
            root.style.transition = "";
            lastPanelH = root.offsetHeight; // 记录本次面板高度，供下次挂载作过渡起点
          };
          body.addEventListener("transitionend", done, { once: true });
          setTimeout(done, 320);
        };
        const finish = () => {
          root.style.height = "";
          root.style.transition = "";
          show();
        };
        if (Math.abs(h1 - h0) > 2) {
          const diff = Math.abs(h1 - h0);
          const dur = Math.min(0.5, Math.max(0.12, diff / 800)); // 速度恒定
          void root.offsetWidth; // 强制重排
          root.style.transition = `height ${dur}s ease`;
          root.style.height = h1 + "px";
          root.addEventListener("transitionend", finish, { once: true });
          setTimeout(finish, dur * 1000 + 100);
        } else {
          finish();
        }
      };

      const render = async (force) => {
        const st = folium.playback.getState();
        const song = st && st.song;
        if (!song) {
          curKey = null;
          curCacheKey = null;
          applyContent('<div class="si-none">当前没有播放中的歌曲</div>');
          return;
        }
        const key = song.id + "\u0001" + song.title;
        if (!force && curKey === key) return;
        curKey = key;

        const cfg = cfgParams ? cfgParams.get() : { source: "baike" };
        const artist = song.artist || "";
        const title = song.title || "";
        const cacheKey = (cfg.source || "baike") + "\u0001" + artist + "\u0001" + title;
        curCacheKey = cacheKey;

        const cache = await loadCache(folium);
        const hit = cache[cacheKey];
        const usefulCachedData = hit && hit.data && !hit.data.error &&
          (hit.data.ai || hit.data.artistIntro || hit.data.songIntro || (hit.data.mb && (hit.data.mb.album || hit.data.mb.year)));
        if (!force && usefulCachedData && Date.now() - hit.ts < CACHE_TTL) {
          // 有效且未过期的缓存直接显示；错误/空结果一律重新查询，不作为缓存命中。
          applyContent(renderCard(song, hit.data, hit.source || cfg.source || "baike", true));
          bindRegen();
          return;
        }

        // 未命中：显示占位（首次从挂载的隐藏占位淡入，换歌时从旧内容过渡），再查询
        applyContent('<div class="si-load">正在查询资料…</div>');
        const data = await lookupAndCache(cfg, artist, title, cfg.source || "baike", !!force);
        if (curKey !== key) return; // 查询期间已换歌，丢弃结果
        applyContent(renderCard(song, data, cfg.source || "baike", false));
        bindRegen();
      };

      // 重新生成：清除当前歌曲缓存，重新联网查询 / AI 生成
      const bindRegen = () => {
        const b = body.querySelector(".si-regen");
        if (!b) return;
        b.addEventListener("click", async () => {
          const cache = await loadCache(folium);
          if (curCacheKey && cache[curCacheKey]) {
            delete cache[curCacheKey];
            await saveCache(folium, cache);
          }
          render(true);
        });
      };

      const regenBtn = '<button type="button" class="si-regen">重新生成</button>';
      const renderCard = (song, data, source, fromCache) => {
        const srcLabel = source === "ai" || (data && data.ai) ? (data && data.generatedByAi ? (data.aiAggregated ? "AI 聚合搜索生成" : "AI 生成，未经检索") : "AI 整理") : ((data && data.sources && data.sources.length) ? data.sources.join("、") : "公开检索");
        let html =
          '<div class="si-head">' +
          '<div class="si-song">' + esc(song.title) + '</div>' +
          '<div class="si-artist">' + esc(song.artist || "未知歌手") + "</div>" +
          '<div class="si-src">来源：' + esc(srcLabel) + (fromCache ? " · 已缓存" : "") + "</div></div>";

        if (data && data.generatedByAi) {
          html += data.aiAggregated ? '<div class="si-warn">AI 参考了公开检索结果并生成内容，请核对准确性。</div>' : '<div class="si-warn">AI 生成，未经检索；内容可能不准确，请自行核实。</div>';
        }

        if (!data) {
          html += '<div class="si-none">未找到相关资料</div>';
          html += regenBtn;
          html += '<div class="si-foot">来源：' + esc((data && data.sources || []).join(' · ') || '无可用来源') + '。维基百科与萌娘百科内容遵循各自页面所示许可协议。</div>';
          return html;
        }
        if (data.error) {
          html += '<div class="si-err">' + esc(data.error) + "</div>";
          html += regenBtn;
          html += '<div class="si-foot">可在模组管理的「资料查询」中修改设置</div>';
          return html;
        }

        // AI 结构化结果（清洗"未收录"占位字样；缺失字段已由 AI 直接生成）
        if (data.ai) {
          const a = data.ai;
          const s = a.song || {};
          const ar = a.artist || {};
          const cl = (v) => String(v || "").replace(/检索资料未收录/g, "").replace(/未收录/g, "").trim();
          const meta = [];
          const album = cl(s.album);
          const year = cl(s.year);
          if (album) meta.push("专辑 " + esc(album));
          if (year) meta.push(esc(year) + " 年");
          if (song.source) meta.push(esc(song.source === "local" ? "本地" : song.source));
          if (meta.length) html += '<div class="si-meta">' + meta.join(" · ") + "</div>";
          const bio = cl(ar.bio);
          const honors = cl(ar.honors);
          const career = cl(ar.career);
          const content = cl(s.content);
          const origin = cl(s.origin);
          if (bio) html += '<div class="si-sec"><div class="si-sec-t">歌手简介</div><div class="si-sec-b">' + esc(bio) + "</div></div>";
          if (honors) html += '<div class="si-sec"><div class="si-sec-t">主要荣誉</div><div class="si-sec-b">' + esc(honors) + "</div></div>";
          if (career) html += '<div class="si-sec"><div class="si-sec-t">经历与代表作</div><div class="si-sec-b">' + esc(career) + "</div></div>";
          if (content) html += '<div class="si-sec"><div class="si-sec-t">歌曲内容</div><div class="si-sec-b">' + esc(content) + "</div></div>";
          if (origin) html += '<div class="si-sec"><div class="si-sec-t">歌曲出处</div><div class="si-sec-b">' + esc(origin) + "</div></div>";
          if (!bio && !honors && !career && !origin && !content) html += '<div class="si-none">AI 未返回有效内容，可点「重新生成」重试</div>';
          html += regenBtn;
          html += '<div class="si-foot">' + (data.generatedByAi ? (data.aiAggregated ? "AI 聚合搜索生成，仅供参考" : "AI 生成，未经检索；请核实准确性") : "AI 整理内容仅供参考；来源：" + esc((data.sources || []).join(' · ') || 'AI 服务商')) + '</div>';
          return html;
        }

        // 公开源结果
        const meta = [];
        if (data.mb && data.mb.album) meta.push("专辑 " + esc(data.mb.album));
        if (data.mb && data.mb.year) meta.push(esc(data.mb.year) + " 年");
        if (song.album) meta.push("唱片 " + esc(song.album));
        if (song.source) meta.push(esc(song.source === "local" ? "本地" : song.source));
        if (meta.length) html += '<div class="si-meta">' + meta.join(" · ") + "</div>";
        if (data.artistIntro) html +=
          '<div class="si-sec"><div class="si-sec-t">歌手</div><div class="si-sec-b">' + esc(truncate(data.artistIntro, 600)) + "</div></div>";
        if (data.songIntro) html +=
          '<div class="si-sec"><div class="si-sec-t">歌曲介绍</div><div class="si-sec-b">' + esc(truncate(data.songIntro, 600)) + "</div></div>";
        if (!data.artistIntro && !data.songIntro && !(data.mb && (data.mb.album || data.mb.year))) {
          html += '<div class="si-none">未找到相关资料；失败结果不会缓存，可点击重新生成重试</div>';
        }
        html += regenBtn;
        html += '<div class="si-foot">来源：' + esc((data.sources || []).join(' · ') || '无可用来源') + '。维基百科与萌娘百科内容遵循各自页面所示许可协议。</div>';
        return html;
      };

      render();
      const off = folium.events.on("playback.songChanged", () => {
        render();
      });

      return () => {
        off();
        lastPanelH = root.offsetHeight || container.offsetHeight || lastPanelH; // 退出时记录高度
        root.remove();
      };
    },
  });

  return () => {
  };
}
