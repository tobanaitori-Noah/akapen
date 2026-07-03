# AkaPen

[日本語](./README.md) | English

You read a draft your AI wrote and think: "Close. Really close. But it doesn't sound like me, and my own thoughts aren't in it."

So you rewrite the prompt, regenerate, and it still lands somewhere slightly off. The text is decent overall — it's the dozens of small fixes that hurt, and spelling out each one in a prompt gets old fast.

Sound familiar?

What's actually happening is a simple feedback loop: you mark up the AI's output and hand it back. The lighter that loop runs, the faster the output converges on your own voice. AkaPen is an editor built to make that loop as short as possible — turning "the AI's writing" into your writing.

Deletions get a red strikethrough, insertions appear in red, and comments get a highlighter with a margin note. The operations feel like marking up paper with a red pen, while under the hood every edit is recorded as structured data an LLM can parse precisely. Your review is exported as a separate Markdown file (`.akapen.md`) you can hand straight to any AI.

![Review screen](https://raw.githubusercontent.com/tobanaitori-Noah/akapen/main/screenshot.png)

Edits are structured in CriticMarkup — a notation that marks the kind and range of each change, like `{--text--}` for deletions and `{++text++}` for insertions. Claude Code, Codex, or any LLM agent that reads CriticMarkup understands exactly what to change and where. No more writing long correction instructions into a prompt box.

Everything runs locally; nothing is sent to an external server. AkaPen doesn't depend on any particular LLM service, so pair it with whatever agent you like.

A blogger polishing an AI draft into their own style. A novelist tuning a line of dialogue word by word. Anyone straightening out a document's structure and tone. In every case the move is the same: mark it up, hand it back. The AI's writing becomes yours.

## Installation

AkaPen is distributed as a Node.js package.
If you have Node.js, one command installs it.

### 1. Install Node.js

AkaPen requires Node.js 18 or later.

If you don't have it yet, download the LTS build from the official site ( https://nodejs.org/ ) and run the installer.

Then confirm it in a terminal — if a version prints, you're ready:

```bash
node -v
```

How to open a terminal:
- Mac: press ⌘+Space and type "Terminal"
- Windows: open the Start menu and type "PowerShell"

### 2. Install AkaPen

```bash
npm install -g akapen
```

### 3. Launch

```bash
akapen ./draft.md
```

A local server starts and the review screen opens in your browser.
Omit the file path to pick a file from the in-browser file picker.

## Review operations

- **Delete**: select text and hit the delete button. Shown as a red strikethrough.
- **Insert**: just type. Shown in red.
- **Comment**: select text and attach a note. Shown as a highlight with a margin note.
- **Overall instructions**: add guidance that applies to the whole document.
- **View switch**: toggle between preview (WYSIWYG) and source (raw Markdown editing).

Your edits are saved automatically.
Close the tab mid-review and you can pick up where you left off.

Press **Save** and a `.akapen.md` file is written next to the original.
Use **Save As** to change the destination or file name.

## Output format

```markdown
{++inserted text++}
{==target text==}{>>comment or instruction<<}
```

Reviews are recorded in CriticMarkup.
Claude Code, Codex, and any LLM agent that reads CriticMarkup can process the file as is.

## Example workflow

```
1. An LLM agent drafts a .md file
2. Open it with: akapen ./draft.md — and mark it up
3. Save → draft.akapen.md is written
4. Hand the .akapen.md back to the agent to apply your edits
```

AkaPen is not tied to any specific LLM service.

If you use Claude Code, run `akapen --install-skill` to install the companion skill.
After that, saying "open this in AkaPen" or "apply my review" is enough — the agent handles launch and edit application for you.

## License

AkaPen Source-Available License

- **Personal, non-commercial use**: free.
- **Commercial use**: any revenue-generating use requires a paid license.
- **One license per person**: no transfer or sharing.
- **No redistribution**: no copying, bundling, or embedding into other services.

See [LICENSE](./LICENSE) for details.

## Paid features

Available with a Standard or Supporter license.
On the Free plan the buttons are still visible; pressing one opens the plan guide.

- **Tabs**: open multiple .md files side by side and review across them. Handy for serialized posts or multi-chapter drafts.
- **Comment templates**: register the notes you use most and insert them from the comment box in one tap.
- **Export format settings**: customize how files are written out, such as the output file name pattern.

## Plans

| | Free | Standard | Supporter |
|---|---|---|---|
| Core features | ✓ | ✓ | ✓ |
| Usage | personal, hobby | commercial OK | commercial OK |
| Future updates and added features | — | ✓ | ✓ |
| Concurrent devices | — | 2 | 4 |

Standard and Supporter are functionally identical.
The only difference is the number of concurrent devices.
Supporter is for people who want to back the developer.

Purchase and manage your license from the in-app settings panel.

## Requirements

- Node.js 18+
- macOS, Windows, Linux
- Chrome, Firefox, Safari, Edge

## Changelog

### v0.3.0 (2026-07-03)

All plans (Free / Standard / Supporter):

- Night mode. Light / dark / auto, with auto following the OS theme
- English support. Choose a language on first launch, switch anytime in settings
- Drag & drop. Drop a .md file onto the welcome screen to open it
- Bundled Claude Code skill. Install with `akapen --install-skill`
- `akapen --version` prints the installed version
- UI refresh. Polished the opening, settings panel, motion, and typography
- Button renamed from "Done" to "Save", with "Save As" added

Standard / Supporter:

- Tabs. Open multiple .md files and review across them
- Comment templates. Register frequent notes and insert them instantly
- Export format settings. Customize the output file name pattern and more

Fixes:

- Fixed broken rendering of comments that span a heading
- Fixed popup buttons sometimes ignoring the first click
- Added server-side license checks to paid-feature APIs

### v0.2.0 (2026-06-28)

- First public release. Core review operations (delete, insert, comment), overall instructions, preview/source switch, autosave, font size adjustment, license activation
