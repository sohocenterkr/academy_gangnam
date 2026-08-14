import { createApp } from './app';
import { loadEnv } from './env';

const env = loadEnv();
const app = createApp();

app.listen(env.PORT, () => {
  console.log(`API server listening on http://localhost:${env.PORT}`);
});
