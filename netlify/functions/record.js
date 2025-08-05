【V2.1決定版】スマート日報タイムカード改善ガイドはじめに：今回のアップグレードで実現することこれまでのバージョンの利点を組み合わせ、お客様の最終的なご要望である「日報形式での記録」と「究極のシンプルさ」を両立させる「スマート日報」タイムカードを構築します。日報形式での記録:1人のユーザーにつき、1日1行のレコードが作成・更新されます。「出発」「開始」「終了」の各アクションの時刻は、それぞれ専用の列に記録されます。状態管理による究極のシンプルさ:LIFFアプリがその日の記録状況を把握し、次に押すべきボタン（出発→開始→終了）だけを自動で表示します。ユーザーはただ表示されているボタンを押すだけで、迷うことも間違えることもありません。この改善を実現するため、Lark Base、LIFFアプリ(index.html)、そしてNetlifyサーバー機能(record.js, status.js)の3つを、V2.1としてそれぞれ更新していきます。ステップ1：Lark Baseの準備（日報テーブル）まず、日報形式でデータを記録するためのテーブルを準備します。V3.0/V4.0で作成した「行動ログ」テーブルとは別に、新しいテーブルを作成するか、V2.0のテーブルを再利用してください。テーブルを作成:Lark Baseで、「日次タイムカード」のような名前のテーブルを作成します。フィールドを設計:以下のフィールド（列）を、指定されたタイプで作成してください。フィールド名（列名）フィールドタイプ説明uidテキスト（一行）LINEユーザーIDnameテキスト（一行）LINEの表示名日付日付記録された日出発日時「出発」ボタンが押された時刻開始日時「開始」ボタンが押された時刻終了日時「終了」ボタンが押された時刻休憩単一選択休憩時間（分）。オプションに15, 30...と設定ステップ2：Netlifyサーバー機能のアップグレード (V2.1)裏方のプログラムを、「日報」形式のデータ構造に合わせて更新します。record.jsを更新:GitHubリポジトリのnetlify/functions/record.jsの中身を、以下のV2.1のコードで完全に上書きしてください。主な変更点: 常に新しい行を作成するのではなく、その日のレコードを探して、対応する列を更新するロジックに変更しました。const https = require('https');

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
                { field_name: "日付", operator: "is", value: [startOfDayTimestamp] }
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
            fields['日付'] = dateTimestamp;
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
