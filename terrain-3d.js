let scene, camera, renderer, world;
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let moveUp = false, moveDown = false;
let velocity = new THREE.Vector3();
let direction = new THREE.Vector3();

// パフォーマンス最適化用変数
let terrainBlocks = new Map(); // 生成されたブロックを管理
let visibleChunks = new Set(); // 表示中のチャンク
let lastPlayerChunk = { x: -1, z: -1 }; // 前回のプレイヤー位置

// マルチプレイヤー用変数
let websocket = null;
let myPlayerId = null;
let otherPlayers = new Map(); // 他のプレイヤー情報
let lastPositionSent = { x: 0, y: 0, z: 0 };
let lastRotationSent = { x: 0, y: 0 };

// 接続監視用変数
let isConnected = false;
let reconnectAttempts = 0;
let maxReconnectAttempts = 5;
let heartbeatInterval = null;
let connectionCheckInterval = null;

// サーバーマップデータ
let serverHeightMap = null;
let worldConfig = null;
let mapDataReceived = false;

// 木の管理
let treesGenerated = false;
let treeBlocks = new Map(); // 木のブロックを管理

// ミニマップ管理
let minimapCanvas = null;
let minimapContext = null;
let minimapVisible = true;
let minimapScale = 1; // 1ワールド座標 = minimapScale ピクセル
let minimapTerrain = null; // 地形データキャッシュ

// ユーザー管理
let myPlayerData = null;
let allPlayers = new Map(); // 自分を含む全プレイヤー情報

const BLOCK_SIZE = 1;
const WORLD_SIZE = 128; // 256→128に削減でブロック数を1/4に
const HEIGHT_RANGE = 4;
const PLAYER_HEIGHT = 3;
const RENDER_DISTANCE = 64; // 描画距離制限
const CHUNK_SIZE = 16; // チャンク単位での管理

let controls = {
    object: null,
    pitch: 0,
    yaw: 0
};

function init() {
    // シーン作成
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); // 水色の空
    
    // カメラ作成
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    // 初期位置は後でサーバーマップデータ受信時に調整
    camera.position.set(64, 10, 64);
    
    // レンダラー作成
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = false; // 影を無効化してパフォーマンス向上
    document.body.appendChild(renderer.domElement);
    
    // 照明設定
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(100, 100, 50);
    directionalLight.castShadow = false; // 影を無効化
    scene.add(directionalLight);
    
    controls.object = camera;
    
    // テクスチャアトラスを先に生成
    const textureAtlas = generateTextureAtlas();
    window.worldTextureAtlas = textureAtlas;
    
    // イベントリスナー
    setupEventListeners();
    
    // アニメーションループ開始
    animate();
    
    // マルチプレイヤー接続（地形生成はサーバーデータ受信後）
    connectToServer();
}

function generateTerrain() {
    // サーバーからマップデータを受信するまで待機
    if (!mapDataReceived || !serverHeightMap) {
        console.log('サーバーマップデータを待機中...');
        updateConnectionStatus('マップデータ待機中', 'orange');
        setTimeout(generateTerrain, 100); // 100ms後に再試行
        return;
    }
    
    console.log('サーバーマップデータを使用して地形生成中...');
    window.worldHeightMap = serverHeightMap; // サーバーからの高さマップを使用
    
    // サーバー設定で定数を更新
    if (worldConfig) {
        // クライアント定数をサーバー設定で上書き
        window.WORLD_SIZE = worldConfig.WORLD_SIZE;
        window.HEIGHT_RANGE = worldConfig.HEIGHT_RANGE;
        window.CHUNK_SIZE = worldConfig.CHUNK_SIZE;
        console.log('サーバー設定を適用:', worldConfig);
    }
    
    // テクスチャアトラスは既に初期化時に生成済み
    
    updateConnectionStatus('地形生成完了', 'green');
    
    // カメラ位置を適切に設定
    try {
        const centerX = Math.floor(window.WORLD_SIZE / 2);
        const centerZ = Math.floor(window.WORLD_SIZE / 2);
        const centerHeight = window.worldHeightMap[centerX][centerZ];
        camera.position.set(centerX, centerHeight + window.HEIGHT_RANGE + 2, centerZ);
        console.log(`カメラ位置設定: (${centerX}, ${centerHeight + window.HEIGHT_RANGE + 2}, ${centerZ})`);
    } catch (error) {
        console.error('カメラ位置設定エラー:', error);
        // フォールバック位置
        camera.position.set(64, 10, 64);
    }
    
    // 初期表示範囲のみ生成
    updateVisibleTerrain();
    
    // ミニマップを初期化
    initializeMinimap();
    
    // ローディング画面を隠す
    setTimeout(() => {
        hideLoadingScreen();
    }, 500); // 少し遅延させて完了感を演出
}

function updateVisibleTerrain() {
    // マップデータが未受信の場合は何もしない
    if (!mapDataReceived || !window.worldHeightMap) {
        return;
    }
    
    const playerX = Math.floor(camera.position.x);
    const playerZ = Math.floor(camera.position.z);
    const currentChunkSize = window.CHUNK_SIZE || CHUNK_SIZE;
    const playerChunk = {
        x: Math.floor(playerX / currentChunkSize),
        z: Math.floor(playerZ / currentChunkSize)
    };
    
    // プレイヤーが移動した場合のみ更新
    if (playerChunk.x === lastPlayerChunk.x && playerChunk.z === lastPlayerChunk.z) {
        return;
    }
    
    lastPlayerChunk = playerChunk;
    
    // 新しく表示すべきチャンクを計算
    const chunkRadius = Math.ceil(RENDER_DISTANCE / currentChunkSize);
    const newVisibleChunks = new Set();
    
    for (let dx = -chunkRadius; dx <= chunkRadius; dx++) {
        for (let dz = -chunkRadius; dz <= chunkRadius; dz++) {
            const chunkX = playerChunk.x + dx;
            const chunkZ = playerChunk.z + dz;
            const chunkKey = `${chunkX},${chunkZ}`;
            
            // 距離チェック
            const distance = Math.sqrt(dx * dx + dz * dz) * currentChunkSize;
            if (distance <= RENDER_DISTANCE) {
                newVisibleChunks.add(chunkKey);
            }
        }
    }
    
    // 不要なチャンクを削除
    visibleChunks.forEach(chunkKey => {
        if (!newVisibleChunks.has(chunkKey)) {
            unloadChunk(chunkKey);
        }
    });
    
    // 新しいチャンクを生成
    newVisibleChunks.forEach(chunkKey => {
        if (!visibleChunks.has(chunkKey)) {
            loadChunk(chunkKey);
        }
    });
    
    visibleChunks = newVisibleChunks;
}

function loadChunk(chunkKey) {
    const [chunkX, chunkZ] = chunkKey.split(',').map(Number);
    const currentWorldSize = window.WORLD_SIZE || WORLD_SIZE;
    const currentChunkSize = window.CHUNK_SIZE || CHUNK_SIZE;
    
    for (let dx = 0; dx < currentChunkSize; dx++) {
        for (let dz = 0; dz < currentChunkSize; dz++) {
            const x = chunkX * currentChunkSize + dx;
            const z = chunkZ * currentChunkSize + dz;
            
            if (x >= 0 && x < currentWorldSize && z >= 0 && z < currentWorldSize) {
                const surfaceHeight = window.worldHeightMap[x][z];
                
                for (let y = 0; y <= Math.max(surfaceHeight, 0); y++) {
                    const blockKey = `${x},${y},${z}`;
                    if (!terrainBlocks.has(blockKey)) {
                        const block = createBlock(x, y, z, getBlockType(x, y, z, surfaceHeight), window.worldTextureAtlas);
                        terrainBlocks.set(blockKey, block);
                    }
                }
                
                // 地表に木を生成（確率的、まばらに）
                generateTreeAtPosition(x, z, surfaceHeight, currentWorldSize);
            }
        }
    }
}

function unloadChunk(chunkKey) {
    const [chunkX, chunkZ] = chunkKey.split(',').map(Number);
    const currentWorldSize = window.WORLD_SIZE || WORLD_SIZE;
    const currentChunkSize = window.CHUNK_SIZE || CHUNK_SIZE;
    
    for (let dx = 0; dx < currentChunkSize; dx++) {
        for (let dz = 0; dz < currentChunkSize; dz++) {
            const x = chunkX * currentChunkSize + dx;
            const z = chunkZ * currentChunkSize + dz;
            
            if (x >= 0 && x < currentWorldSize && z >= 0 && z < currentWorldSize) {
                const surfaceHeight = window.worldHeightMap[x][z];
                
                // 地形ブロックと木を削除
                for (let y = 0; y <= Math.max(surfaceHeight + 10, 0); y++) { // 木の高さ分も含める
                    const blockKey = `${x},${y},${z}`;
                    const block = terrainBlocks.get(blockKey);
                    if (block) {
                        scene.remove(block);
                        if (block.geometry) block.geometry.dispose();
                        if (block.material) block.material.dispose();
                        terrainBlocks.delete(blockKey);
                    }
                }
                
                // 木の生成済みマークを削除
                const treeKey = `tree_${x}_${z}`;
                if (treeBlocks.has(treeKey)) {
                    treeBlocks.delete(treeKey);
                }
            }
        }
    }
}

// マップ生成機能はサーバー側に移植済み

function getBlockType(x, y, z, surfaceHeight) {
    if (y === surfaceHeight) {
        return 1; // 草ブロック
    } else if (y >= surfaceHeight - 3) {
        return 2; // 土ブロック
    } else {
        return 3; // 石ブロック
    }
}

function generateTextureAtlas() {
    const canvas = document.createElement('canvas');
    canvas.width = 384; // 幅を拡張して木のテクスチャ用のスペースを確保
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    
    // 草ブロック (0, 0)
    ctx.fillStyle = '#6AAA40';
    ctx.fillRect(0, 0, 64, 64);
    addNoise(ctx, 0, 0, 64, 64, 20);
    
    // 土ブロック (64, 0)
    ctx.fillStyle = '#966C4A';
    ctx.fillRect(64, 0, 64, 64);
    addNoise(ctx, 64, 0, 64, 64, 15);
    
    // 石ブロック (128, 0)
    ctx.fillStyle = '#7F7F7F';
    ctx.fillRect(128, 0, 64, 64);
    addNoise(ctx, 128, 0, 64, 64, 25);
    
    // 木の幹テクスチャ (192, 0)
    ctx.fillStyle = '#8B4513'; // 茶色
    ctx.fillRect(192, 0, 64, 64);
    // 木の縞模様を追加
    ctx.fillStyle = '#654321';
    for (let i = 0; i < 64; i += 8) {
        ctx.fillRect(192, i, 64, 4);
    }
    addNoise(ctx, 192, 0, 64, 64, 10);
    
    // 葉っぱテクスチャ (256, 0)
    ctx.fillStyle = '#228B22'; // 濃い緑
    ctx.fillRect(256, 0, 64, 64);
    addNoise(ctx, 256, 0, 64, 64, 30);
    
    // 木の根っこ/木材テクスチャ (320, 0)
    ctx.fillStyle = '#D2691E'; // より明るい茶色
    ctx.fillRect(320, 0, 64, 64);
    addNoise(ctx, 320, 0, 64, 64, 15);
    
    // デバッグ用：テクスチャをプレビューエリアに表示
    const previewCanvas = document.getElementById('texturePreview');
    previewCanvas.width = 384;
    previewCanvas.height = 64;
    const previewCtx = previewCanvas.getContext('2d');
    previewCtx.drawImage(canvas, 0, 0);
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrap;
    texture.wrapT = THREE.ClampToEdgeWrap;
    
    return texture;
}

function addNoise(ctx, x, y, w, h, intensity) {
    const imageData = ctx.getImageData(x, y, w, h);
    const data = imageData.data;
    
    for (let i = 0; i < data.length; i += 4) {
        const noise = (Math.random() - 0.5) * intensity;
        data[i] = Math.max(0, Math.min(255, data[i] + noise));
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
    }
    
    ctx.putImageData(imageData, x, y);
}

function createBlock(x, y, z, type, textureAtlas) {
    const geometry = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
    
    // UV座標を正しく設定（384x64テクスチャアトラス用）
    const uvOffsetX = (type - 1) / 6; // 6つのテクスチャが横並び
    const uvWidth = 1 / 6;
    
    // BoxGeometryのUV座標を直接修正
    const uvAttribute = geometry.getAttribute('uv');
    const uvArray = uvAttribute.array;
    
    // 各面（12個の三角形、24個の頂点）のUV座標を設定
    for (let i = 0; i < 24; i += 4) {
        // 4つの頂点で1つの面を構成
        uvArray[i * 2] = uvOffsetX;           // u
        uvArray[i * 2 + 1] = 1;               // v
        uvArray[(i + 1) * 2] = uvOffsetX + uvWidth; // u
        uvArray[(i + 1) * 2 + 1] = 1;               // v
        uvArray[(i + 2) * 2] = uvOffsetX + uvWidth; // u
        uvArray[(i + 2) * 2 + 1] = 0;               // v
        uvArray[(i + 3) * 2] = uvOffsetX;           // u
        uvArray[(i + 3) * 2 + 1] = 0;               // v
    }
    
    uvAttribute.needsUpdate = true;
    
    const material = new THREE.MeshLambertMaterial({ 
        map: textureAtlas,
        transparent: false
    });
    
    const cube = new THREE.Mesh(geometry, material);
    cube.position.set(x, y, z);
    cube.castShadow = false; // 影を無効化してパフォーマンス向上
    cube.receiveShadow = false;
    
    scene.add(cube);
    return cube; // ブロック管理のために返す
}

function setupEventListeners() {
    document.addEventListener('keydown', onKeyDown, false);
    document.addEventListener('keyup', onKeyUp, false);
    document.addEventListener('mousemove', onMouseMove, false);
    document.addEventListener('click', () => {
        document.body.requestPointerLock();
    });
    
    window.addEventListener('resize', onWindowResize, false);
}

function onKeyDown(event) {
    switch (event.code) {
        case 'ArrowUp':
        case 'KeyW':
            moveForward = true;
            break;
        case 'ArrowLeft':
        case 'KeyA':
            moveLeft = true;
            break;
        case 'ArrowDown':
        case 'KeyS':
            moveBackward = true;
            break;
        case 'ArrowRight':
        case 'KeyD':
            moveRight = true;
            break;
        case 'Space':
            moveUp = true;
            break;
        case 'ShiftLeft':
        case 'ShiftRight':
            moveDown = true;
            break;
        case 'KeyT':
            const preview = document.getElementById('texturePreview');
            preview.style.display = preview.style.display === 'none' ? 'block' : 'none';
            break;
        case 'KeyM':
            toggleMinimap();
            break;
        case 'Enter':
            const chatWindow = document.getElementById('chat-window');
            const chatInput = document.getElementById('chat-input');
            
            if (chatWindow.style.display === 'none') {
                // チャットウィンドウを開く
                showChatWindow();
            } else if (document.activeElement === chatInput && chatInput.value.trim()) {
                // メッセージを送信
                sendChatMessage();
            }
            event.preventDefault();
            break;
        case 'Escape':
            hideChatWindow();
            break;
    }
}

function onKeyUp(event) {
    switch (event.code) {
        case 'ArrowUp':
        case 'KeyW':
            moveForward = false;
            break;
        case 'ArrowLeft':
        case 'KeyA':
            moveLeft = false;
            break;
        case 'ArrowDown':
        case 'KeyS':
            moveBackward = false;
            break;
        case 'ArrowRight':
        case 'KeyD':
            moveRight = false;
            break;
        case 'Space':
            moveUp = false;
            break;
        case 'ShiftLeft':
        case 'ShiftRight':
            moveDown = false;
            break;
    }
}

function onMouseMove(event) {
    if (document.pointerLockElement === document.body) {
        controls.yaw -= event.movementX * 0.002;
        controls.pitch -= event.movementY * 0.002;
        controls.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, controls.pitch));
        
        controls.object.rotation.set(controls.pitch, controls.yaw, 0);
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

let lastUserListUpdate = 0;

function animate() {
    requestAnimationFrame(animate);
    
    updateMovement();
    updateVisibleTerrain(); // プレイヤー移動に応じてチャンクを更新
    sendPositionUpdate(); // 位置情報をサーバーに送信
    
    // 自分の座標を更新（1秒に1回）
    const now = Date.now();
    if (now - lastUserListUpdate > 1000) {
        updateMyPlayerData();
        updateUsersList();
        lastUserListUpdate = now;
    }
    
    renderer.render(scene, camera);
}

function updateMovement() {
    velocity.x -= velocity.x * 10.0 * 0.016;
    velocity.z -= velocity.z * 10.0 * 0.016;
    velocity.y -= velocity.y * 10.0 * 0.016;
    
    direction.z = Number(moveForward) - Number(moveBackward);
    direction.x = Number(moveRight) - Number(moveLeft);
    direction.y = Number(moveUp) - Number(moveDown);
    direction.normalize();
    
    if (moveForward || moveBackward) velocity.z -= direction.z * 400.0 * 0.016;
    if (moveLeft || moveRight) velocity.x -= direction.x * 400.0 * 0.016;
    if (moveUp || moveDown) velocity.y += direction.y * 400.0 * 0.016;
    
    // カメラの向きに応じた移動
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    
    const right = new THREE.Vector3();
    right.crossVectors(forward, camera.up).normalize();
    
    const moveVector = new THREE.Vector3();
    moveVector.addScaledVector(forward, -velocity.z * 0.016);
    moveVector.addScaledVector(right, -velocity.x * 0.016);
    moveVector.y += velocity.y * 0.016;
    
    camera.position.add(moveVector);
    
    // 境界チェック
    const currentWorldSize = window.WORLD_SIZE || WORLD_SIZE;
    camera.position.x = Math.max(0, Math.min(currentWorldSize - 1, camera.position.x));
    camera.position.z = Math.max(0, Math.min(currentWorldSize - 1, camera.position.z));
    camera.position.y = Math.max(1, Math.min(50, camera.position.y));
}

// マルチプレイヤー機能
function connectToServer() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    try {
        // 既存の接続をクリーンアップ
        cleanupConnection();
        
        websocket = new WebSocket(wsUrl);
        
        websocket.onopen = () => {
            console.log('サーバーに接続しました');
            isConnected = true;
            const wasReconnecting = reconnectAttempts > 0;
            reconnectAttempts = 0;
            updateConnectionStatus('接続済み', 'green');
            hideDisconnectionMessages(); // 切断通知を削除
            startHeartbeat();
            
            // 再接続の場合は、ユーザー状態を再同期
            if (wasReconnecting) {
                requestUserStateSynchronization();
            }
        };
        
        websocket.onmessage = (event) => {
            const message = JSON.parse(event.data);
            handleServerMessage(message);
        };
        
        websocket.onclose = (event) => {
            console.log('サーバーとの接続が切断されました', event);
            isConnected = false;
            stopHeartbeat();
            
            // 切断理由を表示
            let reason = '不明な理由';
            if (event.code === 1000) reason = '正常終了';
            else if (event.code === 1001) reason = 'サーバー停止';
            else if (event.code === 1006) reason = '異常切断';
            else if (event.code >= 1002 && event.code <= 1015) reason = 'プロトコルエラー';
            
            updateConnectionStatus(`切断 (${reason})`, 'red');
            showDisconnectionMessage(reason);
            
            // 再接続を試行
            attemptReconnection();
        };
        
        websocket.onerror = (error) => {
            console.error('WebSocketエラー:', error);
            isConnected = false;
            updateConnectionStatus('接続エラー', 'red');
        };
        
    } catch (error) {
        console.error('WebSocket接続エラー:', error);
        updateConnectionStatus('接続失敗', 'red');
        attemptReconnection();
    }
}

function cleanupConnection() {
    if (websocket) {
        websocket.onopen = null;
        websocket.onmessage = null;
        websocket.onclose = null;
        websocket.onerror = null;
        if (websocket.readyState === WebSocket.OPEN) {
            websocket.close();
        }
        websocket = null;
    }
    stopHeartbeat();
}

function startHeartbeat() {
    // 5秒間隔でハートビート送信
    heartbeatInterval = setInterval(() => {
        if (websocket && websocket.readyState === WebSocket.OPEN) {
            websocket.send(JSON.stringify({ type: 'heartbeat' }));
        } else {
            // 接続が失われていることを検知
            isConnected = false;
            updateConnectionStatus('接続確認中...', 'orange');
        }
    }, 5000);
    
    // 接続状態の定期チェック
    connectionCheckInterval = setInterval(() => {
        if (websocket) {
            if (websocket.readyState === WebSocket.CLOSED || websocket.readyState === WebSocket.CLOSING) {
                isConnected = false;
                updateConnectionStatus('接続失効', 'red');
                attemptReconnection();
            }
        }
    }, 2000);
}

function stopHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
    if (connectionCheckInterval) {
        clearInterval(connectionCheckInterval);
        connectionCheckInterval = null;
    }
}

function attemptReconnection() {
    if (reconnectAttempts >= maxReconnectAttempts) {
        updateConnectionStatus('再接続失敗', 'red');
        showPermanentDisconnectionMessage();
        return;
    }
    
    reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000); // 指数バックオフ（最大10秒）
    
    updateConnectionStatus(`再接続中... (${reconnectAttempts}/${maxReconnectAttempts})`, 'orange');
    setTimeout(connectToServer, delay);
}

function handleServerMessage(message) {
    switch (message.type) {
        case 'players_list':
            handlePlayersListMessage(message, false);
            break;
        
        case 'players_sync':
            // 再接続時の同期メッセージ
            handlePlayersListMessage(message, true);
            updateConnectionStatus('同期完了', 'green');
            setTimeout(() => {
                updateConnectionStatus('接続済み', 'green');
            }, 2000);
            break;
            
        case 'player_join':
            addOtherPlayer(message.player);
            allPlayers.set(message.player.id, message.player);
            console.log(`プレイヤー ${message.player.nickname} が参加しました`);
            updateUsersList();
            break;
            
        case 'player_leave':
            removeOtherPlayer(message.playerId);
            allPlayers.delete(message.playerId);
            updateUsersList();
            break;
            
        case 'player_update':
            updateOtherPlayer(message.playerId, message.position, message.rotation);
            
            // allPlayersの情報も更新
            const player = allPlayers.get(message.playerId);
            if (player) {
                player.position = message.position;
                player.rotation = message.rotation;
                player.lastUpdate = Date.now(); // 最終更新時刻を更新
                updateUsersList();
            }
            break;
        
        case 'map_data':
            console.log('サーバーからマップデータを受信しました', {
                heightMapSize: message.heightMap ? `${message.heightMap.length}x${message.heightMap[0] ? message.heightMap[0].length : 0}` : 'null',
                config: message.config
            });
            serverHeightMap = message.heightMap;
            worldConfig = message.config;
            mapDataReceived = true;
            
            // マップデータ受信後、地形生成を開始
            console.log('マップデータ受信完了、地形生成を開始します');
            generateTerrain();
            break;
        
        case 'chat_message':
            addChatMessage(message.nickname, message.message, message.timestamp);
            break;
        
        case 'system_message':
            addChatMessage('', message.message, message.timestamp, true);
            break;
            
        default:
            console.log('未知のメッセージタイプ:', message.type);
    }
}

function addOtherPlayer(playerData) {
    // プレイヤーの3Dモデル（シンプルなキューブ）を作成
    const geometry = new THREE.BoxGeometry(0.8, 1.8, 0.8);
    const material = new THREE.MeshLambertMaterial({ color: playerData.color });
    const playerMesh = new THREE.Mesh(geometry, material);
    
    playerMesh.position.set(
        playerData.position.x,
        playerData.position.y + 0.9, // キューブの中心を足元に合わせる
        playerData.position.z
    );
    
    scene.add(playerMesh);
    
    // 名前表示用のテキスト（簡易版）
    const nameTag = createNameTag(playerData.nickname);
    nameTag.position.set(0, 1.2, 0);
    playerMesh.add(nameTag);
    
    otherPlayers.set(playerData.id, {
        mesh: playerMesh,
        nameTag: nameTag,
        data: playerData
    });
}

function removeOtherPlayer(playerId) {
    const player = otherPlayers.get(playerId);
    if (player) {
        scene.remove(player.mesh);
        if (player.mesh.geometry) player.mesh.geometry.dispose();
        if (player.mesh.material) player.mesh.material.dispose();
        otherPlayers.delete(playerId);
        console.log(`プレイヤー ${player.data.nickname} が退出しました`);
    }
}

function updateOtherPlayer(playerId, position, rotation) {
    const player = otherPlayers.get(playerId);
    if (player) {
        player.mesh.position.set(position.x, position.y + 0.9, position.z);
        player.mesh.rotation.y = rotation.y;
        player.data.position = position;
        player.data.rotation = rotation;
    }
}

function createNameTag(name) {
    // シンプルな名前表示（平面）
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.fillStyle = 'white';
    ctx.font = '24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(name, canvas.width / 2, canvas.height / 2 + 8);
    
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.MeshBasicMaterial({ 
        map: texture, 
        transparent: true,
        alphaTest: 0.1
    });
    const geometry = new THREE.PlaneGeometry(2, 0.5);
    const nameTag = new THREE.Mesh(geometry, material);
    
    return nameTag;
}

function sendPositionUpdate() {
    if (!websocket || websocket.readyState !== WebSocket.OPEN) return;
    
    const currentPos = camera.position;
    const currentRot = { x: controls.pitch, y: controls.yaw };
    
    // 位置や回転が大きく変わった場合のみ送信（帯域節約）
    const posThreshold = 0.1;
    const rotThreshold = 0.05;
    
    const posChanged = Math.abs(currentPos.x - lastPositionSent.x) > posThreshold ||
                     Math.abs(currentPos.y - lastPositionSent.y) > posThreshold ||
                     Math.abs(currentPos.z - lastPositionSent.z) > posThreshold;
                     
    const rotChanged = Math.abs(currentRot.x - lastRotationSent.x) > rotThreshold ||
                     Math.abs(currentRot.y - lastRotationSent.y) > rotThreshold;
    
    if (posChanged || rotChanged) {
        websocket.send(JSON.stringify({
            type: 'player_update',
            position: { x: currentPos.x, y: currentPos.y, z: currentPos.z },
            rotation: currentRot
        }));
        
        lastPositionSent = { x: currentPos.x, y: currentPos.y, z: currentPos.z };
        lastRotationSent = { x: currentRot.x, y: currentRot.y };
    }
}

function updateConnectionStatus(status, color) {
    let statusElement = document.getElementById('connection-status');
    if (!statusElement) {
        statusElement = document.createElement('div');
        statusElement.id = 'connection-status';
        statusElement.style.cssText = `
            position: absolute;
            right: 10px;
            padding: 5px 10px;
            border-radius: 5px;
            font-size: 12px;
            color: white;
            background-color: rgba(0, 0, 0, 0.7);
        `;
        document.body.appendChild(statusElement);
    }
    
    // マップの表示状態に応じて位置を調整
    // マップのサイズ（200px）+ パディング（5px*2）+ タイトル高さ（約20px）= 約230px
    const topPosition = minimapVisible ? '230px' : '80px';
    statusElement.style.top = topPosition;
    
    statusElement.textContent = `サーバー: ${status}`;
    statusElement.style.borderLeft = `4px solid ${color}`;
    
    // ローディング画面のステータス更新
    updateLoadingStatus(status);
}

function updateLoadingStatus(status) {
    const loadingStatus = document.getElementById('loading-status');
    if (loadingStatus) {
        loadingStatus.textContent = status;
    }
}

function showDisconnectionMessage(reason) {
    // 切断通知の作成
    const disconnectNotification = document.createElement('div');
    disconnectNotification.id = 'disconnect-notification';
    disconnectNotification.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background-color: rgba(255, 0, 0, 0.9);
        color: white;
        padding: 20px 30px;
        border-radius: 10px;
        font-size: 16px;
        font-weight: bold;
        text-align: center;
        z-index: 1000;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        border: 2px solid #ff6666;
    `;
    disconnectNotification.innerHTML = `
        <div style="margin-bottom: 10px;">⚠️ サーバーとの接続が切断されました</div>
        <div style="font-size: 14px; font-weight: normal; margin-bottom: 15px;">理由: ${reason}</div>
        <div style="font-size: 12px; color: #ffcccc;">自動的に再接続を試行しています...</div>
    `;
    
    // 既存の通知を削除
    const existingNotification = document.getElementById('disconnect-notification');
    if (existingNotification) {
        existingNotification.remove();
    }
    
    document.body.appendChild(disconnectNotification);
    
    // 10秒後に通知を自動削除
    setTimeout(() => {
        if (disconnectNotification && disconnectNotification.parentNode) {
            disconnectNotification.remove();
        }
    }, 10000);
}

function showPermanentDisconnectionMessage() {
    // 永続的な切断通知の作成
    const permanentDisconnectNotification = document.createElement('div');
    permanentDisconnectNotification.id = 'permanent-disconnect-notification';
    permanentDisconnectNotification.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background-color: rgba(139, 0, 0, 0.95);
        color: white;
        padding: 30px 40px;
        border-radius: 15px;
        font-size: 18px;
        font-weight: bold;
        text-align: center;
        z-index: 1001;
        box-shadow: 0 6px 30px rgba(0, 0, 0, 0.7);
        border: 3px solid #ff4444;
    `;
    permanentDisconnectNotification.innerHTML = `
        <div style="margin-bottom: 15px;">❌ サーバーとの接続に失敗しました</div>
        <div style="font-size: 14px; font-weight: normal; margin-bottom: 20px;">
            再接続試行回数が上限に達しました。<br>
            サーバーが停止しているか、ネットワークに問題がある可能性があります。
        </div>
        <button id="manual-reconnect-btn" style="
            background-color: #4CAF50;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 14px;
            margin-right: 10px;
        ">手動で再接続</button>
        <button id="reload-page-btn" style="
            background-color: #2196F3;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 14px;
        ">ページを再読み込み</button>
    `;
    
    // 既存の通知を削除
    const existingNotification = document.getElementById('permanent-disconnect-notification');
    if (existingNotification) {
        existingNotification.remove();
    }
    
    document.body.appendChild(permanentDisconnectNotification);
    
    // ボタンのイベントリスナーを設定
    document.getElementById('manual-reconnect-btn').addEventListener('click', () => {
        reconnectAttempts = 0; // リセット
        permanentDisconnectNotification.remove();
        updateConnectionStatus('手動再接続中...', 'orange');
        connectToServer();
    });
    
    document.getElementById('reload-page-btn').addEventListener('click', () => {
        window.location.reload();
    });
}

function hideDisconnectionMessages() {
    const disconnectNotification = document.getElementById('disconnect-notification');
    if (disconnectNotification) {
        disconnectNotification.remove();
    }
    const permanentDisconnectNotification = document.getElementById('permanent-disconnect-notification');
    if (permanentDisconnectNotification) {
        permanentDisconnectNotification.remove();
    }
}

function requestUserStateSynchronization() {
    console.log('ユーザー状態の再同期を要求中...');
    updateConnectionStatus('ユーザー状態同期中', 'orange');
    
    // 既存のプレイヤー情報をクリア（自分以外）
    clearOtherPlayers();
    
    // サーバーに現在のプレイヤーリストを要求
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify({
            type: 'request_players_sync'
        }));
    }
}

function clearOtherPlayers() {
    // 3Dシーン内の他のプレイヤーを削除
    otherPlayers.forEach((playerMesh, playerId) => {
        if (playerMesh && playerMesh.parent) {
            scene.remove(playerMesh);
        }
    });
    otherPlayers.clear();
    
    // allPlayersから他のプレイヤーを削除（自分は保持）
    const myId = myPlayerId;
    const myData = allPlayers.get(myId);
    allPlayers.clear();
    if (myData) {
        allPlayers.set(myId, myData);
    }
    
    // ユーザーリストを更新
    updateUsersList();
}

function handlePlayersListMessage(message, isReconnection = false) {
    if (isReconnection) {
        console.log('再接続時のプレイヤーリスト同期:', message.players.length, '人のプレイヤー');
        
        // 既にmyPlayerIdが設定されているので、自分のデータは保持
        const myData = allPlayers.get(myPlayerId);
        if (myData) {
            // 自分の現在位置を更新（サーバーに同期）
            myData.position = camera.position;
            myData.rotation = { x: controls.pitch, y: controls.yaw };
            allPlayers.set(myPlayerId, myData);
        }
    } else {
        // 初回接続時の処理
        myPlayerId = message.yourId;
        console.log('初回接続:', myPlayerId);
        
        // 自分の初期情報を設定
        myPlayerData = {
            id: myPlayerId,
            position: camera.position,
            rotation: { x: controls.pitch, y: controls.yaw },
            nickname: `Player_${myPlayerId.substr(-4)}`
        };
        allPlayers.set(myPlayerId, myPlayerData);
    }
    
    // 他のプレイヤーを追加/更新
    message.players.forEach(player => {
        if (player.id !== myPlayerId) { // 自分以外
            // lastUpdate フィールドが無い場合は現在時刻を設定
            if (!player.lastUpdate) {
                player.lastUpdate = Date.now();
            }
            addOrUpdateOtherPlayer(player);
            allPlayers.set(player.id, player);
        }
    });
    
    updateUsersList();
    
    if (isReconnection) {
        // 自分の現在位置をサーバーに送信して同期
        sendPlayerUpdate();
        console.log('再接続完了: プレイヤー状態が同期されました');
    }
}

function addOrUpdateOtherPlayer(player) {
    const existingPlayer = otherPlayers.get(player.id);
    
    if (existingPlayer) {
        // 既存プレイヤーの位置を更新
        existingPlayer.position.set(player.position.x, player.position.y, player.position.z);
        existingPlayer.rotation.set(player.rotation.x, player.rotation.y, 0);
    } else {
        // 新規プレイヤーを追加
        addOtherPlayer(player);
    }
}

function hideLoadingScreen() {
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
        loadingScreen.style.display = 'none';
    }
    
    // ユーザーパネルを表示
    const usersPanel = document.getElementById('users-panel');
    if (usersPanel) {
        usersPanel.style.display = 'block';
    }
    
    // チャットイベントリスナーを設定
    setupChatEventListeners();
}

function setupChatEventListeners() {
    const chatInput = document.getElementById('chat-input');
    const chatSend = document.getElementById('chat-send');
    
    if (chatInput) {
        chatInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && chatInput.value.trim()) {
                sendChatMessage();
                event.preventDefault();
            }
            if (event.key === 'Escape') {
                hideChatWindow();
            }
        });
    }
    
    if (chatSend) {
        chatSend.addEventListener('click', sendChatMessage);
    }
}

function showChatWindow() {
    const chatWindow = document.getElementById('chat-window');
    const chatInput = document.getElementById('chat-input');
    
    if (chatWindow) {
        chatWindow.style.display = 'block';
        if (chatInput) {
            chatInput.focus();
        }
    }
}

function hideChatWindow() {
    const chatWindow = document.getElementById('chat-window');
    const chatInput = document.getElementById('chat-input');
    
    if (chatWindow) {
        chatWindow.style.display = 'none';
        if (chatInput) {
            chatInput.blur();
        }
    }
}

function sendChatMessage() {
    const chatInput = document.getElementById('chat-input');
    const message = chatInput.value.trim();
    
    if (!message || !websocket || websocket.readyState !== WebSocket.OPEN) {
        return;
    }
    
    // サーバーにチャットメッセージを送信
    websocket.send(JSON.stringify({
        type: 'chat_message',
        message: message,
        timestamp: Date.now()
    }));
    
    // 入力をクリア
    chatInput.value = '';
}

function addChatMessage(nickname, message, timestamp, isSystem = false) {
    const chatMessages = document.getElementById('chat-messages');
    if (!chatMessages) return;
    
    const messageElement = document.createElement('div');
    messageElement.style.marginBottom = '4px';
    messageElement.style.wordWrap = 'break-word';
    
    const timeStr = new Date(timestamp).toLocaleTimeString();
    
    if (isSystem) {
        messageElement.style.color = '#888';
        messageElement.style.fontStyle = 'italic';
        messageElement.innerHTML = `[${timeStr}] ${message}`;
    } else {
        const isMe = nickname === (allPlayers.get(myPlayerId)?.nickname || `Player_${myPlayerId?.substr(-4)}`);
        messageElement.innerHTML = `
            <span style="color: #888; font-size: 10px;">[${timeStr}]</span>
            <span style="color: ${isMe ? '#90EE90' : '#87CEEB'}; font-weight: bold;">${nickname}:</span>
            <span style="color: white;">${escapeHtml(message)}</span>
        `;
    }
    
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function updateUsersList() {
    const usersList = document.getElementById('users-list');
    const userCount = document.getElementById('user-count');
    
    if (!usersList || !userCount) return;
    
    // ユーザー数更新
    userCount.textContent = allPlayers.size;
    
    // 接続状態の情報を追加
    const connectionInfo = isConnected ? '✅ 同期済み' : '❌ 切断中';
    
    // ユーザーリストを生成
    const usersHtml = Array.from(allPlayers.entries()).map(([playerId, playerData]) => {
        const isMe = playerId === myPlayerId;
        const position = playerData.position || { x: 0, y: 0, z: 0 };
        const nickname = playerData.nickname || `Player_${playerId.substr(-4)}`;
        const lastUpdate = playerData.lastUpdate || Date.now();
        const timeSinceUpdate = Math.floor((Date.now() - lastUpdate) / 1000);
        
        // オンライン状態判定
        let onlineStatus = '🟢';
        let statusText = 'オンライン';
        if (!isMe) {
            if (timeSinceUpdate > 30) {
                onlineStatus = '🟡';
                statusText = '非アクティブ';
            }
            if (timeSinceUpdate > 300) { // 5分以上
                onlineStatus = '🔴';
                statusText = 'オフライン';
            }
        }
        
        return `
            <div style="margin-bottom: 6px; padding: 4px; border-radius: 3px; background-color: ${isMe ? 'rgba(0, 255, 0, 0.2)' : 'rgba(255, 255, 255, 0.1)'}; border-left: 3px solid ${isMe ? '#90EE90' : '#FFF'};">
                <div style="font-weight: bold; color: ${isMe ? '#90EE90' : '#FFF'}; display: flex; justify-content: space-between; align-items: center;">
                    <span>${nickname} ${isMe ? '(あなた)' : ''}</span>
                    <span style="font-size: 12px;">${onlineStatus}</span>
                </div>
                <div style="font-size: 10px; color: #CCC; margin-top: 2px;">
                    X: ${Math.round(position.x)}, Y: ${Math.round(position.y)}, Z: ${Math.round(position.z)}
                </div>
                ${!isMe ? `
                    <div style="font-size: 10px; color: #AAA;">
                        距離: ${calculateDistance(position)}m | ${statusText}
                    </div>
                ` : `
                    <div style="font-size: 10px; color: #90EE90;">
                        ${connectionInfo}
                    </div>
                `}
            </div>
        `;
    }).join('');
    
    usersList.innerHTML = usersHtml;
}

function calculateDistance(targetPosition) {
    if (!myPlayerData || !myPlayerData.position) return '---';
    
    const myPos = myPlayerData.position;
    const dx = myPos.x - targetPosition.x;
    const dy = myPos.y - targetPosition.y;
    const dz = myPos.z - targetPosition.z;
    
    return Math.round(Math.sqrt(dx * dx + dy * dy + dz * dz));
}

// 木生成関数
function generateTreeAtPosition(x, z, surfaceHeight, worldSize) {
    // 既に木が生成されている場合はスキップ
    const treeKey = `tree_${x}_${z}`;
    if (treeBlocks.has(treeKey)) {
        return;
    }
    
    // 境界から離れた場所のみ
    if (x < 2 || x >= worldSize - 2 || z < 2 || z >= worldSize - 2) {
        return;
    }
    
    // 地面の種類チェック（草ブロックのみ）
    const blockType = getBlockType(x, surfaceHeight, z, surfaceHeight);
    if (blockType !== 1) { // 草ブロック以外
        return;
    }
    
    // まばらな生成（確率的 + 位置ベースの疎分布）
    const treeSpacing = 8; // 木の最小間隔
    const treeChance = 0.15; // 基本生成確率
    
    // 位置ベースハッシュで決定論的な疎分布を作る
    const hash = (x * 73 + z * 37) % 1000;
    const isTreeCandidate = (x % treeSpacing === 2) && (z % treeSpacing === 3);
    const randomFactor = hash / 1000;
    
    if (isTreeCandidate && randomFactor < treeChance) {
        generateTree(x, surfaceHeight, z);
        treeBlocks.set(treeKey, true); // 生成済みマーク
    }
}

function generateTree(x, groundY, z) {
    const treeHeight = 5;
    const trunkHeight = 3;
    
    // 幹を生成（地面の1ブロック上から）
    for (let y = 1; y <= trunkHeight; y++) {
        const trunkY = groundY + y;
        const blockKey = `${x},${trunkY},${z}`;
        
        if (!terrainBlocks.has(blockKey)) {
            const block = createBlock(x, trunkY, z, 4, window.worldTextureAtlas); // type 4 = 木の幹
            terrainBlocks.set(blockKey, block);
        }
    }
    
    // 葉っぱを生成
    const leavesY1 = groundY + trunkHeight;     // レベル1: 地面+3
    const leavesY2 = groundY + trunkHeight + 1; // レベル2: 地面+4
    const leavesY3 = groundY + trunkHeight + 2; // レベル3: 地面+5
    
    // レベル1の葉っぱ（3x3、中心除く）
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            if (dx === 0 && dz === 0) continue; // 中心は幹
            
            const leafX = x + dx;
            const leafZ = z + dz;
            const blockKey = `${leafX},${leavesY1},${leafZ}`;
            
            if (!terrainBlocks.has(blockKey)) {
                const block = createBlock(leafX, leavesY1, leafZ, 5, window.worldTextureAtlas); // type 5 = 葉っぱ
                terrainBlocks.set(blockKey, block);
            }
        }
    }
    
    // レベル2の葉っぱ（十字型 + 中心）
    const leafPositions2 = [
        { dx: 0, dz: 0 },   // 中心
        { dx: -1, dz: 0 }, { dx: 1, dz: 0 },   // 左右
        { dx: 0, dz: -1 }, { dx: 0, dz: 1 }    // 前後
    ];
    
    leafPositions2.forEach(pos => {
        const leafX = x + pos.dx;
        const leafZ = z + pos.dz;
        const blockKey = `${leafX},${leavesY2},${leafZ}`;
        
        if (!terrainBlocks.has(blockKey)) {
            const block = createBlock(leafX, leavesY2, leafZ, 5, window.worldTextureAtlas);
            terrainBlocks.set(blockKey, block);
        }
    });
    
    // レベル3の葉っぱ（中心のみ）
    const blockKey3 = `${x},${leavesY3},${z}`;
    if (!terrainBlocks.has(blockKey3)) {
        const block = createBlock(x, leavesY3, z, 5, window.worldTextureAtlas);
        terrainBlocks.set(blockKey3, block);
    }
}

// ミニマップ機能
function initializeMinimap() {
    minimapCanvas = document.getElementById('minimap');
    if (!minimapCanvas) {
        console.error('ミニマップCanvas要素が見つかりません');
        return;
    }
    
    minimapContext = minimapCanvas.getContext('2d');
    if (!minimapContext) {
        console.error('ミニマップCanvasコンテキストの取得に失敗しました');
        return;
    }
    
    // ワールドサイズに基づいてスケールを計算
    const worldSize = window.WORLD_SIZE || WORLD_SIZE;
    minimapScale = Math.min(minimapCanvas.width, minimapCanvas.height) / worldSize;
    
    console.log('ミニマップ初期化完了:', {
        canvasSize: `${minimapCanvas.width}x${minimapCanvas.height}`,
        worldSize: worldSize,
        scale: minimapScale
    });
    
    // 地形マップを生成
    generateMinimapTerrain();
    
    // 定期的にミニマップを更新
    setInterval(updateMinimap, 100); // 100ms間隔で更新
}

function toggleMinimap() {
    const minimapContainer = document.getElementById('minimap-container');
    if (minimapContainer) {
        minimapVisible = !minimapVisible;
        minimapContainer.style.display = minimapVisible ? 'block' : 'none';
        
        // ステータス表示位置を更新
        const statusElement = document.getElementById('connection-status');
        if (statusElement) {
            const topPosition = minimapVisible ? '230px' : '80px';
            statusElement.style.top = topPosition;
        }
    }
}

function generateMinimapTerrain() {
    if (!minimapContext || !window.worldHeightMap) {
        return;
    }
    
    const worldSize = window.WORLD_SIZE || WORLD_SIZE;
    const heightRange = window.HEIGHT_RANGE || HEIGHT_RANGE;
    
    // 地形データを画像として生成
    const imageData = minimapContext.createImageData(minimapCanvas.width, minimapCanvas.height);
    const data = imageData.data;
    
    for (let canvasY = 0; canvasY < minimapCanvas.height; canvasY++) {
        for (let canvasX = 0; canvasX < minimapCanvas.width; canvasX++) {
            // Canvas座標をワールド座標に変換
            const worldX = Math.floor(canvasX / minimapScale);
            const worldZ = Math.floor(canvasY / minimapScale);
            
            let r = 135, g = 206, b = 235; // デフォルト: 空色
            
            if (worldX >= 0 && worldX < worldSize && worldZ >= 0 && worldZ < worldSize) {
                const height = window.worldHeightMap[worldX][worldZ];
                const blockType = getBlockType(worldX, height, worldZ, height);
                
                // 地形の種類に応じて色を設定
                if (blockType === 1) { // 草ブロック
                    r = 106; g = 170; b = 64;
                    // 高さに応じて明暗を調整
                    const brightness = 0.5 + (height / (heightRange * 2)) * 0.5;
                    r *= brightness; g *= brightness; b *= brightness;
                } else if (blockType === 2) { // 土ブロック
                    r = 150; g = 108; b = 74;
                } else if (blockType === 3) { // 石ブロック
                    r = 127; g = 127; b = 127;
                }
                
                // 木がある場所は緑を濃く
                if (treeBlocks.has(`tree_${worldX}_${worldZ}`)) {
                    r = 34; g = 139; b = 34; // 森の緑
                }
            }
            
            const pixelIndex = (canvasY * minimapCanvas.width + canvasX) * 4;
            data[pixelIndex] = Math.floor(r);     // R
            data[pixelIndex + 1] = Math.floor(g); // G
            data[pixelIndex + 2] = Math.floor(b); // B
            data[pixelIndex + 3] = 255;           // A
        }
    }
    
    minimapTerrain = imageData;
}

function updateMinimap() {
    if (!minimapContext || !minimapVisible || !minimapTerrain) {
        return;
    }
    
    // 背景（地形）を描画
    minimapContext.putImageData(minimapTerrain, 0, 0);
    
    // プレイヤー位置を描画
    drawPlayersOnMinimap();
}

function drawPlayersOnMinimap() {
    if (!minimapContext) return;
    
    // 自分を描画
    if (myPlayerData && myPlayerData.position) {
        const pos = myPlayerData.position;
        const canvasX = pos.x * minimapScale;
        const canvasY = pos.z * minimapScale;
        
        // 自分は大きな青い円
        minimapContext.fillStyle = '#0080FF';
        minimapContext.beginPath();
        minimapContext.arc(canvasX, canvasY, 4, 0, 2 * Math.PI);
        minimapContext.fill();
        
        // 方向を示す線
        minimapContext.strokeStyle = '#0080FF';
        minimapContext.lineWidth = 2;
        minimapContext.beginPath();
        minimapContext.moveTo(canvasX, canvasY);
        const angle = controls.yaw;
        const lineLength = 8;
        minimapContext.lineTo(
            canvasX + Math.sin(angle) * lineLength,
            canvasY + Math.cos(angle) * lineLength
        );
        minimapContext.stroke();
    }
    
    // 他のプレイヤーを描画
    allPlayers.forEach((playerData, playerId) => {
        if (playerId !== myPlayerId && playerData.position) {
            const pos = playerData.position;
            const canvasX = pos.x * minimapScale;
            const canvasY = pos.z * minimapScale;
            
            // 他のプレイヤーは赤い円
            minimapContext.fillStyle = '#FF4444';
            minimapContext.beginPath();
            minimapContext.arc(canvasX, canvasY, 3, 0, 2 * Math.PI);
            minimapContext.fill();
            
            // プレイヤー名を表示
            minimapContext.fillStyle = '#FFFFFF';
            minimapContext.font = '10px Arial';
            minimapContext.textAlign = 'center';
            minimapContext.fillText(
                playerData.nickname || `Player_${playerId.substr(-4)}`,
                canvasX,
                canvasY - 8
            );
        }
    });
}

function updateMyPlayerData() {
    if (myPlayerId && camera) {
        myPlayerData = {
            id: myPlayerId,
            position: {
                x: camera.position.x,
                y: camera.position.y,
                z: camera.position.z
            },
            rotation: {
                x: controls.pitch,
                y: controls.yaw
            },
            nickname: allPlayers.get(myPlayerId)?.nickname || `Player_${myPlayerId.substr(-4)}`
        };
        
        // 自分の情報を allPlayers に更新
        allPlayers.set(myPlayerId, myPlayerData);
    }
}

// 初期化実行
init();