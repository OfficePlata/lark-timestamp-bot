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

// メインの処理: 常に新しいレコードを作成する
exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    try {
        const data = JSON.parse(event.body);
        const { userId, displayName, action, breakTime } = data;

        const larkToken = await getLarkToken();
        
        const timestamp = new Date().getTime();
        let fields = {
            'uid': userId,
            'name': displayName,
            'イベント種別': action,
            'タイムスタンプ': timestamp,
        };

        if (action === '終了' && breakTime) {
            fields['休憩'] = breakTime;
        }
        
        const path = `/open-apis/bitable/v1/apps/${LARK_BASE_ID}/tables/${LARK_TABLE_ID}/records`;
        await requestLarkAPI(larkToken, 'POST', path, { fields });

        return {
            statusCode: 200,
            body: JSON.stringify({ message: `${action}時刻を記録しました。` }),
        };

    } catch (error) {
        console.error('Error:', error);
        return { statusCode: 500, body: JSON.stringify({ message: `記録に失敗しました: ${error.message}` }) };
    }
