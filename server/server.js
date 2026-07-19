const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const db = require('./config/db');

const app = express();
const publicPath = path.join(__dirname, '..', 'client', 'public');

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(publicPath));

app.use(session({
  secret: 'industrial_area_wholesaler_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1800000 } // 30-minute session lifetime
}));

// ================= OBJECTIVE 1: RECORD & MANAGE INVENTORY DETAILS =================

// Register an Inventory Item
app.post('/api/inventory', async (req, res) => {
  const { item_name, sku, quantity, bin_id } = req.body;
  try {
    await db.query(
      'INSERT INTO inventory_items (item_name, sku, quantity, bin_id) VALUES (?, ?, ?, ?)',
      [item_name, sku, quantity, bin_id]
    );
    res.json({ success: true, message: 'Inventory profile recorded successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch complete master inventory stock list
app.get('/api/inventory', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT i.item_id, i.item_name, i.sku, i.quantity, b.bin_code, s.shelf_code, s.aisle 
      FROM inventory_items i
      JOIN bin_location b ON i.bin_id = b.bin_id
      JOIN shelf_location s ON b.shelf_id = s.shelf_id
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch active picker list headers
app.get('/api/picklists', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT p.pick_list_id, u.username, p.status, p.created_at 
      FROM pick_list p JOIN users u ON p.user_id = u.user_id
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= OBJECTIVES 2 & 3: ITEM-TO-SHELF MATCHING & PATH OPTIMIZATION =================
app.get('/api/picklists/:id/optimized', async (req, res) => {
  const { id } = req.params;
  try {
    // ALGORITHM CORE: Solves picker "searching" time by forcing an ordered spatial path walk sequence
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

// Complete Pick Line Action
app.post('/api/pickitems/:id/pick', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('UPDATE pick_list_item SET picked = TRUE WHERE pick_item_id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= AUTHENTICATION HANDLERS =================
app.post('/api/auth/signup', async (req, res) => {
  const { username, password, role } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await db.query('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, hashedPassword, role]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const [users] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
    if (users.length === 0) return res.status(400).json({ error: 'User does not exist.' });
    
    const user = users[0];
    if (user.is_locked) return res.status(403).json({ error: 'Account is locked.' });

    const match = await bcrypt.compare(password, user.password);
    if (match) {
      await db.query('UPDATE users SET login_attempts = 0 WHERE user_id = ?', [user.user_id]);
      req.session.userId = user.user_id;
      res.json({ success: true });
    } else {
      const attempts = user.login_attempts + 1;
      const locked = attempts >= 5;
      await db.query('UPDATE users SET login_attempts = ?, is_locked = ? WHERE user_id = ?', [attempts, locked, user.user_id]);
      res.status(400).json({ error: locked ? 'Account locked.' : 'Wrong password.' });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Server running smoothly on http://localhost:${PORT}`));