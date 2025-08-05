const https = require('https');

// Netlifyの環境変数から設定を読み込み
const {
    LARK_APP_ID, LARK_APP_SECRET, LARK_BASE_ID, LARK_TABLE_ID
} = process.env;

// Larkのアクセストークンを取得する関数
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
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                const responseData = JSON.parse(data);
                if (responseData.code !== 0) {
                    reject(new Error(`Lark Token Error: ${responseData.msg}`));
                } else {
                    resolve(responseData.tenant_access_token);
                }
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
        if(postData) {
            options.headers['Content-Length'] = Buffer.byteLength(postData);
        }
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                const responseData = JSON.parse(data);
                if (responseData.code !== 0) {
                    reject(new Error(`Lark API Error: ${responseData.msg}`));
                } else {
                    resolve(responseData);
                }
            });
        });
        req.on('error', (e) => reject(e));
        if(postData) { req.write(postData); }
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
    // ★★★ このログが表示されるかどうかが最重要 ★★★
    console.log("--- Netlify Function 'record' has been invoked! ---");
    
    if (event.httpMethod !== 'POST') {
        console.log("Rejected non-POST request.");
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        console.log("Parsing request body...");
        const data = JSON.parse(event.body);
        const { userId, displayName, action, breakTime } = data;
        console.log(`Data parsed: action=${action}, userId=${userId}`);

        console.log("Getting Lark token...");
        const larkToken = await getLarkToken();
        console.log("Lark token obtained.");

        console.log("Finding existing record for user...");
        const existingRecord = await findLarkRecord(larkToken, userId);
        console.log(existingRecord ? `Found record: ${existingRecord.record_id}` : "No existing record found.");
        
        const timestamp = new Date().getTime();
        let fields = {};

        if (action === '終了' && breakTime) {
            fields[action] = timestamp;
            fields['休憩'] = breakTime;
        } else {
            fields[action] = timestamp;
        }

        if (existingRecord) {
            console.log("Updating existing record...");
            const path = `/open-apis/bitable/v1/apps/${LARK_BASE_ID}/tables/${LARK_TABLE_ID}/records/${existingRecord.record_id}`;
            await requestLarkAPI(larkToken, 'PUT', path, { fields });
            console.log("Record updated.");
        } else {
            console.log("Creating new record...");
            fields.uid = userId;
            fields.name = displayName;
            const path = `/open-apis/bitable/v1/apps/${LARK_BASE_ID}/tables/${LARK_TABLE_ID}/records`;
            await requestLarkAPI(larkToken, 'POST', path, { fields });
            console.log("New record created.");
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: `${action}時刻を記録しました。` }),
        };

    } catch (error) {
        console.error('--- ERROR IN HANDLER ---:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: `記録に失敗しました: ${error.message}` }),
        };
    }
};
