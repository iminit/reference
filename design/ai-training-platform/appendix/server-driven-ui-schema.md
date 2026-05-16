# 附录 · Server-Driven UI JSON Schema

设计意图见 `../iteration-4-tech-hardening.md § 4`。

## 1. 顶层结构

```typescript
type SduiPayload = {
  version: '1.0'                          // 强制版本号
  theme: ThemeSpec
  layout: LayoutKind
  input: InputSpec
  guide: GuideSpec
  validation: ValidationSpec
  hints?: HintSpec[]
  metadata?: Record<string, unknown>      // 不影响渲染的辅助数据
}
```

## 2. ThemeSpec

```typescript
type ThemeSpec = {
  accent: 'peach' | 'sky' | 'sun' | 'coral'         // 4 选 1，对应 V2 color token
  icon: AiToolIconKey                                  // 闭集，见下
  background?: 'paper' | 'gradient-sunrise'          // 默认 paper
  mascot_mood?: 'idle' | 'thinking' | 'cheering'     // 默认 idle
}

type AiToolIconKey =
  | 'chatgpt' | 'claude' | 'perplexity' | 'gemini'
  | 'midjourney' | 'canva' | 'krea'
  | 'elevenlabs' | 'otter' | 'notebooklm'
  | 'gamma' | 'tome'
  | 'zapier' | 'make' | 'coze' | 'dify'
  | 'devin' | 'manus'
  | 'generic-ai'                                       // 兜底
```

## 3. LayoutKind

```typescript
type LayoutKind =
  | 'single-input'        // 1 个输入框（最常用）
  | 'split-prompt-input'  // 左侧"一键复制提示词"，右侧输入框
  | 'multi-step'          // 分步引导，每步一个输入
```

## 4. InputSpec

```typescript
type InputSpec =
  | TextInput
  | TextareaInput
  | UrlInput
  | ImageUrlInput
  | TableInput
  | MultiInput

type TextInput = {
  kind: 'text'
  maxLen: number              // 必填
  placeholder: string
}

type TextareaInput = {
  kind: 'textarea'
  maxLen: number              // 必填
  minLen?: number
  placeholder: string
  monospace?: boolean         // 提示词类内容
}

type UrlInput = {
  kind: 'url'
  allowedHosts?: string[]     // 白名单，空表示任意 URL
  placeholder: string
}

type ImageUrlInput = {
  kind: 'image_url'
  allowedHosts?: string[]     // 通常限 ['cdn.midjourney.com', 'oaiusercontent.com', ...]
  previewEnabled: boolean
}

type TableInput = {
  kind: 'table'
  columns: { key: string; label: string; required: boolean }[]
  minRows?: number
  maxRows?: number
}

type MultiInput = {
  kind: 'multi'
  fields: Array<{
    key: string
    label: string
    field: TextInput | TextareaInput | UrlInput | ImageUrlInput
  }>
  // 不允许嵌套 multi
}
```

## 5. GuideSpec

```typescript
type GuideSpec = {
  copy_paste_template?: string          // "一键复制"按钮的内容（支持 {{var}} 变量）
  template_variables?: string[]          // 允许的变量名（白名单），如 ['participant.display_name']
  example?: string                       // "示例答案"折叠区
  warning?: string                       // 新手陷阱提示
  external_link?: {
    url: string
    label: string                       // "在新窗口打开 ChatGPT →"
  }
}
```

## 6. ValidationSpec

```typescript
type ValidationSpec = {
  on_submit: ValidationRule[]
  on_blur?: ValidationRule[]
}

type ValidationRule =
  | { kind: 'required' }
  | { kind: 'min_len', value: number, message: string }
  | { kind: 'max_len', value: number, message: string }
  | { kind: 'regex', pattern: string, message: string }
  | { kind: 'url_host', allowed: string[], message: string }
  | { kind: 'no_pii', message: string }   // 检测身份证/手机号
```

## 7. HintSpec

```typescript
type HintSpec = {
  trigger: HintTrigger
  message: string
  emoji?: string
  dismissable: boolean
}

type HintTrigger =
  | { kind: 'time_in_state', sec: number }      // 进入 OPEN 状态 N 秒后显示
  | { kind: 'input_empty_for_sec', sec: number }
  | { kind: 'submission_count_lt', count: number }  // 已提交人数小于 N
  | { kind: 'before_close_sec', sec: number }       // 倒计时还剩 N 秒
```

## 8. 完整示例：Node 1 (AI 自我介绍)

```json
{
  "version": "1.0",
  "theme": {
    "accent": "peach",
    "icon": "chatgpt",
    "background": "paper",
    "mascot_mood": "cheering"
  },
  "layout": "split-prompt-input",
  "input": {
    "kind": "text",
    "maxLen": 200,
    "placeholder": "把 AI 的回答粘贴到这里…"
  },
  "guide": {
    "copy_paste_template": "你是一个热情的活动主持人，请用 50 字以内、有趣的语气，介绍一位叫做 \"{{participant.display_name}}\" 的 AI 学习者，让 ta 即将出场。",
    "template_variables": ["participant.display_name"],
    "warning": "直接粘贴上面这段就好，把 AI 的回答原样粘回这里。",
    "external_link": {
      "url": "https://chat.openai.com",
      "label": "在新窗口打开 ChatGPT →"
    }
  },
  "validation": {
    "on_submit": [
      { "kind": "required" },
      { "kind": "min_len", "value": 5, "message": "看起来太短啦，再多写几个字？" },
      { "kind": "max_len", "value": 200, "message": "超过 200 字了，记得 AI 的回答应该在 50 字内哦" }
    ]
  },
  "hints": [
    {
      "trigger": { "kind": "time_in_state", "sec": 30 },
      "emoji": "💡",
      "message": "提示：先点'一键复制提示词'按钮 → 切到 ChatGPT 粘贴 → AI 回答再粘回这里",
      "dismissable": true
    },
    {
      "trigger": { "kind": "before_close_sec", "sec": 15 },
      "emoji": "⏰",
      "message": "还有 15 秒就要关闭提交了，记得 Ctrl+V 一下！",
      "dismissable": false
    }
  ]
}
```

## 9. 完整示例：Node 11 (视觉咒语)

```json
{
  "version": "1.0",
  "theme": {
    "accent": "sky",
    "icon": "midjourney",
    "background": "gradient-sunrise",
    "mascot_mood": "thinking"
  },
  "layout": "multi-step",
  "input": {
    "kind": "multi",
    "fields": [
      {
        "key": "prompt_text",
        "label": "你的视觉提示词（包含：主体/环境/光线/角度/风格）",
        "field": {
          "kind": "textarea",
          "maxLen": 1000,
          "minLen": 50,
          "placeholder": "示例：a modern minimalist home office, soft morning light from left window, low angle wide shot, photo realistic, shot on Hasselblad, --ar 16:9",
          "monospace": true
        }
      },
      {
        "key": "image_url",
        "label": "你生成的图片链接",
        "field": {
          "kind": "image_url",
          "allowedHosts": ["cdn.midjourney.com", "cdn.discordapp.com", "oaiusercontent.com", "cdn.openai.com", "img.canva.com"],
          "previewEnabled": true
        }
      }
    ]
  },
  "guide": {
    "warning": "Midjourney 的图必须公开（在 Discord 中右键→链接复制）。Canva 用户用'分享→公开链接'。",
    "example": "见任务卡右侧 4 张示范图（鼠标悬停查看 prompt）",
    "external_link": {
      "url": "https://www.midjourney.com/explore",
      "label": "打开 Midjourney →"
    }
  },
  "validation": {
    "on_submit": [
      { "kind": "required" },
      { "kind": "url_host", "allowed": ["cdn.midjourney.com", "cdn.discordapp.com", "oaiusercontent.com", "cdn.openai.com", "img.canva.com"], "message": "图片链接需来自 Midjourney/ChatGPT/Canva 等被支持的域名" }
    ]
  },
  "hints": [
    {
      "trigger": { "kind": "time_in_state", "sec": 60 },
      "emoji": "🎨",
      "message": "好的视觉咒语 ≈ 主体 + 环境 + 光线 + 视角 + 风格关键词，缺一个都会让 AI 自由发挥",
      "dismissable": true
    }
  ]
}
```

## 10. 渲染器实现要求

### 10.1 模板变量替换

`guide.copy_paste_template` 渲染时：

```typescript
function renderTemplate(template: string, vars: { [k: string]: string }, allowedKeys: string[]) {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    if (!allowedKeys.includes(key.trim())) {
      console.warn('Template var not in whitelist:', key)
      return ''
    }
    return vars[key.trim()] ?? ''
  })
}
```

**安全性**：白名单之外的变量名无效，避免 SDUI 投毒（如 `{{auth.token}}`）。

### 10.2 容错

任何 SDUI 解析失败必须 fallback 到最朴素 UI：

```tsx
<ErrorBoundary fallback={<FallbackInput placeholder="请输入你的答案" />}>
  <SduiRenderer payload={node.sdui_payload} />
</ErrorBoundary>
```

### 10.3 验收测试

每次 SDUI Schema 修改必须通过：

```
✅ JSON Schema validator 通过（ajv）
✅ 渲染 Node 1, 11, 16, 20 四个代表性 SDUI 无 console.error
✅ 不允许的 URL host 被正确拒绝
✅ template_variables 白名单生效（恶意变量被屏蔽）
✅ 所有 hint trigger 类型在视觉测试中均有触发示例
```

## 11. 版本迁移策略

**V1.0 → V1.1（兼容）**：
- 仅可加新字段，不可删/改类型
- 旧客户端遇到新字段忽略即可

**V1.x → V2.0（破坏性）**：
- 主版本号变更需要前端发新版本
- 后端可同时支持 V1 和 V2（按 payload.version 路由）
- 老 event 用 V1 渲染，新建 event 用 V2

## 12. 教研后台的可视化编辑

教研不应该手写 JSON。Retool 后台提供：

```
┌────────────────────────────────────────┐
│  节点编辑器                              │
├────────────────────────────────────────┤
│                                         │
│  阶段：[icebreak ▾]   难度：[★★★▾]      │
│  时长：[300 秒]    主推工具：[ChatGPT▾]  │
│                                         │
│  题目（Markdown）：                       │
│  ┌──────────────────────────────┐      │
│  │ ...                          │      │
│  └──────────────────────────────┘      │
│                                         │
│  输入类型：(o) textarea  ( ) url        │
│                                         │
│  最大字数：[1500]                        │
│                                         │
│  ☑ 启用"一键复制提示词"                  │
│  提示词模板：                             │
│  ┌──────────────────────────────┐      │
│  │ 你是 {{participant.dis…}}    │      │
│  └──────────────────────────────┘      │
│                                         │
│  [预览] [保存草稿] [发布]                │
└────────────────────────────────────────┘
```

后台保存时把表单数据序列化为 SDUI JSON，前端按版本号渲染。
