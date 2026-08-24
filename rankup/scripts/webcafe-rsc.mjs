/**
 * 用途：解析 Next.js App Router 的 RSC flight payload，把服务端渲染页面的原始
 *       props 对象抠出来。new.web.cafe 的经验/帖子/教程三块内容**没有 JSON API**，
 *       只能走这条路。不是可执行脚本，被 webcafe-forum.mjs import。
 * 依赖：无。
 * 已验证日期：2026-08-24
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 【为什么值得解析 flight，而不是去读 DOM】
 * flight 里是**服务端的原始对象**：`uid`、`read_count`、`like_count`、`tip_amount`、
 * `totalPage` 一次拿全。DOM 上这些要么被格式化过（「还没有人阅读」），要么根本不存在。
 *
 * 更硬的一条理由：**`/topics` 的条目根本不是 `<a>`**。实测整页只有 14 个 `a[href]`
 * （全是导航和分页），94 个帖子卡片是 `div[class*=cursor-pointer]`，靠 onClick 走
 * `router.push`，**`uid` 在 DOM 里压根不存在**。所以读 DOM 在这个页面上不是「脆」，
 * 是**结构性拿不到详情页 URL**。
 *
 * 【四步，缺一步就会静默拿到错东西】
 *   1. 拼 flight —— `self.__next_f.push([1,"<片>"])` 一串，**拼起来才是完整流**
 *   2. 定位 props —— 锚点 `["$","$L<hex>",null,{"locale":`，然后**大括号配平**切片
 *   3. 收外联文本 —— `<id>:T<hex长度>,<正文>`，长度是**十六进制字节数**
 *   4. deref —— 把 `"$1c"` 换回正文、`"$D..."` 去前缀当日期
 *
 * 【三个脆弱点，全是静默失败】
 *
 * 一、**绝对不能按 `\n` 切 flight 行，而且这个坑匿名测试时看不出来。**
 *     匿名 `markdown` 是空串，按行切能 parse 成功，看着挺好；一登录，正文里的真实
 *     换行让行切彻底崩掉（实测出现过 `# 8、上站！上站9:["$","$L1b",...` 这种
 *     一行里既有正文又有下一个 row header 的情况），`pageProps` 直接返回 null。
 *     必须用 `balancedSlice` 做字符串感知的大括号配平。
 *
 * 二、**长字符串会被外联成引用。** 教程正文不在 props 里，props 里是
 *     `"markdown":"$1c"`，真身在 `1c:T<hexlen>,` 行。不做第 3、4 步会拿到
 *     3 个字符的 `"$1c"` 而不是 4000 字正文，**且不报错**。
 *     `T` 后面是**字节数**，必须先 TextEncoder 再按字节切——中文按字符切会截错位。
 *
 * 三、**锚点要选对，否则抓到兄弟对象。** 只匹配 `["$","$L<hex>",null,{` 太宽，
 *     会命中 Next.js 的路由外壳；只加 `{"locale":` 又会命中**列表项自己**
 *     （列表项也带 `locale`）。可用判据：候选对象有 `locale` 且**没有 `id` 键**
 *     ——页面 props 没有 `id`，列表项一定有。
 */

/** 把散落的 flight 分片拼成完整流。单独看任何一片都可能把字符串从中间切断。 */
export function joinFlightFromHTML(html) {
  const re = /self\.__next_f\.push\(\[1,\s*("(?:[^"\\]|\\.)*")\s*\]\)/g;
  const parts = [];
  let m;
  while ((m = re.exec(html))) {
    try {
      parts.push(JSON.parse(m[1]));
    } catch {
      /* 坏片跳过，别让一片毁掉整篇 */
    }
  }
  return parts.join("");
}

/**
 * 从 `s[i]`（必须是 `{`）开始做**字符串感知**的大括号配平切片。
 * 「字符串感知」是关键：正文里的 `{` `}` 不能参与配平，否则切出来的片段 parse 必失败。
 */
export function balancedSlice(s, i) {
  let depth = 0, inStr = false, esc = false;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(i, j + 1);
    }
  }
  return null;
}

/** 从 flight 里找出页面级 props 对象（不是列表项）。找不到返回 null。 */
export function pageProps(flight) {
  const out = [];
  const re = /\["\$","\$L[0-9a-f]+",(?:null|"[^"]*"),\{"locale":/g;
  let m;
  while ((m = re.exec(flight))) {
    const i = m.index + m[0].lastIndexOf("{");
    const raw = balancedSlice(flight, i);
    if (!raw) continue;
    try {
      const o = JSON.parse(raw);
      // 页面 props 没有 `id`，列表项一定有——这是区分两者唯一可靠的判据。
      if (!o.buildId && !("id" in o)) out.push(o);
    } catch {
      /* 切出来 parse 不了就不是我们要的 */
    }
  }
  out.sort((a, b) => Object.keys(b).length - Object.keys(a).length);
  return out[0] || null;
}

/**
 * 收集被外联的长文本行：`<id>:T<hex字节长>,<正文>`。
 *
 * **必须顺序扫描，不能用正则找行首。** 这是实测出来的：一条 `T` 行的正文
 * **不保证以换行结尾**，下一行的行头会直接粘在上一条正文的最后一个字上——
 *
 *     ……新站又是暴死结局。1b:T1ba4,效果：![image.png](……
 *
 * 用 `/(?:^|\n)([0-9a-f]+):T([0-9a-f]+),/` 去匹配，这个 `1b` 因为前面没有 `\n`
 * 就被漏掉了。漏掉的后果不是报错：`deref` 找不到 `1b` 就把 `"$1b"` **原样返回**，
 * 调用方拿到一个 3 个字符的字符串当正文。实测 `/experiences/6` 上 2 条帖子
 * （各 7KB / 8.9KB 正文）就是这么丢的，91 条里丢 2 条，全程 exit 0。
 *
 * 反过来也不能把 `\n` 前缀去掉了事——正文里出现 `1b:T1ba4,` 这种串会被误当行头。
 * 唯一可靠的读法是**按协议自己的长度字段走**：`T` 行读掉声明的字节数，
 * 读完的位置就是下一行行头，别的行读到换行为止。
 *
 * 全程在字节上做。长度是 UTF-8 字节数，中文一个字 3 字节，按字符切会截到三分之一，
 * 而且截出来还是合法字符串，不报错。
 */
export function textRows(flight) {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const b = enc.encode(flight);
  const out = {};
  const NL = 10, COLON = 58, COMMA = 44, T = 84;
  const isHex = (c) => (c >= 48 && c <= 57) || (c >= 97 && c <= 102);

  let pos = 0;
  const toNextLine = (from) => {
    const nl = b.indexOf(NL, from);
    return nl === -1 ? b.length : nl + 1;
  };

  while (pos < b.length) {
    let i = pos;
    while (i < b.length && isHex(b[i])) i++;
    // 行头必须是 `<十六进制id>:`，且 id 非空。不符合就整行跳过。
    if (i === pos || i >= b.length || b[i] !== COLON) {
      pos = toNextLine(pos);
      continue;
    }
    const id = dec.decode(b.slice(pos, i));
    i++; // 吃掉 ':'
    if (b[i] !== T) {
      pos = toNextLine(i);
      continue;
    }
    i++; // 吃掉 'T'
    let j = i;
    while (j < b.length && isHex(b[j])) j++;
    if (j === i || b[j] !== COMMA) {
      pos = toNextLine(i);
      continue;
    }
    const len = parseInt(dec.decode(b.slice(i, j)), 16);
    const bodyStart = j + 1;
    const bodyEnd = Math.min(bodyStart + len, b.length);
    out[id] = dec.decode(b.slice(bodyStart, bodyEnd));
    // 正文读完就是下一行行头；有换行就顺手吃掉，没有也照样往下走。
    pos = b[bodyEnd] === NL ? bodyEnd + 1 : bodyEnd;
  }
  return out;
}

/** 把 props 里的引用换回真值：`"$1c"`→正文，`"$D..."`→ISO 日期，`"$undefined"`→undefined。 */
export function deref(v, tr) {
  if (typeof v === "string") {
    if (v.startsWith("$D")) return v.slice(2);
    if (v === "$undefined") return undefined;
    if (/^\$[0-9a-f]+$/.test(v)) return tr[v.slice(1)] ?? v;
    if (v.startsWith("$$")) return v.slice(1); // 转义过的字面 $
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => deref(x, tr));
  if (v && typeof v === "object") {
    const o = {};
    for (const k in v) o[k] = deref(v[k], tr);
    return o;
  }
  return v;
}

/** 一步到位：HTML → 解引用后的页面 props。拿不到返回 null。 */
export function propsFromHtml(html) {
  const flight = joinFlightFromHTML(html);
  if (!flight) return null;
  const props = pageProps(flight);
  if (!props) return null;
  return deref(props, textRows(flight));
}
