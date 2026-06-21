const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path'); 
const fs = require('fs'); // Core Node module to check files
const db = require('./config/db');

const app = express();

// 1. Permissive Development CSP to silence extension warnings
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:* http://localhost:*;"
  );
  next();
});

app.use(cors());
app.use(bodyParser.json());

// 2. DYNAMIC PATH RESOLVER: Looks inside 'server/public' first, then falls back one level up
// 2. Clear path resolving directly to your client/public structure
const publicPath = path.join(__dirname, '..', 'client', 'public');

console.log("🎯 Express is officially targeting assets at:", publicPath);
app.use(express.static(publicPath));

// 3. API Routes
app.get('/api/picklists', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT p.pick_list_id, u.username, p.status, p.created_at 
      FROM pick_list p 
      JOIN users u ON p.user_id = u.user_id
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/picklists/:id/optimized', async (req, res) => {
  const { id } = req.params;
  try {
    const [items] = await db.query(`
      SELECT 
        pi.pick_item_id, pi.quantity_requested, pi.picked,
        i.item_name, i.sku,
        b.bin_code,
        s.shelf_code, s.aisle, s.row_num, s.map_x, s.map_y
      FROM pick_list_item pi
      JOIN inventory_items i ON pi.item_id = i.item_id
      JOIN bin_location b ON i.bin_id = b.bin_id
      JOIN shelf_location s ON b.shelf_id = s.shelf_id
      WHERE pi.pick_list_id = ?
      ORDER BY s.aisle ASC, s.row_num ASC
    `, [id]);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pickitems/:id/pick', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('UPDATE pick_list_item SET picked = TRUE WHERE pick_item_id = ?', [id]);
    res.json({ success: true, message: "Item marked as picked." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Safe Explicit Root Route Handler
app.get('/', (req, res) => {
  const finalHtmlPath = path.join(publicPath, 'index.html');
  if (fs.existsSync(finalHtmlPath)) {
    res.sendFile(finalHtmlPath);
  } else {
    res.status(404).send(`
      <div style="font-family:sans-serif; padding:20px;">
        <h2>Express Setup Directory Error</h2>
        <p>Express server is running, but it cannot find your <b>index.html</b> file.</p>
        <p>It searched inside: <code>${finalHtmlPath}</code></p>
        <p><b>How to fix:</b> Ensure you have a folder named exactly <code>public</code> (lowercase) right inside your <code>server</code> folder, and place your <code>index.html</code>, <code>style.css</code>, and <code>app.js</code> files inside it.</p>
      </div>
    `);
  }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Server running safely on http://localhost:${PORT}`));