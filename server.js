require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', require('./src/routes/extract'));

const PORT = parseInt(process.env.PORT || '3000', 10);

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    '[server] ANTHROPIC_API_KEY is not set. /api/extract calls will fail until you set it.'
  );
}

app.listen(PORT, () => {
  console.log(`quantara listening on http://localhost:${PORT}`);
});
