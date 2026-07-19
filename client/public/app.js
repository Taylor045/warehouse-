document.addEventListener("DOMContentLoaded", () => {
    // Dashboard Components Binder
    const authWrapper = document.getElementById("auth-wrapper");
    const mainDashboard = document.getElementById("main-dashboard");
    const pickerTab = document.getElementById("picker-tab");
    const inventoryTab = document.getElementById("inventory-tab");
    
    const selector = document.getElementById("picklist-selector");
    const loadBtn = document.getElementById("load-btn");
    const tableBody = document.getElementById("picking-items-body");
    const stockBody = document.getElementById("master-stock-body");
    const canvas = document.getElementById("warehouseMap");
    const ctx = canvas.getContext("2d");

    // Unified Application View Tab Toggle Engine
    window.switchTab = (tabName) => {
        if(tabName === 'picker-tab') {
            pickerTab.style.display = "block";
            inventoryTab.style.display = "none";
            loadPickLists();
        } else {
            pickerTab.style.display = "none";
            inventoryTab.style.display = "block";
            loadMasterStock();
        }
    };

    window.toggleAuth = (showSignup) => {
        document.getElementById("login-card").style.display = showSignup ? "none" : "block";
        document.getElementById("signup-card").style.display = showSignup ? "block" : "none";
    };

    // Authentication Forms Processing
    document.getElementById("login-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const username = document.getElementById("login-user").value;
        const password = document.getElementById("login-pass").value;

        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ username, password })
        });
        
        if(res.ok) {
            authWrapper.style.display = "none";
            mainDashboard.style.display = "block";
            loadPickLists();
        } else {
            const err = await res.json();
            document.getElementById("login-msg").textContent = err.error;
        }
    });

    document.getElementById("signup-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const username = document.getElementById("signup-user").value;
        const password = document.getElementById("signup-pass").value;
        const role = document.getElementById("signup-role").value;

        const res = await fetch('/api/auth/signup', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ username, password, role })
        });
        if(res.ok) {
            alert("Staff entry recorded.");
            toggleAuth(false);
        }
    });

    document.getElementById("logout-btn").addEventListener("click", async () => {
        await fetch('/api/auth/logout');
        window.location.reload();
    });

    // ================= RECORD & MANAGE INVENTORY LOGIC =================
    document.getElementById("inventory-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const item_name = document.getElementById("inv-name").value;
        const sku = document.getElementById("inv-sku").value;
        const quantity = document.getElementById("inv-qty").value;
        const bin_id = document.getElementById("inv-bin").value;

        const res = await fetch('/api/inventory', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ item_name, sku, quantity, bin_id })
        });

        if(res.ok) {
            alert("New stock SKU saved.");
            document.getElementById("inventory-form").reset();
            loadMasterStock();
        }
    });

    async function loadMasterStock() {
        const res = await fetch('/api/inventory');
        const items = await res.json();
        stockBody.innerHTML = "";
        items.forEach(item => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><b>${item.sku}</b></td>
                <td>${item.item_name}</td>
                <td><mark>${item.quantity} units</mark></td>
                <td><code>${item.bin_code} (Shelf ${item.shelf_code})</code></td>
            `;
            stockBody.appendChild(tr);
        });
    }

    // ================= ITEM-TO-SHELF MATCHING & PATH RENDERING =================
    async function loadPickLists() {
        selector.innerHTML = "";
        const res = await fetch('/api/picklists');
        const lists = await res.json();
        lists.forEach(list => {
            const opt = document.createElement("option");
            opt.value = list.pick_list_id;
            opt.textContent = `List Tickets #${list.pick_list_id} [Staff: ${list.username}] (${list.status})`;
            selector.appendChild(opt);
        });
    }

    loadBtn.addEventListener("click", async () => {
        const id = selector.value;
        if(!id) return;
        const res = await fetch(`/api/picklists/${id}/optimized`);
        const items = await res.json();
        renderPickingTable(items);
        drawSpatialWarehouseMap(items);
    });

    function renderPickingTable(items) {
        tableBody.innerHTML = "";
        if(items.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="6">No items assigned to this list.</td></tr>`;
            return;
        }
        items.forEach((item, idx) => {
            const tr = document.createElement("tr");
            if(item.picked) tr.classList.add("picked-row");
            tr.innerHTML = `
                <td><span class="seq-badge">${idx + 1}</span></td>
                <td><code>${item.sku}</code></td>
                <td><b>${item.item_name}</b></td>
                <td><span class="loc-tag">Aisle ${item.aisle} / ${item.bin_code}</span></td>
                <td><strong>${item.quantity_requested}</strong></td>
                <td>
                    ${item.picked ? '✅ Mapped & Picked' : `<button class="pick-action-btn" onclick="triggerPickItem(${item.pick_item_id})">Confirm Pick</button>`}
                </td>
            `;
            tableBody.appendChild(tr);
        });
    }

    // Canvas Spatial Mapping Engine
    function drawSpatialWarehouseMap(items) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Map Render Context Background: Aisles structure reference blocks
        ctx.fillStyle = "#dfe6e9";
        ctx.fillRect(30, 40, 70, 320);  // Visual representation of Racks Row Aisle A
        ctx.fillRect(150, 40, 70, 320); // Visual representation of Racks Row Aisle B
        
        ctx.fillStyle = "#b2bec3";
        ctx.font = "bold 11px sans-serif";
        ctx.fillText("AISLE A", 40, 30);
        ctx.fillText("AISLE B", 160, 30);

        if(items.length === 0) return;

        // Trace Path Sequence Route Path Lines
        ctx.strokeStyle = "#0984e3";
        ctx.lineWidth = 3;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        
        // Start coordinate point marker
        ctx.moveTo(110, 380); 
        items.forEach((item) => {
            ctx.lineTo(item.map_x, item.map_y);
        });
        ctx.stroke();
        ctx.setLineDash([]);

        // Place physical walk sequence node markers
        items.forEach((item, idx) => {
            ctx.beginPath();
            ctx.arc(item.map_x, item.map_y, 11, 0, 2 * Math.PI);
            ctx.fillStyle = item.picked ? "#2ecc71" : "#e74c3c";
            ctx.fill();
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.fillStyle = "#fff";
            ctx.font = "bold 10px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(idx + 1, item.map_x, item.map_y);
        });
    }

    window.triggerPickItem = async (id) => {
        await fetch(`/api/pickitems/${id}/pick`, { method: 'POST' });
        loadBtn.click();
    };
});