const https = require('https');

const { LARK_APP_ID, LARK_APP_SECRET, LARK_BASE_ID, LARK_TABLE_ID } = process.env;

// Larkのアクセストークンを取得する関数
function getLarkToken() {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({ app_id: LARK_APP_ID, app_secret: LARK_APP_SECRET });
        const options = {
            hostname: 'open.larksuite.com',
            path: '/open-apis/auth/v3/tenant_access_token/internal',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                const d = JSON.parse(data);
                d.code !== 0 ? reject(new Error(`Lark Token Error: ${d.msg}`)) : resolve(d.tenant_access_token);
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
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        };
        if(postData) options.headers['Content-Length'] = Buffer.byteLength(postData);
        
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                const d = JSON.parse(data);
                d.code !== 0 ? reject(new Error(`Lark API Error: ${d.msg}`)) : resolve(d);
            });
        });
        req.on('error', (e) => reject(e));
        if(postData) req.write(postData);
        req.end();
    });
}

// 今日の日付とユーザーIDでLarkのレコードを検索する関数
async function findTodaysRecord(token, userId) {
    const jstOffset = 9 * 60 * 60 * 1000;
    const now = new Date();
    const jstNow = new Date(now.getTime() + jstOffset);
    const startOfDayJST = new Date(jstNow.toISOString().split('T')[0] + 'T00:00:00.000Z');
    const startOfDayTimestamp = startOfDayJST.getTime();

    const path = `/open-apis/bitable/v1/apps/${LARK_BASE_ID}/tables/${LARK_TABLE_ID}/records/search`;
    const body = {
        filter: {
            conjunction: "and",
            conditions: [
                { field_name: "uid", operator: "is", value: [userId] },
                { field_name: "record_date", operator: "is", value: [startOfDayTimestamp] } // ★★★ 更新点 ★★★
            ]
        }
    };
    const response = await requestLarkAPI(token, 'POST', path, body);
    return response.data.items[0];
}

// メインの処理
exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    try {
        const data = JSON.parse(event.body);
        const { userId, displayName, action, breakTime } = data;

        const larkToken = await getLarkToken();
        const existingRecord = await findTodaysRecord(larkToken, userId);
        
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
            const jstOffset = 9 * 60 * 60 * 1000;
            const jstDate = new Date(timestamp + jstOffset);
            jstDate.setUTCHours(0, 0, 0, 0);
            const dateTimestamp = jstDate.getTime() - jstOffset;

            fields.uid = userId;
            fields.name = displayName;
            fields['record_date'] = dateTimestamp; // ★★★ 更新点 ★★★
            const path = `/open-apis/bitable/v1/apps/${LARK_BASE_ID}/tables/${LARK_TABLE_ID}/records`;
            await requestLarkAPI(larkToken, 'POST', path, { fields });
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: `${action}時刻を記録しました。` }),
        };

    } catch (error) {
        console.error('Error:', error);
        return { statusCode: 500, body: JSON.stringify({ message: `記録に失敗しました: ${error.message}` }) };
    }
};
