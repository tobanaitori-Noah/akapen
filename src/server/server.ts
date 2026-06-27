import express from 'express';
import { createServer, type Server as HttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { createRoutes } from './routes.js';

export interface StartServerOptions {
  port: number;
  openPath?: string;
  userDataDir?: string;
}

export interface StartedServer {
  port: number;
  url: string;
  server: HttpServer;
  close(): Promise<void>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const rendererDir = path.resolve(here, '../renderer');

export function startServer(options: StartServerOptions): Promise<StartedServer> {
  const app = express();
  const server = createServer(app);
  const clients = new Set<WebSocket>();

  const broadcast = (msg: object) => {
    const data = JSON.stringify(msg);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  };

  app.use(express.json({ limit: '50mb' }));
  const routes = createRoutes({
    broadcast,
    openPath: options.openPath,
    userDataDir: options.userDataDir,
  });
  app.use(routes);
  app.use(express.static(rendererDir));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.sendFile(path.join(rendererDir, 'index.html'));
  });

  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
  });

  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : options.port;
      resolve({
        port,
        url: `http://127.0.0.1:${port}`,
        server,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            routes.close();
            wss.close(() => {
              server.close((error) => {
                if (error) closeReject(error);
                else closeResolve();
              });
            });
          }),
      });
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(options.port, '127.0.0.1');
  });
}
