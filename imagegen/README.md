# imagegen — 网站视觉素材生成

## 用途

把「网站需要配图」翻成可跑的提示词，借 Codex agent 内置的图像生成工具（`image_gen`）出图，
然后验收、压缩、落盘。覆盖 logo / favicon 源图、吉祥物、og:image 分享图、内页配图、
用户场景真人图、手绘插画、海报与电影感画面。`rankup` 建站流程里「不得出现占位图」「每页独立 og:image 必须有图」
两条红线的执行端就是它。

## 前置条件

- 已安装并登录的 Codex CLI（`codex --version` 能跑，本 Skill 在 0.149.0 上验证）。
- 本机 `sips`（macOS 自带）；`cwebp` 可选（`brew install webp`），页内 WebP 用它；`magick`（ImageMagick）可选，抠透明与修主体占比用它。
- 图像生成走网络，需要 `--sandbox danger-full-access`。

## 一条示例

```bash
mkdir -p <outdir> && cat <outdir>/prompt.md | codex exec --skip-git-repo-check \
  --config model_reasoning_effort="medium" --sandbox danger-full-access \
  -C <outdir> -o <outdir>/final.md 2>/dev/null
```

`prompt.md` 里写：输出目录绝对路径、逐张文件名与描述与尺寸、共享风格块与 hex 调色板、
`No text, no logos, no watermarks`、逃生口（生成不了就明说，不许用占位图代替）、
要求回报每个文件的绝对路径与所用方法。细节与各用途模板见 `SKILL.md`。
