const axios = require('axios');

// Netlifyの環境変数から設定を読み込み
const {
    LARK_APP_ID, LARK_APP_SECRET, LARK_BASE_ID, LARK_TABLE_ID
} = process.env;

// Larkのアクセストークンを取得する関数
async function getLarkToken() {
    const response = await axios.post('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', {
        app_id: LARK_APP_ID,
        app_secret: LARK_APP_SECRET,
    });
    return response.data.tenant_access_token;
}

// ユーザーIDでLarkのレコードを検索する関数
async function findLarkRecord(token, userId) {
    const response = await axios.post(
        `https://open.larksuite.com/open-apis/bitable/v1/apps/${LARK_BASE_ID}/tables/${LARK_TABLE_ID}/records/search`,
        { filter: { conjunction: "and", conditions: [{ field_name: "uid", operator: "is", value: [userId] }] } },
        { headers: { 'Authorization': `Bearer ${token}` } }
    );
    return response.data.data.items[0];
}

// メインの処理
exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const data = JSON.parse(event.body);
        const { userId, displayName, action, breakTime } = data;

        const larkToken = await getLarkToken();
        const existingRecord = await findLarkRecord(larkToken, userId);
        
        const timestamp = new Date().getTime();
        let fields = {};

        if (action === '終了' && breakTime) {
            fields[action] = timestamp;
            fields['休憩'] = breakTime;
        } else {
            fields[action] = timestamp;
        }

        if (existingRecord) {
            // レコードがあれば更新
            await axios.put(
                `https://open.larksuite.com/open-apis/bitable/v1/apps/${LARK_BASE_ID}/tables/${LARK_TABLE_ID}/records/${existingRecord.record_id}`,
                { fields },
                { headers: { 'Authorization': `Bearer ${larkToken}` } }
            );
        } else {
            // なければ新規作成
            fields.uid = userId;
            fields.name = displayName;
            await axios.post(
                `https://open.larksuite.com/open-apis/bitable/v1/apps/${LARK_BASE_ID}/tables/${LARK_TABLE_ID}/records`,
                { fields },
                { headers: { 'Authorization': `Bearer ${larkToken}` } }
            );
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: `${action}時刻を記録しました。` }),
        };

    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: '記録に失敗しました。' }),
        };
    }
};
