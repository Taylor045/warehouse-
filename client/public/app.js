document.addEventListener("DOMContentLoaded", () => {
    let currentUserRole = 'picker';
    let currentUsername = '';
    let loadedPickingItems = [];

    // DOM Binders
    const authWrapper = document.getElementById("auth-wrapper");
    const mainDashboard = document.getElementById("main-dashboard");
    const pickerTab = document.getElementById("picker-tab");
    const inventoryTab = document.getElementById("inventory-tab");
    const skuEntryBox = document.getElementById("sku-entry-box");
    const dispatchBox = document.getElementById("dispatch-box");
    const navInventoryBtn = document.getElementById("nav-inventory");
    const roleBadge = document.getElementById("role-badge");
    const portalTitle = document.getElementById("portal-title");
    
    const selector = document.getElementById("picklist-selector");
    const loadBtn = document.getElementById("load-btn");
    const tableBody = document.getElementById("picking-items-body");
    const stockBody = document.getElementById("master-stock-body");
    const canvas = document.getElementById("warehouseMap");
    const ctx = canvas.getContext("2d");
    const routeMode = document.getElementById("route-mode");

    // Initialize Session Check
    checkSession();

    async function checkSession() {
        try {
            const res = await fetch('/api/auth/session');
            const data = await res.json();
            if (data.loggedIn) {
                authWrapper.style.display = "none";
                mainDashboard.style.display = "block";
                setupDashboardForRole(data.role, data.username);
            } else {
                authWrapper.style.display = "block";
                mainDashboard.style.display = "none";
            }
        } catch (err) {
            console.error("Session check error:", err);
        }
    }

    function setupDashboardForRole(role, username) {
        currentUserRole = role;
        currentUsername = username;
        roleBadge.textContent = `${username} (${role.toUpperCase()})`;

        if (role === 'picker') {
            portalTitle.textContent = "Picker Workstation";
            if (navInventoryBtn) navInventoryBtn.style.display = "none"; 
            if (skuEntryBox) skuEntryBox.style.display = "none"; 
            if (dispatchBox) dispatchBox.style.display = "none";
            switchTab('picker-tab');
        } else {
            portalTitle.textContent = "Warehouse Operations Panel";
            if (navInventoryBtn) navInventoryBtn.style.display = "inline-block";
            if (skuEntryBox) skuEntryBox.style.display = "block";
            if (dispatchBox) dispatchBox.style.display = "block";
            switchTab('picker-tab');
            populateDispatchDropdowns();
        }
        loadPickLists();
    }

    window.switchTab = (tabName) => {
        if (tabName === 'picker-tab') {
            pickerTab.style.display = "block";
            inventoryTab.style.display = "none";
            loadPickLists();
        } else {
            pickerTab.style.display = "none";
            inventoryTab.style.display = "block";
            loadMasterStock();
            populateDispatchDropdowns();
        }
    };

    window.toggleAuth = (showSignup) => {
        document.getElementById("login-card").style.display = showSignup ? "none" : "block";
        document.getElementById("signup-card").style.display = showSignup ? "block" : "none";
    };

    // Authentication Listeners
    document.getElementById("login-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const username = document.getElementById("login-user").value;
        const password = document.getElementById("login-pass").value;

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            if (res.ok) {
                authWrapper.style.display = "none";
                mainDashboard.style.display = "block";
                setupDashboardForRole(data.role, data.username);
            } else {
                document.getElementById("login-msg").textContent = data.error;
            }
        } catch (err) {
            document.getElementById("login-msg").textContent = "Server connection failed.";
        }
    });

    document.getElementById("signup-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const username = document.getElementById("signup-user").value;
        const password = document.getElementById("signup-pass").value;
        const role = document.getElementById("signup-role").value;

        await fetch('/api/auth/signup', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ username, password, role })
        });
        alert("Account Created successfully.");
        toggleAuth(false);
    });

    document.getElementById("logout-btn").addEventListener("click", async () => {
        await fetch('/api/auth/logout');
        window.location.reload();
    });

    // Populate Pick Lists Dropdown
    async function loadPickLists() {
        selector.innerHTML = '<option value="">-- Select Pick Order --</option>';
        try {
            const res = await fetch('/api/picklists');
            const lists = await res.json();
            
            if (!Array.isArray(lists) || lists.length === 0) {
                selector.innerHTML = "<option value=''>No Picking Tickets Available</option>";
                tableBody.innerHTML = "<tr><td colspan='6' style='text-align:center;'>No active orders found.</td></tr>";
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                return;
            }

            lists.forEach(list => {
                const opt = document.createElement("option");
                opt.value = list.pick_list_id;
                opt.textContent = `Ticket #${list.pick_list_id} [Assigned: ${list.username}] (${list.status})`;
                selector.appendChild(opt);
            });

            // Auto-select first ticket if available
            if (lists.length > 0) {
                selector.value = lists[0].pick_list_id;
                fetchAndRenderPath(lists[0].pick_list_id);
            }
        } catch (err) {
            console.error("Failed to fetch pick lists:", err);
        }
    }

    // MAIN PATH GENERATION CORE FUNCTION
    async function fetchAndRenderPath(pickListId) {
        if (!pickListId) {
            alert("Please select a valid picking ticket order from the dropdown.");
            return;
        }

        loadBtn.disabled = true;
        loadBtn.textContent = "Generating Path...";

        try {
            const res = await fetch(`/api/picklists/${pickListId}/optimized`);
            if (!res.ok) throw new Error("Failed to load list details");
            
            loadedPickingItems = await res.json();
            renderPickingTable(loadedPickingItems);
            drawSpatialWarehouseMap(loadedPickingItems);
        } catch (err) {
            console.error("Path Generation Error:", err);
            alert("Error loading optimized path matrix.");
        } finally {
            loadBtn.disabled = false;
            loadBtn.textContent = "Generate Optimized Path Matrix";
        }
    }

    // Click Listener for Generate Button
    loadBtn.addEventListener("click", () => {
        fetchAndRenderPath(selector.value);
    });

    // Change Listener for Dropdown Selection
    selector.addEventListener("change", () => {
        if (selector.value) {
            fetchAndRenderPath(selector.value);
        }
    });

    // Render Table Instructions
    function renderPickingTable(items) {
        tableBody.innerHTML = "";
        if (!items || items.length === 0) {
            tableBody.innerHTML = "<tr><td colspan='6' style='text-align:center;'>No items in this pick ticket.</td></tr>";
            return;
        }

        items.forEach((item, idx) => {
            const tr = document.createElement("tr");
            if (item.picked) tr.classList.add("picked-row");

            const abcColor = item.abc_class === 'A' ? '#e74c3c' : (item.abc_class === 'B' ? '#f39c12' : '#95a5a6');

            tr.innerHTML = `
                <td><span class="seq-badge">${idx + 1}</span></td>
                <td><code>${item.sku}</code></td>
                <td>
                    <b>${item.item_name}</b>
                    ${item.abc_class ? `<span style="background:${abcColor}; color:white; font-size:0.7rem; padding:2px 6px; border-radius:10px; font-weight:bold; margin-left:5px;">Class ${item.abc_class}</span>` : ''}
                </td>
                <td><span class="loc-tag">Aisle ${item.aisle} / ${item.bin_code}</span></td>
                <td><strong>${item.quantity_requested}</strong></td>
                <td>${item.picked ? '✅ Picked' : `<button class="pick-action-btn" onclick="triggerPickItem(${item.pick_item_id})">Confirm Pick</button>`}</td>
            `;
            tableBody.appendChild(tr);
        });
    }

    window.redrawCurrentMap = () => {
        drawSpatialWarehouseMap(loadedPickingItems);
    };

    // Canvas Rendering Engine
    function drawSpatialWarehouseMap(items) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Render Racks
        ctx.fillStyle = "#dfe6e9";
        ctx.fillRect(40, 40, 70, 320);  
        ctx.fillRect(200, 40, 70, 320); 
        ctx.fillStyle = "#2c3e50";
        ctx.font = "bold 12px sans-serif";
        ctx.fillText("AISLE A", 50, 30);
        ctx.fillText("AISLE B", 210, 30);

        // Packing Station Anchor
        ctx.fillStyle = "#00b894";
        ctx.fillRect(110, 370, 90, 25);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 10px sans-serif";
        ctx.fillText("DISPATCH", 130, 386);

        if (!items || items.length === 0) return;

        const viewMode = routeMode.value;
        const activeWaypoints = viewMode === 'live' ? items.filter(item => !item.picked) : items;

        // Path Line Rendering
        if (activeWaypoints.length > 0) {
            ctx.strokeStyle = "#0984e3";
            ctx.lineWidth = 3;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            
            ctx.moveTo(155, 370); // Start at Dispatch Station
            activeWaypoints.forEach((item) => {
                ctx.lineTo(item.map_x, item.map_y);
            });
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Draw Waypoint Markers
        items.forEach((item, idx) => {
            // Node Outer Aura
            ctx.beginPath();
            ctx.arc(item.map_x, item.map_y, 14, 0, 2 * Math.PI);
            ctx.fillStyle = item.abc_class === 'A' ? 'rgba(231, 76, 60, 0.25)' : 'rgba(149, 165, 166, 0.25)';
            ctx.fill();

            // Core Node Circle
            ctx.beginPath();
            ctx.arc(item.map_x, item.map_y, 11, 0, 2 * Math.PI);
            ctx.fillStyle = item.picked ? "#2ecc71" : "#e74c3c";
            ctx.fill();
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 2;
            ctx.stroke();

            // Sequence Number
            ctx.fillStyle = "#fff";
            ctx.font = "bold 10px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(idx + 1, item.map_x, item.map_y);
        });
    }

    // Pick Item Action Handler
    window.triggerPickItem = async (id) => {
        try {
            await fetch(`/api/pickitems/${id}/pick`, { method: 'POST' });
            fetchAndRenderPath(selector.value); // Reload path and table
        } catch (err) {
            console.error("Pick confirm error:", err);
        }
    };

    // Manager Section Population
    async function populateDispatchDropdowns() {
        try {
            const resPickers = await fetch('/api/pickers');
            const pickers = await resPickers.json();
            const pickerSelect = document.getElementById("dispatch-picker");
            if (pickerSelect) {
                pickerSelect.innerHTML = '<option value="">-- Select Picker Staff --</option>';
                pickers.forEach(p => {
                    pickerSelect.innerHTML += `<option value="${p.user_id}">${p.username}</option>`;
                });
            }

            const resItems = await fetch('/api/inventory');
            const items = await resItems.json();
            const itemSelect = document.getElementById("dispatch-item");
            if (itemSelect) {
                itemSelect.innerHTML = '<option value="">-- Select Stock Item --</option>';
                items.forEach(i => {
                    itemSelect.innerHTML += `<option value="${i.item_id}">${i.item_name} (${i.sku}) - Avail: ${i.quantity}</option>`;
                });
            }
        } catch (err) {
            console.error("Failed to populate manager forms:", err);
        }
    }

    async function loadMasterStock() {
        try {
            const res = await fetch('/api/inventory');
            const items = await res.json();
            stockBody.innerHTML = "";
            items.forEach(item => {
                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td><b>${item.sku}</b></td>
                    <td>${item.item_name}</td>
                    <td><mark>${item.quantity} units</mark></td>
                    <td><code>BIN-${item.bin_code} (Shelf ${item.shelf_code})</code></td>
                `;
                stockBody.appendChild(tr);
            });
        } catch (err) {
            console.error("Master stock error:", err);
        }
    }

    // Manager Forms Handlers
    const invForm = document.getElementById("inventory-form");
    if (invForm) {
        invForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const item_name = document.getElementById("inv-name").value;
            const sku = document.getElementById("inv-sku").value;
            const quantity = document.getElementById("inv-qty").value;
            const bin_id = document.getElementById("inv-bin").value;

            await fetch('/api/inventory', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ item_name, sku, quantity, bin_id })
            });
            alert("Stock Record Committed.");
            invForm.reset();
            loadMasterStock();
            populateDispatchDropdowns();
        });
    }

    const dispatchForm = document.getElementById("dispatch-form");
    if (dispatchForm) {
        dispatchForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const user_id = document.getElementById("dispatch-picker").value;
            const item_id = document.getElementById("dispatch-item").value;
            const quantity_requested = document.getElementById("dispatch-qty").value;

            const res = await fetch('/api/picklists/create', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ user_id, items: [{ item_id, quantity_requested }] })
            });

            if (res.ok) {
                alert("Pick Ticket Dispatched.");
                dispatchForm.reset();
                loadPickLists();
            }
        });
    }
});