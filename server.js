const express = require('express');
const WebSocket = require('ws');
const path = require('path');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// 静的ファイルを提供
app.use(express.static(__dirname));

// プレイヤー管理
const players = new Map();

// メッセージタイプの定義
const MessageType = {
    PLAYER_JOIN: 'player_join',
    PLAYER_LEAVE: 'player_leave',
    PLAYER_UPDATE: 'player_update',
    PLAYERS_LIST: 'players_list',
    WORLD_STATE: 'world_state',
    MAP_DATA: 'map_data',
    REQUEST_MAP: 'request_map',
    CHAT_MESSAGE: 'chat_message',
    SYSTEM_MESSAGE: 'system_message'
};

// ワールド設定
const WORLD_CONFIG = {
    WORLD_SIZE: 128,
    HEIGHT_RANGE: 4,
    CHUNK_SIZE: 16
};

// グローバルマップデータ（サーバー起動時に生成）
let globalHeightMap = null;

// サーバー側マップ生成機能
function generateHeightMap() {
    console.log('マップデータを生成中...');
    const heightMap = [];
    const baseHeight = WORLD_CONFIG.HEIGHT_RANGE;
    
    // 初期の高さマップを生成（ノイズベース）
    for (let x = 0; x < WORLD_CONFIG.WORLD_SIZE; x++) {
        heightMap[x] = [];
        for (let z = 0; z < WORLD_CONFIG.WORLD_SIZE; z++) {
            // ペルランノイズ風の高さ生成
            let height = 0;
            let frequency = 0.02;
            let amplitude = WORLD_CONFIG.HEIGHT_RANGE;
            
            // 複数のオクターブを重ねる
            for (let octave = 0; octave < 4; octave++) {
                height += noise(x * frequency, z * frequency) * amplitude;
                frequency *= 2;
                amplitude *= 0.5;
            }
            
            // 基準の高さに加えて、最低でも0以上にする
            heightMap[x][z] = Math.max(0, Math.floor(baseHeight + height));
        }
    }
    
    // 隣接ブロック間の高さ差を0または1に制限するスムージング処理
    const smoothedMap = smoothHeightMap(heightMap);
    console.log('マップデータ生成完了');
    return smoothedMap;
}

function noise(x, z) {
    // シンプルなノイズ関数（ペルランノイズの簡易版）
    const n = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
    return (n - Math.floor(n)) * 2 - 1;
}

function smoothHeightMap(heightMap) {
    const smoothedMap = JSON.parse(JSON.stringify(heightMap)); // ディープコピー
    const maxIterations = 15; // 最大反復回数
    
    console.log('地形スムージング開始...');
    
    for (let iteration = 0; iteration < maxIterations; iteration++) {
        let changed = false;
        
        // よりスマートなスムージング: 最も制約の厳しい箇所から処理
        const problemAreas = [];
        
        // 問題のある箇所を特定
        for (let x = 0; x < WORLD_CONFIG.WORLD_SIZE; x++) {
            for (let z = 0; z < WORLD_CONFIG.WORLD_SIZE; z++) {
                const currentHeight = smoothedMap[x][z];
                const neighbors = getNeighborHeights(smoothedMap, x, z);
                
                let maxHeightDiff = 0;
                for (let neighbor of neighbors) {
                    maxHeightDiff = Math.max(maxHeightDiff, Math.abs(currentHeight - neighbor.height));
                }
                
                if (maxHeightDiff > 1) {
                    problemAreas.push({ x, z, diff: maxHeightDiff });
                }
            }
        }
        
        // 問題の大きい順にソート
        problemAreas.sort((a, b) => b.diff - a.diff);
        
        // 問題エリアを修正
        for (let area of problemAreas) {
            const { x, z } = area;
            const currentHeight = smoothedMap[x][z];
            const neighbors = getNeighborHeights(smoothedMap, x, z);
            
            // 隣接ブロックの平均高さを計算
            let totalHeight = 0;
            let validNeighbors = 0;
            
            for (let neighbor of neighbors) {
                totalHeight += neighbor.height;
                validNeighbors++;
            }
            
            if (validNeighbors > 0) {
                const avgHeight = Math.round(totalHeight / validNeighbors);
                
                // 最も違反の少ない高さに調整
                let bestHeight = currentHeight;
                let minViolations = Infinity;
                
                for (let testHeight = avgHeight - 1; testHeight <= avgHeight + 1; testHeight++) {
                    let violations = 0;
                    for (let neighbor of neighbors) {
                        if (Math.abs(testHeight - neighbor.height) > 1) {
                            violations++;
                        }
                    }
                    
                    if (violations < minViolations) {
                        minViolations = violations;
                        bestHeight = testHeight;
                    }
                }
                
                if (bestHeight !== currentHeight) {
                    smoothedMap[x][z] = bestHeight;
                    changed = true;
                }
            }
            
            // 全体の高さ制限を確保
            smoothedMap[x][z] = Math.max(0, Math.min(WORLD_CONFIG.HEIGHT_RANGE * 2, smoothedMap[x][z]));
        }
        
        // 変更がなければ収束したので終了
        if (!changed) {
            console.log(`地形スムージング完了: ${iteration + 1}回の反復`);
            break;
        }
    }
    
    // 最終チェック: まだ問題がある場合の強制修正
    for (let x = 0; x < WORLD_CONFIG.WORLD_SIZE; x++) {
        for (let z = 0; z < WORLD_CONFIG.WORLD_SIZE; z++) {
            const currentHeight = smoothedMap[x][z];
            const neighbors = getNeighborHeights(smoothedMap, x, z);
            
            for (let neighbor of neighbors) {
                const heightDiff = Math.abs(currentHeight - neighbor.height);
                if (heightDiff > 1) {
                    // 強制的に1段差に制限
                    if (currentHeight > neighbor.height) {
                        smoothedMap[x][z] = neighbor.height + 1;
                    } else {
                        smoothedMap[x][z] = neighbor.height - 1;
                    }
                    // 制限確保
                    smoothedMap[x][z] = Math.max(0, Math.min(WORLD_CONFIG.HEIGHT_RANGE * 2, smoothedMap[x][z]));
                    break;
                }
            }
        }
    }
    
    return smoothedMap;
}

function getNeighborHeights(heightMap, x, z) {
    const neighbors = [];
    const directions = [
        { dx: -1, dz: 0 },  // 左
        { dx: 1, dz: 0 },   // 右
        { dx: 0, dz: -1 },  // 上
        { dx: 0, dz: 1 },   // 下
    ];
    
    for (let dir of directions) {
        const nx = x + dir.dx;
        const nz = z + dir.dz;
        
        if (nx >= 0 && nx < WORLD_CONFIG.WORLD_SIZE && nz >= 0 && nz < WORLD_CONFIG.WORLD_SIZE) {
            neighbors.push({
                x: nx,
                z: nz,
                height: heightMap[nx][nz]
            });
        }
    }
    
    return neighbors;
}

// ユニークなプレイヤーIDを生成
function generatePlayerId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// プレイヤーの色をランダムに生成
function generatePlayerColor() {
    const colors = [
        0xff0000, // 赤
        0x00ff00, // 緑  
        0x0000ff, // 青
        0xffff00, // 黄
        0xff00ff, // マゼンタ
        0x00ffff, // シアン
        0xff8000, // オレンジ
        0x8000ff, // 紫
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}

// 他のプレイヤーに更新を送信
function broadcastToOthers(senderId, message) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.playerId !== senderId) {
            client.send(JSON.stringify(message));
        }
    });
}

// 全プレイヤーに送信
function broadcastToAll(message) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

// WebSocket接続処理
wss.on('connection', (ws) => {
    console.log('新しいクライアントが接続しました');
    
    // プレイヤーID生成
    const playerId = generatePlayerId();
    ws.playerId = playerId;
    
    // 新しいプレイヤー情報
    const newPlayer = {
        id: playerId,
        position: { x: 64, y: 10, z: 64 }, // 初期位置
        rotation: { x: 0, y: 0, z: 0 },
        color: generatePlayerColor(),
        nickname: `Player_${playerId.substr(-4)}`,
        lastUpdate: Date.now()
    };
    
    players.set(playerId, newPlayer);
    
    // 新しいプレイヤーに現在のプレイヤーリストとマップデータを送信
    ws.send(JSON.stringify({
        type: MessageType.PLAYERS_LIST,
        players: Array.from(players.values()).filter(p => p.id !== playerId),
        yourId: playerId
    }));
    
    // マップデータを送信
    ws.send(JSON.stringify({
        type: MessageType.MAP_DATA,
        heightMap: globalHeightMap,
        config: WORLD_CONFIG
    }));
    
    // 他のプレイヤーに新しいプレイヤーの参加を通知
    broadcastToOthers(playerId, {
        type: MessageType.PLAYER_JOIN,
        player: newPlayer
    });
    
    // システムメッセージで参加を通知
    broadcastToAll({
        type: MessageType.SYSTEM_MESSAGE,
        message: `${newPlayer.nickname} が参加しました`,
        timestamp: Date.now()
    });
    
    console.log(`プレイヤー ${newPlayer.nickname} (${playerId}) が参加しました`);
    console.log(`現在の接続数: ${players.size}`);
    
    // メッセージ受信処理
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            
            switch (message.type) {
                case MessageType.PLAYER_UPDATE:
                    // プレイヤー位置更新
                    const player = players.get(playerId);
                    if (player) {
                        player.position = message.position;
                        player.rotation = message.rotation;
                        player.lastUpdate = Date.now();
                        
                        // 他のプレイヤーに更新を通知
                        broadcastToOthers(playerId, {
                            type: MessageType.PLAYER_UPDATE,
                            playerId: playerId,
                            position: message.position,
                            rotation: message.rotation
                        });
                    }
                    break;
                
                case MessageType.REQUEST_MAP:
                    // マップデータ再送信要求
                    ws.send(JSON.stringify({
                        type: MessageType.MAP_DATA,
                        heightMap: globalHeightMap,
                        config: WORLD_CONFIG
                    }));
                    break;
                
                case 'request_players_sync':
                    // 再接続時のプレイヤー同期要求
                    console.log(`プレイヤー ${playerId} がユーザー状態の同期を要求しました`);
                    
                    // 現在のプレイヤーの情報を更新（再接続したプレイヤー）
                    const reconnectingPlayer = players.get(playerId);
                    if (reconnectingPlayer) {
                        reconnectingPlayer.lastUpdate = Date.now();
                    }
                    
                    // 他のすべてのプレイヤー情報を送信（自分以外）
                    const otherPlayersArray = Array.from(players.values()).filter(p => p.id !== playerId);
                    
                    ws.send(JSON.stringify({
                        type: 'players_sync',
                        players: otherPlayersArray,
                        yourId: playerId,
                        totalPlayers: players.size
                    }));
                    
                    console.log(`プレイヤー同期完了: ${otherPlayersArray.length}人の他プレイヤー情報を送信`);
                    break;
                
                case MessageType.CHAT_MESSAGE:
                    // チャットメッセージの処理
                    const chatPlayer = players.get(playerId);
                    if (chatPlayer && message.message && message.message.trim()) {
                        const chatMessage = {
                            type: MessageType.CHAT_MESSAGE,
                            nickname: chatPlayer.nickname,
                            message: message.message.trim().substring(0, 200), // 最大200文字に制限
                            timestamp: Date.now(),
                            playerId: playerId
                        };
                        
                        console.log(`チャット [${chatPlayer.nickname}]: ${chatMessage.message}`);
                        
                        // 全プレイヤーにチャットメッセージをブロードキャスト
                        broadcastToAll(chatMessage);
                    }
                    break;
                
                case 'heartbeat':
                    // ハートビート - プレイヤーの最終更新時刻を更新
                    const heartbeatPlayer = players.get(playerId);
                    if (heartbeatPlayer) {
                        heartbeatPlayer.lastUpdate = Date.now();
                    }
                    // ハートビート応答は不要（接続が生きていることの確認のみ）
                    break;
                    
                default:
                    console.log('未知のメッセージタイプ:', message.type);
            }
        } catch (error) {
            console.error('メッセージ解析エラー:', error);
        }
    });
    
    // 接続終了処理
    ws.on('close', () => {
        const player = players.get(playerId);
        if (player) {
            console.log(`プレイヤー ${player.nickname} (${playerId}) が退出しました`);
            
            // プレイヤーを削除
            players.delete(playerId);
            
            // 他のプレイヤーに退出を通知
            broadcastToAll({
                type: MessageType.PLAYER_LEAVE,
                playerId: playerId
            });
            
            // システムメッセージで退出を通知
            broadcastToAll({
                type: MessageType.SYSTEM_MESSAGE,
                message: `${player.nickname} が退出しました`,
                timestamp: Date.now()
            });
            
            console.log(`現在の接続数: ${players.size}`);
        }
    });
    
    // エラー処理
    ws.on('error', (error) => {
        console.error('WebSocketエラー:', error);
    });
});

// 非アクティブなプレイヤーのクリーンアップ（5分間更新がない場合）
setInterval(() => {
    const now = Date.now();
    const timeout = 5 * 60 * 1000; // 5分
    
    players.forEach((player, playerId) => {
        if (now - player.lastUpdate > timeout) {
            console.log(`タイムアウトによりプレイヤー ${player.nickname} を削除`);
            players.delete(playerId);
            
            broadcastToAll({
                type: MessageType.PLAYER_LEAVE,
                playerId: playerId
            });
        }
    });
}, 60000); // 1分おきにチェック

// サーバー起動時にマップを生成
console.log('サーバー初期化中...');
globalHeightMap = generateHeightMap();

// サーバー起動
server.listen(PORT, () => {
    console.log(`サーバーがポート${PORT}で起動しました`);
    console.log(`http://localhost:${PORT} でアクセスしてください`);
    console.log(`マップサイズ: ${WORLD_CONFIG.WORLD_SIZE}x${WORLD_CONFIG.WORLD_SIZE}`);
});

// グレースフルシャットダウン
process.on('SIGTERM', () => {
    console.log('サーバーを終了しています...');
    server.close(() => {
        console.log('サーバーが終了しました');
        process.exit(0);
    });
});