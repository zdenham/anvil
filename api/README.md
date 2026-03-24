# Anvil API

A basic Fastify server for the Anvil application.

## Getting Started

1. Install dependencies:
   ```bash
   cd api
   npm install
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```

3. Or start the production server:
   ```bash
   npm start
   ```

## Available Endpoints

- `GET /` - Returns a hello world message
- `GET /health` - Returns server health status

The server runs on `http://localhost:3001` by default.

## Development

- Uses ES modules (`"type": "module"`)
- Includes `--watch` flag for development hot reloading
- Fastify logger enabled for request/response logging