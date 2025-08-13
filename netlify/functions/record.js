【V12.0最終版】Lark記録＆位置情報取得ガイドはじめに：今回のアップグレードで実現することこれまでのバージョンの利点をすべて引き継ぎつつ、ユーザーが「開始」を記録する際に、その場所の位置情報も同時に取得・記録する、高度な機能を追加します。ワンタップでの位置情報取得:ユーザーがLIFFアプリで「開始」ボタンに対応するリンクをタップすると、（初回の許可の後）自動でその場所の位置情報（緯度・経度）が取得されます。Larkへの自動記録:取得された「開始時刻」と「位置情報」は、これまで通り、自動でLark Baseの対応する行に記録されます。ユーザーへの確実なフィードバック:記録が完了すると、ユーザーのLINEトーク画面に「【開始】11:00（位置情報送信済）」といったテキストが自動入力され、ユーザーは送信するだけで報告が完了します。この改善を実現するため、Lark Base、Netlifyサーバー機能(record.js)、そしてLIFFアプリ(index.html)の3つを、V12.0として更新します。ステップ1：Lark Baseのアップグレードまず、新しく取得する位置情報を保存するための「器」をLark Baseに準備します。location_infoフィールドを追加:Lark Baseで、現在お使いのタイムカード用のテーブルを開きます。新しい列（フィールド）を追加し、以下の設定にしてください。フィールド名（列名）フィールドタイプlocation_infoテキスト（一行）最終的なテーブルの構成は以下のようになります。line_user_id, display_name, event_type, timestamp, break_minutes, location_infoステップ2：Netlifyサーバー機能の更新 (V12.0)裏方のプログラムに、LIFFアプリから送られてくる位置情報を受け取り、Larkに記録する機能を追加します。GitHubリポジトリのnetlify/functions/record.jsの中身を、以下のV12.0のコードで完全に上書きしてください。主な変更点: LIFFアプリからのデータにlocationが含まれていた場合、それをlocation_infoフィールドに記録するロジックを追加しました。const https = require('https');

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
        const { userId, displayName, action, breakTime, location } = data; // locationを受け取る

        const larkToken = await getLarkToken();
        
        const timestamp = new Date().getTime();
        let fields = {
            'line_user_id': userId,
            'display_name': displayName,
            'event_type': action,
            'timestamp': timestamp,
        };

        if (action === '終了' && breakTime) {
            fields['break_minutes'] = breakTime;
        }

        // ★★★ 新機能 ★★★
        // locationデータがあれば、fieldsに追加
        if (action === '開始' && location) {
            fields['location_info'] = `緯度: ${location.latitude}, 経度: ${location.longitude}`;
        }
        
        const path = `/open-apis/bitable/v1/apps/${LARK_BASE_ID}/tables/${LARK_TABLE_ID}/records`;
        await requestLarkAPI(larkToken, 'POST', path, { fields });

        return {
            statusCode: 200,
            body: JSON.stringify({ message: `${action}時刻をLarkに記録しました。` }),
        };

    } catch (error) {
        console.error('Error:', error);
        return { statusCode: 500, body: JSON.stringify({ message: `記録に失敗しました: ${error.message}` }) };
    }
};
