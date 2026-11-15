# Tick Nav

A minimal, right-side tick-mark navigator for the headings of your Obsidian notes.

每个标题对应右侧的一根短线，当前位置最长最亮，向两侧逐渐变短变暗；悬停或点击可查看标题并平滑跳转。

## Features

- One tick per heading, shown on the right edge of the note.
- The tick for your current position is the longest and brightest; neighbours fade out smoothly by distance.
- Hover (desktop) or tap (mobile) a tick to preview the heading title, click to scroll to it.
- Works in both editing view and reading view, on desktop and mobile.
- Respects `prefers-reduced-motion`.
- Follows your theme colours (uses Obsidian CSS variables).

## Installation

### From a release (manual)

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/Mymyso/obsidian-ticknav/releases/latest).
2. Put them in `<your vault>/.obsidian/plugins/ticknav/`.
3. Reload Obsidian and enable **Tick Nav** in *Settings → Community plugins*.

### With BRAT

Add `Mymyso/obsidian-ticknav` as a beta plugin in [BRAT](https://github.com/TfTHacker/obsidian42-brat).

## Customisation

Tweak the constants at the top of `main.js` (`MIN_W`, `MAX_W`, `SIGMA`) to change tick length and how far the fade reaches. Appearance can be overridden with CSS snippets targeting `.ticknav-tick`.

## License

[MIT](LICENSE)
