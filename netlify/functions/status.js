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

// 今日の日付とユーザーIDでLarkの全レコードを検索する関数
async function findTodaysRecords(token, userId) {
    const jstOffset = 9 * 60 * 60 * 1000;
    const now = new Date();
    const jstNow = new Date(now.getTime() + jstOffset);
    
    const startOfDayJST = new Date(jstNow.toISOString().split('T')[0] + 'T00:00:00.000Z');
    const endOfDayJST = new Date(jstNow.toISOString().split('T')[0] + 'T23:59:59.999Z');

    const startOfDayTimestamp = startOfDayJST.getTime();
    const endOfDayTimestamp = endOfDayJST.getTime();

    const path = `/open-apis/bitable/v1/apps/${LARK_BASE_ID}/tables/${LARK_TABLE_ID}/records/search`;
    const body = {
        filter: {
            conjunction: "and",
            conditions: [
                { field_name: "line_user_id", operator: "is", value: [userId] },
                { field_name: "timestamp", operator: "isGreaterEqual", value: [startOfDayTimestamp] },
                { field_name: "timestamp", operator: "isLessEqual", value: [endOfDayTimestamp] }
            ]
        }
    };
    const response = await requestLarkAPI(token, 'POST', path, body);
    return response.data.items || [];
}

// メインの処理
exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    try {
        const data = JSON.parse(event.body);
        const { userId } = data;
        
        const larkToken = await getLarkToken();
        const todaysRecords = await findTodaysRecords(larkToken, userId);

        return {
            statusCode: 200,
            body: JSON.stringify({ 
                records: todaysRecords.map(r => r.fields)
            }),
        };

    } catch (error) {
        console.error('Error:', error);
        return { statusCode: 500, body: JSON.stringify({ message: `状態の取得に失敗しました: ${error.message}` }) };
    }
};
