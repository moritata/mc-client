# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This repository contains a 3D multiplayer terrain viewer:

**terrain-3d.html** - A modern Three.js implementation that generates procedural terrain using GPU-accelerated polygon rendering with full multiplayer support.

## Running the Application

### 3D Multiplayer Terrain Viewer
```bash
# Install Node.js dependencies
npm install

# Start the multiplayer server
npm start
# Navigate to http://localhost:3000/terrain-3d.html
```

The multiplayer version requires Node.js and includes WebSocket communication for real-time player synchronization.

## Architecture

### terrain-3d.html (3D Multiplayer Terrain Viewer)
- **Data Structure**: Individual Three.js Mesh objects for each terrain block
- **Rendering**: GPU rasterization using WebGL through Three.js
- **World Generation**: 128x128 block world with procedural heightmap using noise functions
- **Terrain Types**: 3-layer system (grass surface, dirt middle, stone base)
- **Controls**: First-person camera with WASD movement and mouse look
- **Multiplayer**: WebSocket-based real-time player synchronization
- **Performance**: Dynamic chunk loading (64-block render distance) and optimized rendering

## Key Technical Concepts

### Procedural Texture Generation
The application uses mathematical functions to generate block textures:
- Color base values with random brightness variations
- Noise functions for texture detail
- Different algorithms per block type (grass, dirt, stone, tree trunk, leaves)

### Coordinate System
- **terrain-3d.html**: 128×128 surface grid with Y-axis height variation of ±4 blocks
- Dynamic chunk-based loading system for performance optimization

### Rendering Pipeline
- **GPU Rasterization**: For each object → project to screen space → rasterize triangles → apply textures
- WebGL-based rendering through Three.js framework

## Development Notes

- The terrain viewer requires Node.js server for multiplayer functionality
- WebSocket communication handles real-time player position synchronization
- Includes performance optimizations: chunk-based loading, disabled shadows, optimized rendering
- Debug features: press 'T' to view texture atlas, 'M' for minimap toggle, connection status indicator
- Player height is set to 3 blocks above ground level
- Comprehensive chat system with Enter/Esc controls

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