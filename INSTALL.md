# sdd-loop Installation Guide

## 1. Extract

Put the sdd-loop folder anywhere, e.g. D:\Tools\sdd-loop

## 2. Configure opencode.json

In your OpenCode config directory's opencode.json:

1) Add the extracted directory to the plugin array:

```jsonc
{
  "plugin": [
    // keep existing plugins...
    "D:\\Tools\\sdd-loop"
  ]
}
```

2) Check sdd-loop.json inside the plugin folder. Verify the preset and model names match YOUR provider config:

- Top-level "preset" field: choose "deepseek" or "volcengine"
- Each agent's "model" field: must be a provider + model name you have configured

Example (volcengine):

```jsonc
{
  "preset": "volcengine",
  "presets": {
    "volcengine": {
      "sdd-loop": { "model": "volcengine-plan/deepseek-v4-pro", "variant": "high" }
    }
  }
}
```

## 3. Restart OpenCode

After restart, switch to sdd-loop with /agent. Sub-agents (spec-writer, researcher, scout, implementer, reviewer, ui-designer) are callable only by sdd-loop and will NOT appear in the agent switcher.

## 4. If the plugin fails to load

- Make sure node_modules exists in the folder (or run 'bun install' there)
- Make sure the plugin path in opencode.json is correct (absolute path or file:// prefix)
- Check OpenCode startup logs for plugin load errors
