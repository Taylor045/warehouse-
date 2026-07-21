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
  secret: 'warehouse_secret_key_2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 3600000 }
}));

app.get('/favicon.ico', (req, res) => res.status(204).end());

// Get Current User Session State
app.get('/api/auth/session', (req, res) => {
  if (req.session.userId) {
    res.json({ loggedIn: true, userId: req.session.userId, username: req.session.username, role: req.session.role });
  } else {
    res.json({ loggedIn: false });
  }
});

// Authentication Routes
app.post('/api/auth/signup', async (req, res) => {
  const { username, password, role } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await db.query('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, hashedPassword, role || 'picker']);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const [users] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
    if (users.length === 0) return res.status(400).json({ error: 'User does not exist.' });

    const user = users[0];
    const match = await bcrypt.compare(password, user.password);
    if (match) {
      req.session.userId = user.user_id;
      req.session.username = user.username;
      req.session.role = user.role;
      res.json({ success: true, role: user.role, username: user.username });
    } else {
      res.status(400).json({ error: 'Invalid password.' });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// Get List of All Staff Pickers (For Manager Assignment Dropdown)
app.get('/api/pickers', async (req, res) => {
  try {
    const [rows] = await db.query("SELECT user_id, username FROM users WHERE role = 'picker'");
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Master Stock Inventory Endpoints
app.get('/api/inventory', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT i.item_id, i.item_name, i.sku, i.quantity, b.bin_code, s.shelf_code, s.aisle 
      FROM inventory_items i 
      JOIN bin_location b ON i.bin_id = b.bin_id 
      JOIN shelf_location s ON b.shelf_id = s.shelf_id
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/inventory', async (req, res) => {
  const { item_name, sku, quantity, bin_id } = req.body;
  try {
    await db.query('INSERT INTO inventory_items (item_name, sku, quantity, bin_id) VALUES (?, ?, ?, ?)', [item_name, sku, quantity, bin_id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// MANAGER ACTION: Create Pick Ticket and Assign Items to Picker
app.post('/api/picklists/create', async (req, res) => {
  const { user_id, items } = req.body; // items = [{ item_id, quantity_requested }]
  try {
    const [result] = await db.query('INSERT INTO pick_list (user_id, status) VALUES (?, "pending")', [user_id]);
    const pick_list_id = result.insertId;

    for (let item of items) {
      await db.query(
        'INSERT INTO pick_list_item (pick_list_id, item_id, quantity_requested) VALUES (?, ?, ?)',
        [pick_list_id, item.item_id, item.quantity_requested]
      );
    }
    res.json({ success: true, pick_list_id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get Pick Lists (Managers see all; Pickers see ALL tickets or ASSIGNED tickets)
app.get('/api/picklists', async (req, res) => {
  try {
    let query = `SELECT p.pick_list_id, u.username, p.status FROM pick_list p JOIN users u ON p.user_id = u.user_id`;
    let params = [];
    
    // Pickers see tickets assigned to them OR tickets available for work
    if (req.session.role === 'picker') {
      query += ` WHERE p.user_id = ? OR p.status = 'pending'`;
      params.push(req.session.userId);
    }
    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});


app.get('/api/picklists/:id/optimized', async (req, res) => {
  const { id } = req.params;
  try {
    const [items] = await db.query(`
      SELECT 
        pi.pick_item_id, 
        pi.quantity_requested, 
        pi.picked, 
        i.item_name, 
        i.sku, 
        COALESCE(i.pick_velocity, 0) AS pick_velocity,
        COALESCE(i.abc_class, 'C') AS abc_class,
        COALESCE(i.weight_kg, 1.0) AS weight_kg,
        i.affinity_group_id,
        b.bin_code, 
        s.shelf_code, 
        s.aisle, 
        s.row_num, 
        s.map_x, 
        s.map_y
      FROM pick_list_item pi 
      JOIN inventory_items i ON pi.item_id = i.item_id 
      JOIN bin_location b ON i.bin_id = b.bin_id 
      JOIN shelf_location s ON b.shelf_id = s.shelf_id
      WHERE pi.pick_list_id = ? 
      ORDER BY 
        CASE COALESCE(i.abc_class, 'C')
          WHEN 'A' THEN 1
          WHEN 'B' THEN 2
          ELSE 3
        END ASC,
        s.aisle ASC, 
        s.row_num ASC
    `, [id]);

    res.json(items);
  } catch (err) {
    console.error("❌ SQL ROUTE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PICKER ACTION: Mark Item Picked & Automatically Update Inventory Stock
app.post('/api/pickitems/:id/pick', async (req, res) => {
  try {
    const [items] = await db.query('SELECT item_id, quantity_requested, pick_list_id FROM pick_list_item WHERE pick_item_id = ?', [req.params.id]);
    if (items.length > 0) {
      const { item_id, quantity_requested, pick_list_id } = items[0];
      
      // Update item status in picklist
      await db.query('UPDATE pick_list_item SET picked = TRUE WHERE pick_item_id = ?', [req.params.id]);
      
      // Deduct stock balance real-time
      await db.query('UPDATE inventory_items SET quantity = GREATEST(0, quantity - ?) WHERE item_id = ?', [quantity_requested, item_id]);
      
      // Mark list 'in_progress'
      await db.query('UPDATE pick_list SET status = "in_progress" WHERE pick_list_id = ?', [pick_list_id]);
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/', (req, res) => res.sendFile(path.join(publicPath, 'index.html')));

app.listen(3000, () => console.log(`Server executing safely on http://localhost:3000`));