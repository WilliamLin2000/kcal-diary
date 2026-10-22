// 熱量日記：拍照辨識後端（Cloudflare Worker）
// 收到前端傳來的照片 → 呼叫 Claude 視覺模型 → 回傳食物清單與估計營養素
import Anthropic from '@anthropic-ai/sdk';

const DEFAULT_MODEL = 'claude-opus-5-5';
const MAX_IMAGE_BASE64 = 5_000_000; // 約 3.7MB 圖片，前端已縮到 1024px，正常遠小於此
const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
// 支援伺服器端「拒答自動改用其他模型」的模型
const FALLBACK_MODELS = ['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-1'];

const SYSTEM = `你是台灣的營養估算助手。使用者會傳來一張餐點照片，請辨識照片中每一樣食物並估算營養素。

規則：
- 每一樣可分開的食物列成一項（例如便當要拆成白飯、主菜、各樣配菜）；同一樣東西有多份時合併成一項並在份量寫明數量。
- 名稱用繁體中文，盡量用台灣常見的叫法（例如「滷肉飯」「燙青菜」「珍珠奶茶」）。
- 依照片中的餐具、容器大小推估份量，寫出直覺的份量描述（例如「1 碗」「半盤」「大杯 700ml」）與估計克數。
- 熱量與營養素以台灣常見做法估算，要把烹調用油、勾芡、醬汁、飲料糖度算進去；不確定時取常見的中間值，不要刻意偏低。
- 份量看不清楚、或食物被遮住時，把 confidence 設為 low，並在 note 簡短說明哪裡不確定。
- 若使用者有補充說明（例如「飯只吃一半」「無糖」），以補充說明為準調整估算。
- 照片中沒有食物時，items 回傳空陣列，並在 note 說明。
- note 用一兩句繁體中文，不要重複列出清單內容。`;

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '食物名稱（繁體中文）' },
          portion: { type: 'string', description: '份量描述，例如「1 碗」' },
          grams: { type: 'number', description: '估計重量（公克）' },
          kcal: { type: 'number', description: '熱量（大卡）' },
          protein: { type: 'number', description: '蛋白質（公克）' },
          carb: { type: 'number', description: '碳水化合物（公克）' },
          fat: { type: 'number', description: '脂肪（公克）' },
        },
        required: ['name', 'portion', 'grams', 'kcal', 'protein', 'carb', 'fat'],
        additionalProperties: false,
      },
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    note: { type: 'string' },
  },
  required: ['items', 'confidence', 'note'],
  additionalProperties: false,
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const originOk = allowed.length === 0 || allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': originOk && origin ? origin : allowed[0] || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-App-Token',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const reply = (status, body) => new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
    });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return reply(405, { error: '只接受 POST' });
    if (!originOk) return reply(403, { error: '來源網域未被允許' });
    if (env.APP_TOKEN && request.headers.get('X-App-Token') !== env.APP_TOKEN) {
      return reply(401, { error: '存取碼錯誤，請到「個人設定 → AI 拍照辨識」確認' });
    }
    if (!env.ANTHROPIC_API_KEY) return reply(500, { error: '後端尚未設定 ANTHROPIC_API_KEY' });

    let body;
    try { body = await request.json(); } catch { return reply(400, { error: '請求格式錯誤' }); }
    const match = /^data:([\w/+.-]+);base64,(.+)$/s.exec(String(body?.image || ''));
    if (!match || !MEDIA_TYPES.includes(match[1])) return reply(400, { error: '請上傳 JPEG / PNG / WebP 圖片' });
    if (match[2].length > MAX_IMAGE_BASE64) return reply(413, { error: '圖片太大' });
    const note = String(body?.note || '').trim().slice(0, 200);

    const model = env.MODEL || DEFAULT_MODEL;
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const params = {
      model,
      max_tokens: 16000,
      system: SYSTEM,
      output_config: {
        effort: env.EFFORT || 'medium',
        format: { type: 'json_schema', schema: SCHEMA },
      },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } },
          { type: 'text', text: note ? `使用者補充說明：${note}` : '請辨識並估算這張照片中的食物。' },
        ],
      }],
    };
    // 被安全機制誤擋時，由伺服器自動改用建議的備援模型重跑
    if (FALLBACK_MODELS.includes(model)) {
      params.betas = ['server-side-fallback-2026-07-01'];
      params.fallbacks = 'default';
    }

    let response;
    try {
      response = await client.beta.messages.create(params);
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) return reply(500, { error: '後端的 Anthropic API 金鑰無效' });
      if (error instanceof Anthropic.PermissionDeniedError) return reply(500, { error: 'API 金鑰沒有使用此模型的權限' });
      if (error instanceof Anthropic.RateLimitError) return reply(429, { error: '請求太頻繁或額度不足，請稍後再試' });
      if (error instanceof Anthropic.BadRequestError) return reply(400, { error: '辨識請求被拒絕：' + error.message });
      if (error instanceof Anthropic.APIError) return reply(502, { error: `AI 服務暫時無法使用（${error.status ?? '連線失敗'}）` });
      return reply(500, { error: '後端發生錯誤' });
    }

    if (response.stop_reason === 'refusal') return reply(422, { error: '這張照片無法辨識，請改用手動輸入' });
    if (response.stop_reason === 'max_tokens') return reply(502, { error: '辨識結果過長，請改拍單一餐點' });

    const text = response.content.find(b => b.type === 'text')?.text;
    let result;
    try { result = JSON.parse(text); } catch { return reply(502, { error: 'AI 回傳格式錯誤，請再試一次' }); }

    return reply(200, {
      items: result.items,
      confidence: result.confidence,
      note: result.note,
      model: response.model,
    });
  },
};
