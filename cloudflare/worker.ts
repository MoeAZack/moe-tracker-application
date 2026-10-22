import { env } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import { configureD1Store } from '../lib/store';
import { canonicalRedirect } from './pages-worker.js';
import { createApp } from '../server';

type Bindings = { DB: any; ASSETS: { fetch(request: Request): Promise<Response> } };
const bindings = env as unknown as Bindings;
configureD1Store(bindings.DB);
const app = await createApp(false);
app.listen(3000);
const api = httpServerHandler({ port: 3000 });

export default {
  fetch(request: Request) {
    const path = new URL(request.url).pathname;
    return path.startsWith('/api/') ? api.fetch(request) : canonicalRedirect(request) || bindings.ASSETS.fetch(request);
  },
};
