# 3D Multiplayer Terrain Viewer

A real-time 3D multiplayer terrain exploration application built with Three.js and WebSocket technology.

## Features

### 🌍 3D Terrain System
- Procedural terrain generation with smooth height constraints (adjacent blocks differ by 0-1 height only)
- Server-side map generation and client distribution
- Dynamic chunk-based loading for optimal performance
- Height-based terrain texturing (grass, dirt, stone)

### 🌲 Environmental Features
- Procedural tree generation (5-block height) on grass terrain
- Sparse distribution algorithm for natural forest appearance
- Trees properly rooted at ground level

### 👥 Multiplayer Features
- Real-time player synchronization via WebSocket
- Robust connection handling with automatic reconnection
- Player position and rotation tracking
- Online status indicators (🟢 Online, 🟡 Inactive, 🔴 Offline)

### 💬 Communication
- Real-time chat system with message broadcasting
- System notifications for player join/leave events
- XSS-safe message handling with length limits

### 🗺️ Minimap System
- Real-time minimap display in top-right corner
- Terrain visualization with height-based coloring
- Player position tracking with directional indicators
- Toggle visibility with 'M' key

### 🔧 Technical Features
- Heartbeat-based connection monitoring
- Exponential backoff reconnection strategy
- User state re-synchronization on reconnection
- Dynamic UI layout adjustments
- Performance-optimized rendering

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd mc-client
```

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
npm start
```

4. Open your browser and navigate to:
```
http://localhost:3000/terrain-3d.html
```

## Controls

- **WASD**: Move around the world
- **Mouse**: Look around (click to capture mouse)
- **Space**: Move up
- **Shift**: Move down
- **T**: Toggle texture preview
- **M**: Toggle minimap
- **Enter**: Open/send chat message
- **Esc**: Close chat

## Architecture

### Server (Node.js + Express + WebSocket)
- `server.js`: Main server with terrain generation and player management
- Terrain smoothing algorithms for natural landscape generation
- Real-time message broadcasting and player state synchronization

### Client (Three.js + HTML5 Canvas)
- `terrain-3d.html`: Main 3D client application
- Dynamic chunk loading and terrain rendering
- WebSocket client with robust error handling
- Canvas-based minimap with real-time updates

### Key Components
- **Terrain Generation**: Server-side procedural generation with client-side rendering
- **Player Management**: Real-time position tracking and state synchronization
- **Connection Management**: Heartbeat monitoring with automatic reconnection
- **UI System**: Dynamic layout with minimap, chat, and user lists

## Development

The project structure:
```
mc-client/
├── server.js              # WebSocket server and terrain generation
├── terrain-3d.html         # Main 3D client application
├── package.json           # Node.js dependencies
├── .gitignore            # Git ignore rules
├── CLAUDE.md             # Development documentation
└── js/
    └── chambered.js      # Original reference implementation
```

## Dependencies

- **express**: Web server framework
- **ws**: WebSocket library for real-time communication
- **three.js**: 3D graphics library (loaded from CDN)

## License

This project was developed with assistance from Claude AI and is available for educational and non-commercial use.

---

🤖 Generated with [Claude Code](https://claude.ai/code)