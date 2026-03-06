# Shopee Live MCP Server

連接 AIRI 虛擬主播到蝦皮直播聊天室，透過 OpenClaw Browser Relay 讀取觀眾留言並自動回覆推銷商品。

## 架構

```
Chrome (蝦皮直播) ←CDP→ OpenClaw Relay ←HTTP→ shopee-live MCP Server ←stdio→ AIRI 桌面版
```

## 前置需求

1. **OpenClaw Browser Relay** 已安裝並啟動
2. **Chrome 瀏覽器** 已安裝 OpenClaw Extension，並登入蝦皮帳號
3. **Node.js 18+** 已安裝
4. **蝦皮直播** 已在 Chrome 中開啟直播頁面

## 環境設定

複製 `.env.local.example` 或手動建立 `.env.local`：

```env
# OpenClaw 設定（必填）
OPENCLAW_CONTROL_URL=http://127.0.0.1:18791
OPENCLAW_TOKEN=你的OpenClaw_Gateway_Token
OPENCLAW_PROFILE=chrome-work

# LLM 設定（demo-auto-reply 用，選填）
OPENAI_API_KEY=你的API_Key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini

# MCP Server HTTP 模式埠號（選填）
MCP_PORT=8081
```

### 取得 OpenClaw Token

打開 `~/.openclaw/openclaw.json`，找到 `gateway.token` 欄位。

### 取得 Profile 名稱

在同一檔案中找到 `profiles` 陣列，使用已安裝 Extension 的 Chrome profile 名稱。

## 使用方式

### 方式一：AIRI 桌面版連接（MCP stdio）

AIRI 桌面版（Electron）會透過 MCP 協定 spawn 這個 server 作為子進程：

```bash
# AIRI 會自動執行類似這樣的指令：
npx tsx --env-file=.env.local src/stdio.ts
```

在 AIRI 中，AI 可以使用以下 MCP 工具：

| 工具名稱 | 說明 |
|---------|------|
| `shopee_get_messages` | 取得最新聊天訊息 |
| `shopee_send_reply` | 在聊天室發送回覆 |
| `shopee_get_viewers` | 取得觀看人數等數據 |
| `shopee_get_products` | 搜尋/列出商品資料 |
| `shopee_get_product_detail` | 取得單一商品詳情 |

### 方式二：獨立自動回覆機器人

不需要 AIRI 桌面版，直接運行：

```bash
npx tsx --env-file=.env.local demo-auto-reply.ts
```

功能：
- 每 3 秒輪詢蝦皮聊天室
- 偵測到新留言時，呼叫 LLM 生成推銷回覆
- 自動在聊天室發送回覆
- 內建商品資料與推銷 Prompt

未設定 `OPENAI_API_KEY` 時會使用 echo 回覆（把觀眾的話重複一遍）。

### 方式三：HTTP/SSE 模式

```bash
npx tsx --env-file=.env.local src/index.ts
```

啟動 HTTP server，透過 SSE 連接 MCP client。

## 商品資料

編輯 `src/data/products.json` 來修改商品清單。格式：

```json
[
  {
    "id": "product-001",
    "name": "商品名稱",
    "price": 990,
    "currency": "TWD",
    "description": "商品描述",
    "stock": 50,
    "discount": "限時 85 折",
    "keywords": ["關鍵字1", "關鍵字2"]
  }
]
```

## 驗證連接

確認 OpenClaw 可以存取蝦皮頁面：

```bash
# 列出 Chrome 分頁
curl -H "Authorization: Bearer 你的TOKEN" \
  "http://127.0.0.1:18791/tabs?profile=chrome-work"

# 對蝦皮頁面截圖（取得 targetId 後）
curl -H "Authorization: Bearer 你的TOKEN" \
  "http://127.0.0.1:18791/snapshot?profile=chrome-work&targetId=你的TARGET_ID"
```

## 檔案結構

```
services/shopee-live/
├── src/
│   ├── index.ts                 # HTTP/SSE 模式入口
│   ├── stdio.ts                 # Stdio 模式入口（給 AIRI 用）
│   ├── services/
│   │   ├── openclaw-browser.ts  # OpenClaw API 封裝
│   │   ├── chat-parser.ts       # 蝦皮聊天室解析器
│   │   └── chat-poller.ts       # 定時輪詢服務
│   ├── config/
│   │   └── types.ts             # 設定型別
│   └── data/
│       └── products.json        # 商品資料
├── demo-auto-reply.ts           # 獨立自動回覆機器人
├── .env.local                   # 環境變數（不進版控）
└── package.json
```
