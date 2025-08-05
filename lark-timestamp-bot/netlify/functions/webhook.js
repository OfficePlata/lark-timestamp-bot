// このコードはNode.js環境で動作します
// 必要なライブラリをインポートします
const crypto = require('crypto');
const axios = require('axios');

// --- Lark APIと通信するための準備 ---
// Netlifyの環境変数から設定を読み込みます
const LARK_APP_ID = process.env.LARK_APP_ID;
const LARK_APP_SECRET = process.env.LARK_APP_SECRET;
const LARK_BASE_ID = process.env.LARK_BASE_ID;
const LARK_TABLE_ID = process.env.LARK_TABLE_ID;
const LIFF_URL_FOR_BREAK_TIME = process.env.LIFF_URL_FOR_BREAK_TIME;

// Larkのアクセストークンを取得する関数
async function getLarkTenantAccessToken() {
    const response = await axios.post('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', {
        app_id: LARK_APP_ID,
        app_secret: LARK_APP_SECRET,
    });
    return response.data.tenant_access_token;
}

// ユーザーIDでLarkのレコードを検索する関数
async function findLarkRecordByUserId(accessToken, userId) {
    const response = await axios.post(
        `https://open.larksuite.com/open-apis/bitable/v1/apps/${LARK_BASE_ID}/tables/${LARK_TABLE_ID}/records/search`,
        { filter: { conjunction: "and", conditions: [{ field_name: "uid", operator: "is", value: [userId] }] } },
        { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    return response.data.data.items[0]; // 見つかれば最初のレコードを返す
}

// Larkのレコードを更新する関数
async function updateLarkRecord(accessToken, recordId, fieldsToUpdate) {
    await axios.put(
        `https://open.larksuite.com/open-apis/bitable/v1/apps/${LARK_BASE_ID}/tables/${LARK_TABLE_ID}/records/${recordId}`,
        { fields: fieldsToUpdate },
        { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
}

// Larkに新しいレコードを作成する関数
async function createLarkRecord(accessToken, fieldsToCreate) {
     await axios.post(
        `https://open.larksuite.com/open-apis/bitable/v1/apps/${LARK_BASE_ID}/tables/${LARK_TABLE_ID}/records`,
        { fields: fieldsToCreate },
        { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
}

// --- LINE Messaging APIと通信するための準備 ---
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

// LINEに返信メッセージを送る関数
async function replyToLine(replyToken, message) {
    await axios.post('https://api.line.me/v2/bot/message/reply', {
        replyToken,
        messages: [{ type: 'text', text: message }],
    }, {
        headers: { 'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
    });
}

// --- メインの処理 ---
exports.handler = async (event) => {
    // LINEからの署名を検証
    const signature = event.headers['x-line-signature'];
    const body = event.body;
    const hash = crypto.createHmac('sha256', LINE_CHANNEL_SECRET).update(body).digest('base64');
    if (signature !== hash) {
        return { statusCode: 401, body: 'Invalid signature' };
    }

    const webhookBody = JSON.parse(body);
    const lineEvent = webhookBody.events[0];

    // テキストメッセージ以外は無視
    if (lineEvent.type !== 'message' || lineEvent.message.type !== 'text') {
        return { statusCode: 200, body: 'OK' };
    }

    const userId = lineEvent.source.userId;
    const messageText = lineEvent.message.text.trim(); // 送信されたテキスト
    const replyToken = lineEvent.replyToken;
    const timestamp = new Date().getTime(); // 現在時刻のタイムスタンプ

    try {
        const larkToken = await getLarkTenantAccessToken();
        const existingRecord = await findLarkRecordByUserId(larkToken, userId);

        let fields = {};
        let replyMessage = '';

        // キーワードに応じて処理を分岐
        switch (messageText) {
            case '出発':
            case '開始':
            case '終了':
                fields[messageText] = timestamp;
                replyMessage = `${messageText}時刻を記録しました。`;
                if (messageText === '終了') {
                    replyMessage += `\nお疲れ様でした。休憩時間を入力する場合は、こちらのリンクからお願いします。\n${LIFF_URL_FOR_BREAK_TIME}`;
                }
                break;
            default:
                // キーワード以外は無視
                return { statusCode: 200, body: 'OK' };
        }

        if (existingRecord) {
            // 既存レコードがあれば更新
            await updateLarkRecord(larkToken, existingRecord.record_id, fields);
        } else {
            // なければ新規作成
            const profileRes = await axios.get(`https://api.line.me/v2/bot/profile/${userId}`, {
                 headers: { 'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` }
            });
            fields.uid = userId;
            fields.name = profileRes.data.displayName;
            await createLarkRecord(larkToken, fields);
        }

        // ユーザーに返信
        await replyToLine(replyToken, replyMessage);

    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
        // エラーが発生してもLINEにはOKを返す
    }

    return { statusCode: 200, body: 'OK' };
};