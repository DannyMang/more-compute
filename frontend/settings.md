# Settings Reference

Settings are stored in your browser's localStorage and can be edited via the Settings panel (gear icon in sidebar) or by editing the JSON directly.

## Available Settings

### `theme`
**Type:** `string`
**Default:** `"light"`

Controls the visual theme of the notebook.

Available themes:
- `light` - Clean light theme
- `dark` - VS Code-style dark theme
- `tokyo-night` - Tokyo Night dark theme
- `tokyo-night-storm` - Tokyo Night Storm variant
- `tokyo-night-light` - Tokyo Night light variant
- `night-owl` - Night Owl dark theme
- `night-owl-light` - Night Owl light variant
- `synthwave-84` - Retro synthwave theme
- `one-dark-pro` - One Dark Pro theme

### `metricsCollectionMode`
**Type:** `"on-demand" | "persistent"`
**Default:** `"on-demand"`

Controls how system metrics (CPU, memory, GPU) are collected.

- `on-demand` - Only collect metrics when the Metrics popup is open. Uses less memory.
- `persistent` - Continuously collect metrics in background. Uses more memory but shows historical data.

### `claudeAutoPreview`
**Type:** `boolean`
**Default:** `false`

Controls whether Claude AI's proposed code edits are automatically previewed in notebook cells.

- `false` - Edits only appear in the Claude panel. You manually copy or apply them.
- `true` - Edits auto-preview directly in cells with diff highlighting and Keep/Undo buttons.

## Example Configuration

```json
{
  "theme": "tokyo-night",
  "metricsCollectionMode": "on-demand",
  "claudeAutoPreview": false
}
```

## Resetting Settings

Click "Reset to Defaults" in the Settings panel to restore all settings to their default values.
