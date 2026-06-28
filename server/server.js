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

// Set up Express Session handling
app.use(session({
  secret: 'warehouse_secret_key_2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 600000 } // Session expires after 10 minutes
}));

// ================= AUTHENTICATION APIs =================

// 1. SIGNUP API
app.post('/api/auth/signup', async (req, res) => {
  const { username, password, role } = req.body;
  try {
    const [existing] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await db.query(
      'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
      [username, hashedPassword, role || 'picker']
    );
    res.json({ success: true, message: 'Registration successful!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. LOGIN API (Matching your flowchart)
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    // Flowchart Step: Email/Username Exists?
    const [users] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
    if (users.length === 0) {
      return res.status(400).json({ error: 'Invalid Username/Email' });
    }

    const user = users[0];

    // Flowchart Step: Check if already locked out
    if (user.is_locked) {
      return res.status(403).json({ error: 'Account is locked due to 5 failed attempts.' });
    }

    // Flowchart Step: Password match?
    const isMatch = await bcrypt.compare(password, user.password);

    if (isMatch) {
      // Flowchart Step: Create session & reset tracking
      await db.query('UPDATE users SET login_attempts = 0 WHERE user_id = ?', [user.user_id]);
      
      req.session.userId = user.user_id;
      req.session.role = user.role;

      res.json({ success: true, message: 'Logged in successfully', role: user.role });
    } else {
      // Flowchart Step: Attempts calculation
      const newAttempts = user.login_attempts + 1;
      
      if (newAttempts >= 5) {
        // Flowchart Step: Lock Account
        await db.query('UPDATE users SET login_attempts = ?, is_locked = TRUE WHERE user_id = ?', [newAttempts, user.user_id]);
        return res.status(403).json({ error: 'Too many incorrect attempts. Your account has been locked.' });
      } else {
        await db.query('UPDATE users SET login_attempts = ? WHERE user_id = ?', [newAttempts, user.user_id]);
        return res.status(400).json({ error: `Wrong password. Attempts remaining: ${5 - newAttempts}` });
      }
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. LOGOUT API
app.get('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// ================= EXISTING WAREHOUSE PATH ROUTING APIs =================

app.get('/api/picklists', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT p.pick_list_id, u.username, p.status, p.created_at 
      FROM pick_list p JOIN users u ON p.user_id = u.user_id
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/picklists/:id/optimized', async (req, res) => {
  const { id } = req.params;
  try {
    const [items] = await db.query(`
      SELECT pi.pick_item_id, pi.quantity_requested, pi.picked, i.item_name, i.sku, b.bin_code, s.shelf_code, s.aisle, s.row_num, s.map_x, s.map_y
      FROM pick_list_item pi
      JOIN inventory_items i ON pi.item_id = i.item_id
      JOIN bin_location b ON i.bin_id = b.bin_id
      JOIN shelf_location s ON b.shelf_id = s.shelf_id
      WHERE pi.pick_list_id = ? ORDER BY s.aisle ASC, s.row_num ASC
    `, [id]);
    res.json(items);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/pickitems/:id/pick', async (req, res) => {
  try {
    await db.query('UPDATE pick_list_item SET picked = TRUE WHERE pick_item_id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Fallback HTML page direct mapping
app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Server running safely on http://localhost:${PORT}`));