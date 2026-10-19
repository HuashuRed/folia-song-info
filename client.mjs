// song-info/client.mjs — 歌曲资料 v2.1.1（多源检索与 AI 解析修复版）
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
const MB_USER_AGENT = "Folium-SongInfo/2.1.1 (https://github.com/folium-mods/song-info)";

// 所有网络请求经同一队列串行发出，避免快速切歌造成并发请求洪峰。
// 网络请求不再全局串行排队：AI 检索会并发访问有限数量的公开来源，避免逐个等待累积延迟。
function limitedFetch(folium, url, options) {
  return folium.net.fetch(url, options || {});
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

// 清理同字映射（如"新":"新"），避免 hasTrad 把简体误判为繁体。
for (const k of Object.keys(T2S)) if (T2S[k] === k) delete T2S[k];

// 繁体 → 简体（离线）
function tw2s(text) {
  let out = "";
  for (const ch of String(text || "")) out += T2S[ch] || ch;
  return out;
}

// 检测是否含繁体字（离线映射命中，且确认字符确实不同）
function hasTrad(text) {
  for (const ch of String(text || "")) if (T2S[ch] && T2S[ch] !== ch) return true;
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

// 显式支持的目标语言集合；未知目标交给翻译流程决定，避免宽松误判。
const SUPPORTED_TARGETS = new Set(["zh-CN", "zh-TW", "en", "ja", "ko", "id"]);

// 文本是否已是目标语言
function isTargetLang(text, target) {
  const t = String(text || "");
  const hasHan = /[\u4e00-\u9fff]/.test(t);
  const hasKana = /[\u3040-\u30ff]/.test(t);
  const hasHangul = /[\uac00-\ud7af]/.test(t);
  if (!SUPPORTED_TARGETS.has(target)) return false;
  if (target === "en") return !hasHan && !hasKana && !hasHangul;
  if (target === "ja") return hasKana && !hasHan;
  if (target === "ko") return hasHangul && !hasHan && !hasKana;
  if (target === "zh-TW") return hasHan && hasTrad(t) && !hasKana && !hasHangul;
  if (target === "zh-CN") return hasHan && !hasTrad(t) && !hasKana && !hasHangul && !/[A-Za-z]{3,}/.test(t);
  if (target === "id") return !hasHan && !hasKana && !hasHangul; // 印尼语检测困难，拉丁视为已满足
  return false;
}

// 粗略检测源语言（日文假名/韩文优先，避免混排文本被误判为中文）
function detectSrc(text) {
  const t = String(text || "");
  const hasHan = /[\u4e00-\u9fff]/.test(t);
  const hasKana = /[\u3040-\u30ff]/.test(t);
  const hasHangul = /[\uac00-\ud7af]/.test(t);
  const hasEn = /[A-Za-z]{3,}/.test(t);
  if (hasKana) return "ja";
  if (hasHangul && !hasHan) return "ko";
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

// 判断是否为本地/免密钥 AI 端点（Ollama 或 localhost 自定义地址）。
const isLocalAIBase = (base) =>
  /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i.test(String(base || ""));

// 缓存键：把影响结果的语言/长度/翻译/AI 模型等配置纳入，避免设置变化后命中过期结果。
function buildCacheKey(source, artist, title, cfg, locale) {
  const c = cfg || {};
  const parts = [source, artist, title, normTarget(locale), String(c.contentDetail || "balanced")];
  parts.push(c.keepOriginal !== false ? "ko" : "kt");
  parts.push(c.useMyMemory === true ? "mm" : "nomm");
  if (source === "ai" || source === "ai-memory") {
    const ai = resolveAI(c);
    parts.push(String(ai.base || ""));
    parts.push(String(ai.model || ""));
    if (c.aiMemoryOnly) parts.push("mem");
  }
  return parts.join("\u0001");
}

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
      api + "?action=query&format=json&prop=extracts&explaintext=1&exintro=1&redirects=1&titles=" + enc(title),
      { timeoutMs: 12000 }
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
    const r = await limitedFetch(folium, MB_API + enc(q), {
      timeoutMs: 20000,
      headers: { "User-Agent": MB_USER_AGENT },
    });
    if (!r.ok) return null;
    const j = r.json();
    const norm = (v) => String(v || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const wantedTitle = norm(title);
    const wantedArtist = norm(artist);
    const candidates = (j.recordings || []).map((item) => {
      const gotTitle = norm(item.title);
      const gotArtist = norm((item["artist-credit"] || []).map((x) => x.name || (x.artist && x.artist.name) || "").join(" "));
      let score = 0;
      if (gotTitle === wantedTitle) score += 5;
      else if (gotTitle && (gotTitle.includes(wantedTitle) || wantedTitle.includes(gotTitle))) score += 2;
      if (wantedArtist && gotArtist === wantedArtist) score += 5;
      else if (wantedArtist && gotArtist && (gotArtist.includes(wantedArtist) || wantedArtist.includes(gotArtist))) score += 2;
      if (item["first-release-date"]) score += 0.25;
      return { item, score };
    }).sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (!best || best.score < (artist ? 7 : 4)) return null;
    const rec = best.item;
    const rels = rec.releases || [];
    const rel = rels.find((x) => x && x.title) || null;
    return {
      album: rel ? rel.title : null,
      year: (rec["first-release-date"] || (rel && rel.date) || "").slice(0, 4) || null,
      releaseDate: (rec["first-release-date"] || (rel && rel.date) || "") || null,
      sourceUrl: "https://musicbrainz.org/recording/" + encodeURIComponent(rec.id || ""),
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
// AI 检索：OpenAI 兼容 chat/completions。
// RAG 增强：先实时抓取公开资料（豆瓣音乐/萌娘百科/维基/百度百科）作为上下文；
// 翻译目标跟随软件语言（target），keepOriginal 控制是否保留原文（模组管理开关）。
async function aiLookup(folium, cfg, artist, title, target, keepOriginal) {
  const ai = resolveAI(cfg);
  const base = String(ai.base || "").replace(/\/+$/, "");
  const model = String(ai.model || "");
  const isLocalProvider = (cfg && cfg.aiPreset === "ollama") || isLocalAIBase(base);
  if (!base || !model) {
    return { error: "请先配置 AI 服务商和模型" };
  }
  if (!cfg.apiKey && !isLocalProvider) {
    return { error: "请先配置 AI 服务商和模型，并在「AI API 密钥」设置中保存密钥" };
  }

  // ---- RAG：按简洁/标准/详细挡位控制实际来源请求数 ----
  let ctx = "";
  let aggregated = false;
  const detailMode = String(cfg.contentDetail || "balanced");
  try {
    const parts = [];
    const allSources = [
      ["豆瓣音乐", (query) => doubanIntro(folium, query)],
      ["萌娘百科", (query) => moegirlIntro(folium, query)],
      ["维基百科（中文）", (query) => wikiIntro(folium, query, WIKI_ZH)],
      ["维基百科（英文）", (query) => wikiIntro(folium, query, WIKI_EN)],
      ["百度百科", (query) => baikeIntro(folium, query)],
    ];
    if (cfg && cfg.aiMemoryOnly) {
      // 记忆补充是独立的模型知识任务，不先检索公开来源，避免普通整理结果覆盖记忆补充字段。
      ctx = "";
    } else if (detailMode === "compact") {
      // 简洁模式只发起一次公开来源请求：一个来源、一个组合关键词。
      const query = [title, artist].filter(Boolean).join(" ");
      if (query) {
        try {
          const [name, get] = allSources[0];
          const value = await get(query);
          const text = String(value || "").replace(/\s+/g, " ").trim();
          if (text.length >= 10) parts.push("豆瓣音乐（关键词：" + query + "）：" + truncate(text, 1000));
        } catch (_) { /* no second source in compact mode */ }
      }
    } else {
      // 歌名和歌手合并成一次查询（请求量减半，更不易匹配到同名条目）；
      // 来源并发请求：标准最多查 3 个来源，详细最多查 5 个（仍含维基，按既定范围不改挡）；
      // 公开片段设总时限 6 秒：到点就用已拿到的内容调模型，慢的来源直接丢弃。
      const sourceCap = detailMode === "detailed" ? 5 : 3;
      const chosen = allSources.slice(0, sourceCap);
      const query = [title, artist].filter(Boolean).join(" ");
      const jobs = [];
      if (query) {
        for (const [name, get] of chosen) {
          jobs.push((async () => {
            try {
              const value = await get(query);
              const text = String(value || "").replace(/\s+/g, " ").trim();
              if (text.length >= 10) return name + "（关键词：" + query + "）：" + truncate(text, 750);
            } catch (_) { /* 单源失败不阻塞其余来源 */ }
            return "";
          })());
        }
      }
      jobs.push((async () => {
        try {
          const mb = title ? await mbRecording(folium, title, artist) : null;
          if (!mb) return "";
          return [mb.album && "MusicBrainz 专辑：" + mb.album, mb.year && "MusicBrainz 发行年份：" + mb.year, mb.releaseDate && "MusicBrainz 发行日期：" + mb.releaseDate].filter(Boolean).join("；");
        } catch (_) { return ""; }
      })());
      const results = await raceWithDeadline(jobs, 6000); // 最多等 6 秒
      for (const result of results) if (result) parts.push(result);
    }
    // 去重并限制上下文大小。
    ctx = [...new Set(parts)].join("\n\n").slice(0, detailMode === "detailed" ? 20000 : 14000);
    aggregated = !!ctx;
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
  let sys = hasCtx
    ? "你是音乐资料助手。下面提供【检索资料】片段（来自豆瓣音乐/萌娘百科/维基百科/百度百科，可能不完整或为空）。" +
      "回答规则：① 翻译规则是最重要的硬性要求：" + keepTxt +
      "② 严格核对歌曲名和歌手；资料可能对应同名歌曲、翻唱或其他版本，无法确认时相关字段留空。不得把搜索摘要当成已核实的歌曲背景；不得编造发行日期、创作人员、荣誉或作品故事。" +
      "③ 尽可能完整地填写所有有依据的字段；song.content 写 2-4 句作品介绍，song.origin 写有依据的创作/发行背景，song.listeningNotes 写 2-3 句并明确是主观解读；artist.bio 写 2-4 句，artist.representativeWorks 单独列出有依据的代表作，artist.career 单独列出演艺/创作经历。song.source 填写歌曲出处（影视、游戏、专辑、原声带等，仅在有依据时填写）。区分可核实事实与主观解读，不确定的具体日期、人员、荣誉必须留空，不得编造。" +
      "④ 只输出一个 JSON 对象，不要输出其他内容，不要用 markdown 代码块。字段：{song:{album, year, releaseDate, writers, composers, arranger, genre, origin, content, source, listeningNotes}, artist:{name, bio, representativeWorks, honors, career}}。" +
      "album 专辑名、year 年份、releaseDate 发行日期、writers 作词、composers 作曲、arranger 编曲、genre 风格、origin 创作与发行背景、content 歌曲简介、source 歌曲出处（影视/游戏/专辑/原声等，需有依据）、listeningNotes 聆听解读；bio 歌手简介、representativeWorks 歌手代表作、career 歌手经历、honors 可核验荣誉。无来源支持就留空。正文统一使用" + langName + "。"
    : "你是音乐资料助手。当前没有检索到该歌手/歌曲的公开资料。" +
      "回答规则：① 翻译规则是最重要的硬性要求：" + keepTxt +
      "② 不得把模型记忆描述为检索结果。" +
      (cfg && cfg.aiMemoryOnly ? "记忆补充模式允许凭模型已有记忆生成，内容不要求高准确率，所有生成内容标记为 AI 生成。" : "不得编造发行日期、专辑、创作人员、荣誉或故事背景。") +
      (detailMode === "detailed" ? "详细挡位允许谨慎使用模型自身知识；将所有此类内容仅写入 memorySupplement 对象并标注未经检索核实，不确定的具体事实留空。" : "简洁/标准挡位不允许用模型记忆填补事实字段；没有依据的事实字段必须留空。listeningNotes 可以给出明确标注为主观解读的简短聆听提示。") +
      "③ 只输出一个 JSON 对象，不要输出其他内容，不要用 markdown 代码块。字段：{song:{album, year, releaseDate, writers, composers, arranger, genre, origin, content, source, listeningNotes}, artist:{name, bio, representativeWorks, honors, career}, memorySupplement:{song:{origin,content,listeningNotes,source,album,year,releaseDate,writers,composers,arranger,genre},artist:{bio,representativeWorks,honors,career}}}。" +
      "正文统一使用" + langName + "。";
  if (detailMode === "detailed") {
    sys += "详细挡位规则：先以检索资料为准；若重要字段仍缺失，可谨慎使用模型自身知识补充，但不得猜测。JSON 中额外输出 memorySupplement 对象，结构为 {song:{origin,content,listeningNotes,album,year,releaseDate,writers,composers,arranger,genre},artist:{bio,representativeWorks,honors,career}}。只有完全来自模型自身知识、未被检索来源支持的补充写入 memorySupplement 对应字段；这些字段不得重复写入普通 song/artist 字段。不得把 AI 记忆补充列入公开来源。";
  } else if (detailMode === "compact") {
    sys += "简洁挡位：输出最关键的基本信息，尽量简短，不进行无来源扩写。";
  } else {
    sys += "标准挡位：以多个公开来源交叉汇总为主；没有可靠来源支持的事实留空，不使用模型记忆补全事实。";
  }
  if (cfg && cfg.aiMemoryOnly) {
    sys += "这是【AI 记忆补充】任务，用户明确允许你凭模型自身记忆和常识生成内容，不要求高准确率，不要因为无法核实就留空。请尽可能为以下七个栏目生成有用内容：作曲作词（writers/composers/arranger）、歌手简介（artist.bio）、歌手代表作（artist.representativeWorks）、歌手经历（artist.career）、歌曲创作与发行背景（song.origin）、歌曲出处（song.source）、聆听解读（song.listeningNotes）。可以谨慎使用你对歌曲和歌手的记忆；不要声称这些内容已经检索核实。将生成内容放入 memorySupplement 对应字段，字段包括 song:{writers,composers,arranger,origin,content,source,listeningNotes,album,year,releaseDate,genre}, artist:{bio,representativeWorks,career,honors}。普通 song/artist 字段保持为空。每个补充字段会标记【ai 生成】。输出完整 JSON。";
  }
  const user =
    (hasCtx ? "【检索资料】\n" + ctx + "\n\n请根据以上资料整理" : "请整理") +
    ' 歌曲《' + title + '》 - 歌手：' + artist + ' 的资料并输出 JSON。';
  try {
    const headers = { "Content-Type": "application/json" };
    if (cfg.apiKey) headers.Authorization = "Bearer " + cfg.apiKey;
    const r = await limitedFetch(folium, endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: model,
        // 检索整理用低温度 0.25 减少事实字段编造；AI 记忆补充单独保持较高温度（用户设置或 0.7）
        temperature: cfg && cfg.aiMemoryOnly ? (typeof cfg.aiTemperature === "number" ? cfg.aiTemperature : 0.7) : 0.25,
        max_tokens: 3000,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
      }),
      timeoutMs: 45000,
    });
    if (!r.ok) return { error: "AI 接口返回 " + r.status + "，请检查接口地址 / 密钥 / 配额" };
    const j = await r.json();
    const rawContent = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    const content = Array.isArray(rawContent)
      ? rawContent.map((part) => typeof part === "string" ? part : (part && (part.text || part.content)) || "").join("\n")
      : (typeof rawContent === "string" ? rawContent : "");
    if (!content.trim()) {
      const reason = j && j.choices && j.choices[0] && j.choices[0].finish_reason;
      return { error: "AI 返回了空内容" + (reason ? "（finish_reason: " + reason + "）" : "，请检查模型、配额或接口兼容性") };
    }
    const clean = content.replace(/```(?:json|javascript|js)?/gi, "").replace(/```/g, "").trim();
    const first = clean.indexOf("{");
    const last = clean.lastIndexOf("}");
    if (first < 0 || last <= first) {
      folium.log.warn("AI response is not JSON", clean.slice(0, 500));
      return { error: "AI 返回内容不是有效 JSON；请检查自定义模型是否支持指令跟随，或点击重新生成" };
    }
    let obj;
    try { obj = JSON.parse(clean.slice(first, last + 1)); }
    catch (parseError) {
      folium.log.warn("AI JSON parse failed", String((parseError && parseError.message) || parseError), clean.slice(0, 500));
      return { error: "AI 返回的 JSON 格式不完整或有误，请点击重新生成；若持续出现，请检查模型的 JSON 输出兼容性" };
    }

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
      // 兜底翻译并行处理，避免多个非目标语言字段时串行累积延迟。
      const [album, writers, composers, arranger, genre, origin, content, listeningNotes, sourceField] = await Promise.all([
        fix(song.album), fix(song.writers), fix(song.composers), fix(song.arranger),
        fix(song.genre), fix(song.origin), fix(song.content), fix(song.listeningNotes), fix(song.source),
      ]);
      const [artistName, bio, representativeWorks, honors, career] = await Promise.all([
        fix(art.name), fix(art.bio), fix(art.representativeWorks), fix(art.honors), fix(art.career),
      ]);
      obj.song = {
        album,
        year: String(song.year || "").trim(),
        releaseDate: String(song.releaseDate || "").trim(),
        writers, composers, arranger, genre, origin, content,
        listeningNotes,
        source: sourceField,
      };
      obj.artist = { name: artistName, bio, representativeWorks, honors, career };
    }
    if (detailMode === "detailed" || (cfg && cfg.aiMemoryOnly)) {
      const memory = obj && obj.memorySupplement && typeof obj.memorySupplement === "object" ? obj.memorySupplement : {};
      const applyMemory = (targetObj, memoryObj, forceMemory) => {
        if (!targetObj || !memoryObj) return;
        for (const key of Object.keys(memoryObj)) {
          const value = String(memoryObj[key] || "").trim();
          if (value && (forceMemory || targetObj[key] == null || !String(targetObj[key] || "").trim())) {
            targetObj[key] = "【ai 生成】" + value;
          }
        }
      };
      obj.song = obj.song || {}; obj.artist = obj.artist || {};
      applyMemory(obj.song, memory.song, !!(cfg && cfg.aiMemoryOnly));
      applyMemory(obj.artist, memory.artist, !!(cfg && cfg.aiMemoryOnly));
      // 无检索上下文时，模型生成的非空字段全部明确标注为未经检索的 AI 记忆补充。
      if (!hasCtx && !(cfg && cfg.aiMemoryOnly)) {
        for (const group of [obj.song, obj.artist]) for (const key of Object.keys(group || {})) {
          const value = String(group[key] || "").trim();
          if (value && !value.startsWith("【AI记忆补充·未经检索核实】")) group[key] = "【AI记忆补充·未经检索核实】" + value;
        }
      }
      delete obj.memorySupplement;
    }
    const sourceMatches = ctx.match(/豆瓣音乐|萌娘百科|维基百科（中文）|维基百科（英文）|维基百科 EN|百度百科|MusicBrainz/g) || [];
    return { ai: obj, generatedByAi: !hasCtx, aiAggregated: !!hasCtx && aggregated, sources: [...new Set(sourceMatches)] };
  } catch (e) {
    folium.log.warn("aiLookup failed", String((e && e.message) || e));
    return { error: "AI 查询失败：" + String((e && e.message) || e || "未知错误") + "。请检查接口地址、密钥、模型、配额和响应格式；此错误不一定表示设备断网。" };
  }
}

// 公开源查询（提速版）：豆瓣音乐、萌娘百科、百度百科、MusicBrainz 四个来源同时发请求，
// 谁先返回有效内容就先用谁（不等固定顺序）；维基百科不再参与公开检索。
// 简洁=第1个返回有效内容的来源；标准=最先返回有效内容的2个来源；详细=四个来源结果都采用。
// 空结果和失败不算「有内容」；MusicBrainz 只有专辑、年份或发行日期时才算有效。
// 全部检索不到时若已配置 AI，则用 AI 兜底生成并标记 generatedByAi（界面显示告示）。
async function publicLookup(folium, artist, title, cfg, target, keepOriginal) {
  const detailMode = String((cfg && cfg.contentDetail) || "balanced");
  const wanted = detailMode === "compact" ? 1 : detailMode === "detailed" ? 4 : 2;
  const SOURCES = [
    ["豆瓣音乐", (q) => doubanIntro(folium, q)],
    ["萌娘百科", (q) => moegirlIntro(folium, q)],
    ["百度百科", (q) => baikeIntro(folium, q)],
  ];
  const collect = async (query, includeMb) => {
    if (!query) return [];
    const jobs = SOURCES.map(([name, get]) => (async () => {
      try {
        const text = String(await get(query) || "").replace(/\s+/g, " ").trim();
        if (text.length < 10) return null; // 空结果/失败不算有内容
        return { source: name, text };
      } catch (_) { return null; }
    })());
    if (includeMb) {
      jobs.push((async () => {
        try {
          const mb = title ? await mbRecording(folium, title, artist) : null;
          if (!(mb && (mb.album || mb.year || mb.releaseDate))) return null;
          return { source: "MusicBrainz", mb, text: [mb.album && "专辑：" + mb.album, mb.year && "发行年份：" + mb.year, mb.releaseDate && "发行日期：" + mb.releaseDate].filter(Boolean).join("；") };
        } catch (_) { return null; }
      })());
    }
    return collectFast(jobs, wanted); // 按完成顺序收集有效结果，集满 wanted 个即停
  };
  // 歌曲、歌手两个维度并行；MusicBrainz 只需在歌曲维度查一次
  const [artistHits, songHits] = await Promise.all([collect(artist, false), collect(title, true)]);
  const translate = (text) => (text ? translateForPublic(folium, text, target, keepOriginal, cfg && cfg.useMyMemory === true) : null);
  const textHits = (hits) => hits.filter((h) => h.source !== "MusicBrainz"); // MB 元数据走顶部 meta，不混入正文翻译
  const artistIntro = artistHits.length ? await translate(artistHits.map((h) => h.text).join("\n\n")) : null;
  const songIntro = textHits(songHits).length ? await translate(textHits(songHits).map((h) => h.text).join("\n\n")) : null;
  const mbHit = songHits.find((h) => h.source === "MusicBrainz");
  const mb = (mbHit && mbHit.mb) || null;
  const empty = !artistIntro && !songIntro && !mbHit;
  const ai = resolveAI(cfg || {});
  const hasAI = !!ai.base && !!ai.model && !!(cfg && (cfg.apiKey || cfg.aiPreset === "ollama" || isLocalAIBase(ai.base)));
  if (empty && hasAI) {
    const g = await aiLookup(folium, cfg, artist, title, target, keepOriginal);
    if (g && g.ai && !g.error) return { artistIntro: null, songIntro: null, mb: null, ai: g.ai, error: null, generatedByAi: !!g.generatedByAi, aiAggregated: !!g.aiAggregated, sources: g.sources || [] };
    if (g && g.error) return g;
  }
  if (empty) return { error: "未找到相关资料。网络不可用或来源未收录时不会缓存失败结果。" };
  return {
    artistIntro, songIntro, mb, ai: null, error: null, generatedByAi: false,
    artistSource: artistHits.map((h) => h.source).join("、") || null,
    songSource: textHits(songHits).map((h) => h.source).join("、") || null,
    sources: [...new Set([...artistHits.map((h) => h.source), ...songHits.map((h) => h.source)].filter(Boolean))],
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
    return true;
  } catch (e) {
    folium.log.warn("cache save failed", String((e && e.message) || e));
    return false;
  }
}

const truncate = (s, n) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, "") + "…" : s);

// 竞速收集：同时发起 jobs，按「完成顺序」收集非空结果，集满 wanted 个即停止等待（其余仍在后台跑完但结果不用）。
async function collectFast(jobs, wanted) {
  const wraps = jobs.map((job) => job().then((r) => ({ r })).catch(() => ({ r: null })));
  const done = [];
  while (wraps.length && done.length < wanted) {
    const won = await Promise.race(wraps);
    const i = wraps.indexOf(won);
    if (i >= 0) wraps.splice(i, 1);
    if (won.r) done.push(won.r);
  }
  return done;
}

// 限时收集：同时发起 jobs，在 ms 毫秒内按完成顺序收集结果；到点立即返回已拿到的内容，慢的来源直接丢弃。
async function raceWithDeadline(jobs, ms) {
  const wraps = jobs.map((job) => job().then((r) => ({ r: r || "" })).catch(() => ({ r: "" })));
  const done = [];
  const deadlineP = new Promise((resolve) => { setTimeout(() => resolve("__deadline__"), ms); });
  while (wraps.length) {
    const won = await Promise.race([...wraps, deadlineP]);
    if (won === "__deadline__") break;
    const i = wraps.indexOf(won);
    if (i < 0) break;
    wraps.splice(i, 1);
    if (won.r) done.push(won.r);
  }
  return done;
}

// 来源链接采用固定站点的搜索页，避免伪造或猜测具体词条 URL。
function sourceSearchUrl(name, query) {
  const q = encodeURIComponent(String(query || "").trim());
  if (!q) return "";
  if (name.includes("MusicBrainz")) return "https://musicbrainz.org/search?query=" + q + "&type=recording";
  if (name.includes("豆瓣")) return "https://www.douban.com/search?cat=1003&q=" + q;
  if (name.includes("萌娘")) return "https://zh.moegirl.org.cn/index.php?search=" + q;
  if (name.includes("维基百科（英文）")) return "https://en.wikipedia.org/w/index.php?search=" + q;
  if (name.includes("维基百科")) return "https://zh.wikipedia.org/w/index.php?search=" + q;
  if (name.includes("百度百科")) return "https://baike.baidu.com/search/word?word=" + q;
  return "";
}
function sourceLinksHtml(names, query) {
  return [...new Set(names || [])].map((name) => {
    const url = sourceSearchUrl(name, query);
    return url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(name) + '</a>' : esc(name);
  }).join(' · ');
}

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
.si-root .si-foot{font-size:10px;opacity:.55;text-align:center;line-height:1.6;}.si-root .si-foot a{color:inherit;text-decoration:underline;text-underline-offset:2px;}.si-root .si-credits{font-size:11px;line-height:1.5;opacity:.8;}.si-root .si-tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px;}.si-root .si-tag{font-size:10px;border:1px solid rgba(128,128,128,.22);border-radius:999px;padding:2px 7px;opacity:.8;}
.si-root .si-regen{margin-top:2px;align-self:center;border:1px solid rgba(139,92,246,.45);background:rgba(139,92,246,.14);color:inherit;border-radius:8px;padding:6px 16px;font-size:12px;cursor:pointer;}
.si-root .si-regen:hover,.si-root .si-memory-supplement:hover{background:rgba(139,92,246,.28);}
.si-root .si-memory-supplement{margin-top:2px;align-self:center;border:1px solid rgba(139,92,246,.45);background:rgba(139,92,246,.14);color:inherit;border-radius:8px;padding:6px 16px;font-size:12px;cursor:pointer;}
`;

export default function activate(folium) {
  if (folium.env.context !== "main") return undefined;

  // 当前软件 UI 语言（翻译目标跟随它；"跟随系统"时宿主 locale 即系统语言）
  let curLocale = "zh-CN";

  // 普通偏好仍由设置 schema 管理；密钥单独写入 folium.storage，不参与视觉配置导出。
  let cfgParams = null;
  const settingsSchema = [
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
        { key: "contentDetail", type: "select", label: { "zh-CN": "内容长度", en: "Content length" }, defaultValue: "balanced", options: [
          { value: "compact", label: { "zh-CN": "简洁", en: "Compact" } },
          { value: "balanced", label: { "zh-CN": "标准", en: "Balanced" } },
          { value: "detailed", label: { "zh-CN": "详细", en: "Detailed" } },
        ]},
        { key: "showCredits", type: "boolean", label: { "zh-CN": "显示创作人员", en: "Show credits" }, defaultValue: true },
        { key: "showListeningNotes", type: "boolean", label: { "zh-CN": "显示聆听提示（AI 解读）", en: "Show listening notes (AI interpretation)" }, defaultValue: true },
        { key: "showArtistDetails", type: "boolean", label: { "zh-CN": "显示歌手经历与荣誉", en: "Show artist career and honors" }, defaultValue: true },
        { key: "autoAiMemorySupplement", type: "boolean", label: { "zh-CN": "自动 AI 记忆补充", en: "Auto AI memory supplement" }, description: { "zh-CN": "开启后，AI 查询结果若缺少歌曲/歌手栏目，会自动调用 AI 记忆补充并缓存结果，无需手动点击；生成内容会标注【ai 生成】，可能增加 AI 调用次数和费用。", en: "When enabled, missing song/artist sections trigger an AI-memory completion and cache automatically. Generated text is marked and may incur extra AI usage costs." }, defaultValue: false },
        { key: "preloadNext", type: "boolean", label: { "zh-CN": "预加载播放列表下一首（AI 检索）", en: "Preload next playlist track (AI lookup)" }, description: { "zh-CN": "开启后，歌曲切换时会尝试提前查询下一首歌曲并缓存结果；仅在数据源为 AI 检索且能从播放状态识别下一首时生效，可能提前向 AI 服务商发送歌曲信息并产生费用。", en: "When enabled, attempts to fetch and cache the next playlist track when the song changes. Only works for AI lookup when the next track can be identified; may send track details to your AI provider and incur costs." }, defaultValue: false },
        { key: "keepOriginal", type: "boolean", label: { "zh-CN": "保留原文", en: "Keep original" }, description: { "zh-CN": "开启时同时显示原文与译文；关闭时只显示译文。适用于翻译内容，不影响原始资料查询。", en: "Show source text alongside translation." }, defaultValue: true },
        { key: "useMyMemory", type: "boolean", label: { "zh-CN": "启用 MyMemory 在线翻译（会发送资料文本）", en: "Enable MyMemory translation (sends source text)" }, description: { "zh-CN": "默认关闭。开启后，非简繁转换的资料文本最多 1800 字会发送至 MyMemory。", en: "Off by default. Up to 1,800 characters may be sent to MyMemory." }, defaultValue: false },
        { key: "aiBaseUrl", type: "text", label: { "zh-CN": "接口地址（自定义）", en: "API base URL (custom)" }, placeholder: "选预设后可留空；自定义填 OpenAI 兼容地址", defaultValue: "" },
        { key: "aiModel", type: "text", label: { "zh-CN": "模型（自定义）", en: "Model (custom)" }, placeholder: "选预设已带默认模型；自定义时填模型名", defaultValue: "" },
        { key: "aiTemperature", type: "number", label: { "zh-CN": "温度", en: "Temperature" }, defaultValue: 0.7, min: 0, max: 2, step: 0.1 },
      ];
  try {
    const settingsHandle = folium.registries.settingsSections.register({
      id: "ai-config",
      label: { "zh-CN": "资料查询", en: "Info lookup" },
      description: {
        "zh-CN": "公开检索：豆瓣音乐、萌娘百科、百度百科、MusicBrainz 四个来源同时查询，按返回速度取用（简洁取第 1 个、标准取前 2 个、详细取全部 4 个有效来源），维基不参与公开检索。AI 检索：豆瓣、萌娘、维基（中/英）、百度、MusicBrainz，公开片段最多等 6 秒。只有打开歌曲资料面板时才发起查询。AI 功能关闭时不会调用 AI。开启 MyMemory 翻译后，最多 1800 字资料原文（可能含歌名/歌手等内容）会发送给 api.mymemory.translated.net；默认关闭。AI 查询会把歌曲/歌手信息及检索到的资料发送到你选择的 AI 服务商，请只使用你信任的服务商。API 密钥单独保存在本机模组存储，不进入视觉配置导出。",
        en: "Sources are queried on demand only while the Song Info panel is open. MyMemory translation is off by default; when enabled, up to 1,800 characters of source text may be sent to api.mymemory.translated.net. AI queries send song/artist details and retrieved excerpts to your selected provider. The API key is stored separately in local mod storage and excluded from visual-config exports."
      },
      settings: settingsSchema,
      settingsPanel: (container, ctx) => {
        const access = (ctx && ctx.settings) || (settingsHandle && settingsHandle.settings);
        const locale = String((ctx && ctx.locale) || "zh-CN");
        const en = locale.toLowerCase().startsWith("en");
        const labelText = (v) => typeof v === "string" ? v : (v && (v[locale] || v[locale.split("-")[0]] || v["zh-CN"] || v.en)) || "";
        const wrap = document.createElement("div");
        wrap.style.cssText = "display:flex;flex-direction:column;gap:12px;padding:8px 0;";
        const controls = new Map();
        const getValues = () => { try { return access && typeof access.get === "function" ? (access.get() || {}) : {}; } catch (_) { return {}; } };
        const writeValue = (key, value) => {
          try { if (access && typeof access.set === "function") access.set(key, value); }
          catch (e) { folium.log.warn("setting update failed: " + key, String((e && e.message) || e)); }
          const persistedKey = key === "preloadNext" ? "si-preload-next-enabled" : key === "autoAiMemorySupplement" ? "si-auto-ai-memory-supplement" : null;
          if (persistedKey) Promise.resolve(folium.storage.set(persistedKey, Boolean(value))).catch((e) => folium.log.warn("setting preference save failed: " + key, String((e && e.message) || e)));
        };
        for (const def of settingsSchema) {
          const row = document.createElement("label");
          row.style.cssText = "display:flex;flex-direction:column;gap:5px;font-size:13px;color:inherit;";
          const title = document.createElement("span");
          title.textContent = labelText(def.label);
          const hoverHelp = ["preloadNext", "keepOriginal", "useMyMemory", "autoAiMemorySupplement"].includes(def.key);
          if (hoverHelp && def.description) {
            // Native title tooltip intentionally appears only after the pointer pauses.
            row.title = labelText(def.description);
            row.setAttribute("aria-label", labelText(def.label) + "。" + labelText(def.description));
            title.style.cssText = "text-decoration:underline dotted;text-underline-offset:3px;cursor:help;";
            title.setAttribute("tabindex", "0");
            title.title = labelText(def.description);
          }
          row.appendChild(title);
          if (def.description && !hoverHelp) { const help = document.createElement("small"); help.textContent = labelText(def.description); help.style.cssText = "opacity:.72;line-height:1.4;"; row.appendChild(help); }
          let input;
          if (def.type === "select") {
            input = document.createElement("select"); input.style.color = "var(--folium-button-text, var(--folium-primary-foreground, ButtonText))"; input.style.backgroundColor = "var(--folium-background, var(--folium-surface, Canvas))"; input.style.colorScheme = "inherit";
            input.style.cssText = "box-sizing:border-box;width:100%;padding:7px 9px;border:1px solid var(--folium-border,rgba(128,128,128,.35));border-radius:7px;background:var(--folium-background,var(--folium-surface,Canvas));color:var(--folium-button-text,var(--folium-primary-foreground,ButtonText));color-scheme:inherit;";
            for (const opt of (def.options || [])) { const option = document.createElement("option"); option.value = opt.value; option.textContent = labelText(opt.label); option.style.color = "var(--folium-button-text, var(--folium-primary-foreground, ButtonText))"; option.style.backgroundColor = "var(--folium-background, var(--folium-surface, Canvas))"; input.appendChild(option); }
            input.addEventListener("change", () => writeValue(def.key, input.value));
          } else if (def.type === "boolean") {
            input = document.createElement("input"); input.type = "checkbox";
            input.addEventListener("change", () => writeValue(def.key, input.checked));
            row.style.flexDirection = "row"; row.style.alignItems = "center"; row.style.gap = "9px"; row.insertBefore(input, title); title.style.order = "1";
          } else {
            input = document.createElement("input"); input.type = def.type === "number" ? "number" : "text";
            if (def.placeholder) input.placeholder = def.placeholder;
            if (def.min != null) input.min = String(def.min); if (def.max != null) input.max = String(def.max); if (def.step != null) input.step = String(def.step);
            input.style.cssText = "box-sizing:border-box;width:100%;padding:7px 9px;border:1px solid var(--folium-border,#777);border-radius:7px;background:var(--folium-surface,transparent);color:inherit;";
            const commit = () => { const value = def.type === "number" ? Number(input.value) : input.value; if (def.type !== "number" || input.value.trim() !== "") writeValue(def.key, value); };
            input.addEventListener("change", commit); input.addEventListener("blur", commit);
          }
          controls.set(def.key, { input, type: def.type });
          if (def.type !== "boolean") {
            if (def.type !== "select") input.style.cssText = (input.style.cssText || "") + ";box-sizing:border-box;width:100%;padding:7px 9px;border:1px solid var(--folium-border,rgba(128,128,128,.35));border-radius:7px;background:var(--folium-background,var(--folium-surface,transparent));color:inherit;color-scheme:inherit;";
            row.appendChild(input);
          }
          wrap.appendChild(row);
        }
        const keyTitle = document.createElement("div"); keyTitle.textContent = en ? "AI API key (stored locally)" : "AI API 密钥（本机保存）"; keyTitle.style.cssText = "font-size:13px;font-weight:600;margin-top:8px;"; wrap.appendChild(keyTitle);
        const keyHelp = document.createElement("small"); keyHelp.textContent = en ? "Not included in visual-config exports. Local storage is not an OS-encrypted keychain." : "密钥不会写入视觉配置导出；本地存储并非操作系统加密密钥库。"; keyHelp.style.cssText = "opacity:.65;line-height:1.4;"; wrap.appendChild(keyHelp);
        const input = document.createElement("input"); input.type = "password"; input.autocomplete = "new-password"; input.spellcheck = false; input.placeholder = en ? "Paste API key, then Save" : "粘贴 API 密钥后点击保存"; input.style.cssText = "box-sizing:border-box;width:100%;padding:8px 10px;border:1px solid var(--folium-border,#777);border-radius:8px;background:var(--folium-surface,transparent);color:inherit;"; wrap.appendChild(input);
        const buttons = document.createElement("div"); buttons.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;";
        const makeButton = (text) => { const b = document.createElement("button"); b.type = "button"; b.textContent = text; b.style.cssText = "padding:6px 12px;border:1px solid var(--folium-border,#777);border-radius:7px;background:transparent;color:inherit;cursor:pointer;"; return b; };
        const save = makeButton(en ? "Save key" : "保存密钥"), clear = makeButton(en ? "Delete key" : "删除密钥");
        const status = document.createElement("div"); status.style.cssText = "font-size:12px;opacity:.7;";
        save.addEventListener("click", async () => { const key = input.value.trim(); if (!key) { status.textContent = en ? "Enter a key first; empty input will not overwrite it." : "请先输入密钥；留空不会覆盖现有密钥。"; return; } try { await folium.storage.set(API_KEY_STORAGE, key); input.value = ""; status.textContent = en ? "Key saved locally (not displayed)." : "密钥已保存到本机模组存储（不会回显）。"; } catch (e) { status.textContent = en ? "Save failed; check mod storage permissions." : "保存失败，请检查模组存储权限。"; folium.log.warn("API key save failed", String((e && e.message) || e)); } });
        clear.addEventListener("click", async () => { try { await folium.storage.delete(API_KEY_STORAGE); input.value = ""; status.textContent = en ? "Local key deleted." : "已删除本机保存的密钥。"; } catch (e) { status.textContent = en ? "Delete failed." : "删除失败。"; folium.log.warn("API key delete failed", String((e && e.message) || e)); } });
        buttons.append(save, clear); wrap.append(buttons, status); container.appendChild(wrap);
        const refresh = async () => { const values = getValues(); for (const def of settingsSchema) { const item = controls.get(def.key); if (!item) continue; let value = values[def.key] ?? def.defaultValue; if (def.key === "preloadNext" || def.key === "autoAiMemorySupplement") { try { const storageKey = def.key === "preloadNext" ? "si-preload-next-enabled" : "si-auto-ai-memory-supplement"; const saved = await folium.storage.get(storageKey); if (typeof saved === "boolean") value = saved; } catch (_) {} } if (item.type === "boolean") item.input.checked = Boolean(value); else item.input.value = value == null ? "" : String(value); } applyDisable(); };
        // 数据源切到「公开检索」时，AI 相关设置项变灰且不能改；内容长度、栏目开关和翻译保持可用。
        const AI_KEYS = ["aiPreset", "aiBaseUrl", "aiModel", "aiTemperature", "autoAiMemorySupplement", "preloadNext"];
        const applyDisable = () => {
          const values = getValues();
          const isPublic = String(values.source || "baike") === "baike";
          for (const [k, item] of controls) {
            if (!AI_KEYS.includes(k)) continue;
            item.input.disabled = isPublic;
            item.input.style.opacity = isPublic ? ".45" : "";
          }
          input.disabled = isPublic; save.disabled = isPublic; clear.disabled = isPublic;
          input.style.opacity = isPublic ? ".45" : "";
          keyTitle.style.opacity = isPublic ? ".45" : "";
          keyHelp.style.opacity = isPublic ? ".45" : "";
        };
        const sourceCtrl = controls.get("source");
        if (sourceCtrl) sourceCtrl.input.addEventListener("change", applyDisable);
        refresh();
        let unsubscribe = null;
        try { if (access && typeof access.onChange === "function") unsubscribe = access.onChange(refresh); } catch (_) {}
        return () => { if (typeof unsubscribe === "function") unsubscribe(); wrap.remove(); };
      }
    });
    cfgParams = settingsHandle.settings;
  } catch (e) {
    folium.log.warn("settings register failed", String((e && e.message) || e));
  }

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
            const useful = d && !d.error && (d.ai || d.artistIntro || d.songIntro || (d.mb && (d.mb.album || d.mb.year || d.mb.releaseDate)));
            if (useful && !current[key]) current[key] = entry;
          }
          const ok = await saveCache(folium, current);
          // 旧缓存可能含未截断的长正文；只有新缓存写入成功才删除旧键，避免配额/权限失败时丢数据。
          if (ok) await folium.storage.delete("si-cache");
        }
      } catch (e) { folium.log.warn("legacy cache migration failed", String((e && e.message) || e)); }
    })();
    return cacheMigrationPromise;
  };
  const lookupAndCache = async (cfg, artist, title, source, force) => {
    const cacheKey = buildCacheKey(source, artist, title, cfg || {}, curLocale);
    if (!force && inflight.has(cacheKey)) return inflight.get(cacheKey);
    const p = (async () => {
      await migrateLegacyCache();
      const cache = await loadCache(folium);
      const hit = cache[cacheKey];
      const usefulHit = hit && hit.data && !hit.data.error && (hit.data.ai || hit.data.artistIntro || hit.data.songIntro || (hit.data.mb && (hit.data.mb.album || hit.data.mb.year || hit.data.mb.releaseDate)));
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
      return { error: "查询失败：" + String((e && e.message) || e || "未知错误") + "。这不一定代表设备断网；请检查接口地址、服务商状态、访问权限及控制台日志。失败结果不会缓存。" };
    }).finally(() => inflight.delete(cacheKey));
    inflight.set(cacheKey, p);
    return p;
  };

  // 尽可能从播放状态中识别播放列表下一首；不同宿主版本字段名可能不同，因此只做安全探测。
  const findNextSong = (state) => {
    if (!state || typeof state !== "object") return null;
    const candidates = [state.nextSong, state.nextTrack, state.next, state.queueNext, state.upNext, state.nextItem, state.nextMedia, state.upNextTrack, state.playback?.nextSong, state.playback?.nextTrack, state.queue?.next, state.playlist?.next];
    for (const item of candidates) { if (item && typeof item === "object" && (item.title || item.name)) return item; }
    const lists = [state.playlist, state.queue, state.upcoming, state.tracks, state.items, state.playlist?.tracks, state.playlist?.items, state.queue?.tracks, state.queue?.items, state.upcoming?.tracks, state.upcoming?.items, state.playback?.playlist, state.playback?.queue];
    const current = state.song || state.currentSong || state.track || state.currentTrack || state.playback?.song || state.playback?.track;
    for (const list of lists) {
      const arr = Array.isArray(list) ? list : null; if (!arr || !arr.length) continue;
      let idx = Number.isInteger(state.index) ? state.index : Number.isInteger(state.currentIndex) ? state.currentIndex : Number.isInteger(state.playlistIndex) ? state.playlistIndex : Number.isInteger(state.queueIndex) ? state.queueIndex : Number.isInteger(state.playback?.index) ? state.playback.index : -1;
      if (idx < 0 && current) idx = arr.findIndex(x => x && ((current.id != null && x.id === current.id) || (x.title && x.title === current.title && (x.artist || "") === (current.artist || ""))));
      if (idx >= 0 && idx + 1 < arr.length && arr[idx + 1] && (arr[idx + 1].title || arr[idx + 1].name)) return arr[idx + 1];
    }
    return null;
  };
  let preloadLastKey = "";
  const preloadNextTrack = async () => {
    try {
      const cfg = cfgParams && typeof cfgParams.get === "function" ? cfgParams.get() : {};
      let preloadEnabled = cfg.preloadNext; try { const saved = await folium.storage.get("si-preload-next-enabled"); if (typeof saved === "boolean") preloadEnabled = saved; } catch (_) {}
      if (!preloadEnabled || cfg.source !== "ai") return;
      const state = folium.playback.getState();
      const next = findNextSong(state);
      if (!next) return;
      const title = String(next.title || next.name || "").trim();
      const artist = String(next.artist || next.artistName || "").trim();
      if (!title) return;
      const key = artist + "\u0001" + title;
      if (key === preloadLastKey) return;
      preloadLastKey = key;
      // 后台预加载只填充缓存，不更新当前面板，也不阻断播放。
      const result = await lookupAndCache(cfg, artist, title, "ai", false);
      if (result && result.error) folium.log.warn("next-track preload failed", result.error);
    } catch (e) { folium.log.warn("next-track preload failed", String((e && e.message) || e)); }
  };

  // 预加载监听必须独立于歌曲资料面板挂载；否则面板关闭时切歌不会触发预加载。
  // 延迟读取状态，给宿主时间更新当前曲目与播放队列。
  let preloadEventOff = null;
  try {
    preloadEventOff = folium.events.on("playback.songChanged", () => {
      setTimeout(() => { preloadNextTrack(); }, 350);
    });
  } catch (e) { folium.log.warn("next-track preload event registration failed", String((e && e.message) || e)); }

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

      // ---- 自动 AI 记忆补充辅助 ----
      const isAutoMemoryEnabled = async (cfg) => {
        let v = !!(cfg && cfg.autoAiMemorySupplement);
        try { const saved = await folium.storage.get("si-auto-ai-memory-supplement"); if (typeof saved === "boolean") v = saved; } catch (_) {}
        return v;
      };
      const missingSections = (data) => {
        if (!data || !data.ai) return false;
        const a = data.ai, s = a.song || {}, ar = a.artist || {};
        return ![s.writers, s.composers, s.arranger].some((v) => String(v || "").trim()) ||
          !String(ar.bio || "").trim() || !String(ar.representativeWorks || "").trim() || !String(ar.career || "").trim() ||
          !String(s.origin || "").trim() || !String(s.source || "").trim() || !String(s.listeningNotes || "").trim();
      };
      const memoryCfgOf = (cfg) => ({ ...(cfg || {}), source: "ai", aiMemoryOnly: true, contentDetail: "detailed" });
      const mergeMemoryInto = (data, memData) => {
        if (!data || !data.ai || !memData || !memData.ai) return data;
        const out = JSON.parse(JSON.stringify(data)); // 深拷贝，避免污染缓存里的原对象
        const mem = memData.ai || {};
        const merge = (dst, src) => {
          for (const [k, v] of Object.entries(src || {})) {
            if (!v || !String(v).trim()) continue;
            if (!String((dst && dst[k]) || "").trim()) dst[k] = v; // 只补缺失字段
          }
        };
        merge(out.ai.song || (out.ai.song = {}), mem.song || {});
        merge(out.ai.artist || (out.ai.artist = {}), mem.artist || {});
        return out;
      };

      // 内容替换：先隐藏 → 测高 → 高度平滑过渡（速度恒定）→ 淡入显示。
      // 过渡期间 body 裁剪溢出，保证新内容不会在高度过渡中提前溢出可见。
      // 竞态防护：每轮动画用自增序号 + 单一 timer，旧轮回调过期即忽略，避免快速切歌时旧定时器清理新内容。
      let animSeq = 0;
      let animTimer = null;
      const applyContent = (html) => {
        animSeq += 1;
        if (animTimer) { clearTimeout(animTimer); animTimer = null; }
        const mySeq = animSeq;
        let ran = false;
        const settle = (fn) => {
          if (ran || animSeq !== mySeq) return; // 已执行过或已是过期轮次，直接忽略
          ran = true;
          if (animTimer) { clearTimeout(animTimer); animTimer = null; }
          fn();
        };
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
          const done = () => settle(() => {
            body.style.transition = "";
            body.style.opacity = "";
            body.style.overflow = "";
            root.style.height = "";
            root.style.transition = "";
            lastPanelH = root.offsetHeight; // 记录本次面板高度，供下次挂载作过渡起点
          });
          body.addEventListener("transitionend", done, { once: true });
          animTimer = setTimeout(done, 320);
        };
        const finish = () => settle(() => {
          root.style.height = "";
          root.style.transition = "";
          show();
        });
        if (Math.abs(h1 - h0) > 2) {
          const diff = Math.abs(h1 - h0);
          const dur = Math.min(0.5, Math.max(0.12, diff / 800)); // 速度恒定
          void root.offsetWidth; // 强制重排
          root.style.transition = `height ${dur}s ease`;
          root.style.height = h1 + "px";
          root.addEventListener("transitionend", finish, { once: true });
          animTimer = setTimeout(finish, dur * 1000 + 100);
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
        const cacheKey = buildCacheKey(cfg.source || "baike", artist, title, cfg, curLocale);
        curCacheKey = cacheKey;
        const autoEnabled = String(cfg.source || "baike") === "ai" && await isAutoMemoryEnabled(cfg);

        const cache = await loadCache(folium);
        const hit = cache[cacheKey];
        const usefulCachedData = hit && hit.data && !hit.data.error &&
          (hit.data.ai || hit.data.artistIntro || hit.data.songIntro || (hit.data.mb && (hit.data.mb.album || hit.data.mb.year || hit.data.mb.releaseDate)));
        if (!force && usefulCachedData && Date.now() - hit.ts < CACHE_TTL) {
          // 旧缓存命中：若启用自动记忆补充且缺少栏目 → 资料与记忆补充并行，都结束才显示
          if (autoEnabled && missingSections(hit.data)) {
            applyContent('<div class="si-load">正在查询资料…</div>');
            const memResult = await lookupAndCache(memoryCfgOf(cfg), artist, title, "ai-memory", false);
            if (curKey !== key) return;
            const merged = mergeMemoryInto(hit.data, memResult);
            if (merged !== hit.data && !merged.error) {
              const cache2 = await loadCache(folium);
              cache2[cacheKey] = { ts: Date.now(), data: merged, source: cfg.source || "ai" };
              await saveCache(folium, cache2);
            }
            applyContent(renderCard(song, merged, cfg.source || "ai", true));
            bindRegen(); bindMemorySupplement();
            return;
          }
          applyContent(renderCard(song, hit.data, hit.source || cfg.source || "baike", true));
          bindRegen(); bindMemorySupplement();
          return;
        }

        // 未命中：显示占位，再查询
        applyContent('<div class="si-load">正在查询资料…</div>');
        // 自动记忆补充：资料检索与记忆补充同时进行，两边都结束才显示
        const tasks = [lookupAndCache(cfg, artist, title, cfg.source || "baike", !!force)];
        if (autoEnabled) tasks.push(lookupAndCache(memoryCfgOf(cfg), artist, title, "ai-memory", false));
        const [data, memData] = await Promise.all(tasks);
        if (curKey !== key) return; // 查询期间已换歌，丢弃结果
        let finalData = data;
        if (autoEnabled && memData && !memData.error && memData.ai) {
          finalData = mergeMemoryInto(data, memData);
          if (!finalData.error) {
            const cache3 = await loadCache(folium);
            cache3[cacheKey] = { ts: Date.now(), data: finalData, source: cfg.source || "ai" };
            await saveCache(folium, cache3);
          }
        }
        applyContent(renderCard(song, finalData, cfg.source || "baike", false));
        bindRegen(); bindMemorySupplement();
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

      const bindMemorySupplement = () => {
        const b = body.querySelector(".si-memory-supplement");
        if (!b) return;
        b.addEventListener("click", async () => {
          const st = folium.playback.getState(); const song = st && st.song;
          if (!song || !song.title) return;
          const cfg = { ...(cfgParams && cfgParams.get ? cfgParams.get() : {}), source: "ai", aiMemoryOnly: true, contentDetail: "detailed" };
          b.disabled = true; b.textContent = "AI 记忆补充中…";
          try {
            const result = await lookupAndCache(cfg, song.artist || "", song.title, "ai-memory", true);
            if (result && !result.error && result.ai) {
              const cache = await loadCache(folium);
              // 缓存键与当前渲染一致（含语言/长度/翻译/AI 模型等配置），
              // 公开检索回退 AI 时也写回当前显示的数据键，刷新后能看到补充内容。
              const normalKey = curCacheKey || buildCacheKey("ai", song.artist || "", song.title, { ...(cfgParams && cfgParams.get ? cfgParams.get() : {}), source: "ai" }, curLocale);
              const old = cache[normalKey] && cache[normalKey].data;
              if (old && old.ai) {
                const mergeMemory = (dst, src) => {
                  for (const [k, v] of Object.entries(src || {})) {
                    if (v && typeof v === "object" && !Array.isArray(v)) { dst[k] = dst[k] || {}; mergeMemory(dst[k], v); continue; }
                    const generated = String(v || "").trim(); if (!generated) continue;
                    const existing = String(dst[k] || "").trim();
                    if (!existing) dst[k] = generated;
                    else if (!existing.includes(generated.replace(/^【ai 生成】/, ""))) dst[k] = existing + "\n\n" + generated;
                  }
                };
                mergeMemory(old.ai.song || (old.ai.song = {}), result.ai.song || {});
                mergeMemory(old.ai.artist || (old.ai.artist = {}), result.ai.artist || {});
                old.ai = old.ai; old.memorySupplementAdded = true;
                cache[normalKey] = { ts: Date.now(), data: old, source: "ai" };
                await saveCache(folium, cache);
              } else {
                result.memorySupplementAdded = true; cache[normalKey] = { ts: Date.now(), data: result, source: "ai" }; await saveCache(folium, cache);
              }
              // 补充写入缓存后只刷新界面，不再强制重查普通 AI（避免覆盖刚合并的补充内容）
              curKey = null;
              const st2 = folium.playback.getState(); const song2 = st2 && st2.song;
              if (song2 && song2.title) {
                const cache2 = await loadCache(folium);
                const d2 = cache2[curCacheKey] && cache2[curCacheKey].data;
                if (d2) { applyContent(renderCard(song2, d2, "ai", true)); bindRegen(); bindMemorySupplement(); }
              }
            } else { b.disabled = false; b.textContent = "AI 记忆补充"; b.title = (result && result.error) || "补充失败，请检查 AI 设置"; }
          } catch (e) { b.disabled = false; b.textContent = "AI 记忆补充"; folium.log.warn("AI memory supplement failed", String((e && e.message) || e)); }
        });
      };
      // 自动记忆补充已并入 render()（资料与补充并行）；此函数不再使用。
      const regenBtn = (aiDisabled) => '<button type="button" class="si-regen">重新生成</button><button type="button" class="si-regen si-memory-supplement"' + (aiDisabled ? ' disabled title="需切换到 AI 检索后可用"' : '') + '>AI 记忆补充</button>';
      const renderCard = (song, data, source, fromCache) => {
        const cfgNow = (cfgParams && cfgParams.get) ? cfgParams.get() : {};
        const aiDisabled = String(cfgNow.source || "baike") !== "ai";
        const srcLabel = source === "ai" || (data && data.ai) ? (data && data.generatedByAi ? (data.aiAggregated ? "AI 参考检索生成" : "AI 生成，未经检索") : "AI 整理") : ((data && data.sources && data.sources.length) ? data.sources.join("、") : "公开检索");
        const sourceQuery = String(song.title || "") + (song.artist ? " " + song.artist : "");
        const detailMode = (cfgParams && cfgParams.get && cfgParams.get().contentDetail) || "balanced";
        const textLimit = detailMode === "compact" ? 260 : detailMode === "detailed" ? 1200 : 600;
        const section = (title, value, limit) => value ? '<div class="si-sec"><div class="si-sec-t">' + esc(title) + '</div><div class="si-sec-b">' + esc(truncate(String(value), limit || textLimit)) + '</div></div>' : "";
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
          html += regenBtn(aiDisabled);
          html += '<div class="si-foot">暂无可用资料。你可以稍后重试。</div>';
          return html;
        }
        if (data.error) {
          html += '<div class="si-err">' + esc(data.error) + "</div>";
          html += regenBtn(aiDisabled);
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
          if (s.releaseDate) meta.push("发行日期 " + esc(s.releaseDate));
          if (song.source) meta.push(esc(song.source === "local" ? "本地" : song.source));
          if (meta.length) html += '<div class="si-meta">' + meta.join(" · ") + "</div>";
          const bio = cl(ar.bio);
          const honors = cl(ar.honors);
          const career = cl(ar.career);
          const representativeWorks = cl(ar.representativeWorks);
          const songSource = cl(s.source);
          const content = cl(s.content);
          const origin = cl(s.origin);
          const credits = [s.writers && "作词：" + s.writers, s.composers && "作曲：" + s.composers, s.arranger && "编曲：" + s.arranger].filter(Boolean).join("；");
          const genres = String(s.genre || "").split(/[、,，/]/).map((x) => x.trim()).filter(Boolean).slice(0, 5);
          if (genres.length) html += '<div class="si-tags">' + genres.map((g) => '<span class="si-tag">' + esc(g) + '</span>').join("") + '</div>';
          html += section("歌曲简介", content);
          html += section("歌曲创作与发行背景", origin);
          html += section("歌曲出处", songSource);
          if (!cfgParams || !cfgParams.get || cfgParams.get().showCredits !== false) html += section("作曲作词", credits, 360);
          if (!cfgParams || !cfgParams.get || cfgParams.get().showListeningNotes !== false) html += section("聆听提示 · AI 解读", s.listeningNotes, 420);
          html += section("歌手简介", bio);
          if (!cfgParams || !cfgParams.get || cfgParams.get().showArtistDetails !== false) {
            html += section("歌手代表作", representativeWorks);
            html += section("歌手经历", career);
            html += section("主要荣誉", honors, 420);
          }
          if (!bio && !honors && !career && !representativeWorks && !songSource && !origin && !content && !credits && !s.listeningNotes) html += '<div class="si-none">AI 未返回有效内容，可点「重新生成」重试</div>';
          html += regenBtn(aiDisabled);
          html += '<div class="si-foot">' + (data.generatedByAi ? (data.aiAggregated ? "AI 参考公开检索后生成；内容未逐项核实" : "AI 生成，未经检索；内容未核实") : "AI 整理内容仅供参考；来源：" + sourceLinksHtml(data.sources || [], sourceQuery)) + (detailMode === "detailed" ? "。详细挡位中带【AI记忆补充·未经检索核实】标记的文字来自模型自身知识，不属于公开来源。" : "") + '</div>';
          return html;
        }

        // 公开源结果
        const meta = [];
        if (data.mb && data.mb.album) meta.push("专辑 " + esc(data.mb.album));
        if (data.mb && data.mb.year) meta.push(esc(data.mb.year) + " 年");
        if (data.mb && data.mb.releaseDate && data.mb.releaseDate.length > 4) meta.push("发行日期 " + esc(data.mb.releaseDate));
        if (song.album) meta.push("唱片 " + esc(song.album));
        if (song.source) meta.push(esc(song.source === "local" ? "本地" : song.source));
        if (meta.length) html += '<div class="si-meta">' + meta.join(" · ") + "</div>";
        if (data.songIntro) html += section("歌曲介绍" + (data.songSource ? " · " + data.songSource : ""), data.songIntro, textLimit);
        if (data.artistIntro) html += section("歌手简介" + (data.artistSource ? " · " + data.artistSource : ""), data.artistIntro, textLimit);
        if (!data.artistIntro && !data.songIntro && !(data.mb && (data.mb.album || data.mb.year || data.mb.releaseDate))) {
          html += '<div class="si-none">未找到相关资料；失败结果不会缓存，可点击重新生成重试</div>';
        }
        html += regenBtn(aiDisabled);
        html += '<div class="si-foot">来源：' + sourceLinksHtml(data.sources || [], sourceQuery) + '。请查看原页面的署名与许可要求。</div>';
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
    if (typeof preloadEventOff === "function") preloadEventOff();
  };
}
