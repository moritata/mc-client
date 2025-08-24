# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This repository contains two distinct 3D rendering demonstrations:

1. **chambered.js** - A classic software raycasting engine (similar to Wolfenstein 3D/Doom era) that renders a 3D voxel world using CPU-based pixel manipulation
2. **terrain-3d.html** - A modern Three.js implementation that generates procedural terrain using GPU-accelerated polygon rendering

## Running the Applications

### Chambered.js Demo (Single Player)
```bash
# Serve the directory with any HTTP server
python3 -m http.server 8000
# Navigate to http://localhost:8000/index.html
```

### Three.js Terrain Demo (Multiplayer)
```bash
# Install Node.js dependencies
npm install

# Start the multiplayer server
npm start
# Navigate to http://localhost:3000/terrain-3d.html
```

The multiplayer version requires Node.js and includes WebSocket communication for real-time player synchronization.

## Architecture

### chambered.js (Classic Raycasting)
- **Data Structure**: 3D voxel array `map[64*64*64]` storing block types
- **Rendering**: Software raycasting - casts rays for each screen pixel to determine color
- **Textures**: Procedural generation using mathematical functions for different block types
- **Performance**: CPU-bound, resolution-dependent (424x240 canvas)

### terrain-3d.html (Modern 3D + Multiplayer)
- **Data Structure**: Individual Three.js Mesh objects for each terrain block
- **Rendering**: GPU rasterization using WebGL through Three.js
- **World Generation**: 128x128 block world with procedural heightmap using noise functions
- **Terrain Types**: 3-layer system (grass surface, dirt middle, stone base)
- **Controls**: First-person camera with WASD movement and mouse look
- **Multiplayer**: WebSocket-based real-time player synchronization
- **Performance**: Dynamic chunk loading (64-block render distance) and optimized rendering

## Key Technical Concepts

### Procedural Texture Generation
Both implementations use mathematical functions to generate block textures:
- Color base values with random brightness variations
- Noise functions for texture detail
- Different algorithms per block type (grass, dirt, stone, etc.)

### Coordinate Systems
- **chambered.js**: 64x64x64 voxel grid with wraparound boundaries
- **terrain-3d.html**: 256x256 surface grid with Y-axis height variation of ±4 blocks

### Rendering Pipeline Differences
- **Raycasting**: For each pixel → cast ray → find intersection → sample texture → set pixel color
- **Rasterization**: For each object → project to screen space → rasterize triangles → apply textures

## Development Notes

- Chambered.js is a standalone HTML file with embedded JavaScript
- The terrain demo requires Node.js server for multiplayer functionality
- WebSocket communication handles real-time player position synchronization
- Includes performance optimizations: chunk-based loading, disabled shadows, optimized rendering
- Debug features: press 'T' to view texture atlas, connection status indicator
- Player height is set to 3 blocks above ground level in both implementations

## Multiplayer Architecture

### Server (server.js)
- Express.js HTTP server serving static files
- WebSocket server handling real-time communication
- Player state management with automatic cleanup
- Message broadcasting for position updates and player events

### Client Features
- Automatic WebSocket connection with reconnection logic
- Real-time position broadcasting with optimization thresholds
- 3D player representations with name tags
- Connection status monitoring