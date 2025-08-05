const https = require('https://');

// Netlifyの環境変数から設定を読み込み
const {
    LARK_APP_ID, LARK_APP_SECRET, LARK_BASE_ID, LARK_TABLE_ID
} = process.env;

// Larkのアクセストークンを取得する関数 (axiosの代わりにhttpsを使用)
function getLarkToken() {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            app_id: LARK_APP_ID,
            app_secret: LARK_APP_SECRET,
        });

        const options = {
            hostname: 'open.larksuite.com',
            path: '/open-apis/auth/v3/tenant_access_token/internal',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
            },
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                const responseData = JSON.parse(data);
                resolve(responseData.tenant_access_token);
            });
        });

        req.on('error', (e) => reject(e));
        req.write(postData);
        req.end();
    });
}

// 汎用的なLark APIリクエスト関数
function requestLarkAPI(token, method, path, body = null) {
     return new Promise((resolve, reject) => {
        const postData = body ? JSON.stringify(body) : null;
        
        const options = {
            hostname: 'open.larksuite.com',
            path: path,
            method: method.toUpperCase(),
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        };

        if(postData) {
            options.headers['Content-Length'] = Buffer.byteLength(postData);
        }

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                resolve(JSON.parse(data));
            });
        });

        req.on('error', (e) => reject(e));
        if(postData) {
            req.write(postData);
        }
        req.end();
    });
}


// ユーザーIDでLarkのレコードを検索する関数
async function findLarkRecord(token, userId) {
    const path = `/open-apis/bitable/v1/apps/${LARK_BASE_ID}/tables/${LARK_TABLE_ID}/records/search`;
    const body = { filter: { conjunction: "and", conditions: [{ field_name: "uid", operator: "is", value: [userId] }] } };
    const response = await requestLarkAPI(token, 'POST', path, body);
    return response.data.items[0];
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
            const path = `/open-apis/bitable/v1/apps/${LARK_BASE_ID}/tables/${LARK_TABLE_ID}/records/${existingRecord.record_id}`;
            await requestLarkAPI(larkToken, 'PUT', path, { fields });
        } else {
            // なければ新規作成
            fields.uid = userId;
            fields.name = displayName;
            const path = `/open-apis/bitable/v1/apps/${LARK_BASE_ID}/tables/${LARK_TABLE_ID}/records`;
            await requestLarkAPI(larkToken, 'POST', path, { fields });
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: `${action}時刻を記録しました。` }),
        };

    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: '記録に失敗しました。' }),
        };
    }
};
