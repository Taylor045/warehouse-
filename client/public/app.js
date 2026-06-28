document.addEventListener("DOMContentLoaded", () => {
    // DOM Elements Bind
    const authWrapper = document.getElementById("auth-wrapper");
    const loginCard = document.getElementById("login-card");
    const signupCard = document.getElementById("signup-card");
    const mainDashboard = document.getElementById("main-dashboard");
    
    const selector = document.getElementById("picklist-selector");
    const loadBtn = document.getElementById("load-btn");
    const tableBody = document.getElementById("picking-items-body");
    const canvas = document.getElementById("warehouseMap");
    const ctx = canvas.getContext("2d");

    // Global Auth Toggle View
    window.toggleAuth = (showSignup) => {
        if(showSignup) {
            loginCard.style.display = "none";
            signupCard.style.display = "block";
        } else {
            loginCard.style.display = "block";
            signupCard.style.display = "none";
        }
    };

    // Form Event: Process Registration
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
        const data = await res.json();
        if(data.success) {
            alert("Registration complete! Please login.");
            toggleAuth(false);
        } else {
            document.getElementById("signup-msg").textContent = data.error;
        }
    });

    // Form Event: Process Login matching flowchart rules
    document.getElementById("login-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const username = document.getElementById("login-user").value;
        const password = document.getElementById("login-pass").value;

        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        
        if(data.success) {
            authWrapper.style.display = "none";
            mainDashboard.style.display = "block";
            loadPickLists(); // Initialize master dashboard items fetch
        } else {
            document.getElementById("login-msg").textContent = data.error;
        }
    });

    // Handle Logouts cleanly
    document.getElementById("logout-btn").addEventListener("click", async () => {
        await fetch('/api/auth/logout');
        window.location.reload();
    });

    // ================= SHIFT ENGINE OPERATIONAL FUNCTIONS =================

    async function loadPickLists() {
        selector.innerHTML = '<option value="">-- Choose an Order --</option>';
        const res = await fetch('/api/picklists');
        const data = await res.json();
        data.forEach(list => {
            const opt = document.createElement("option");
            opt.value = list.pick_list_id;
            opt.textContent = `List #${list.pick_list_id} - Assigned to: ${list.username} (${list.status})`;
            selector.appendChild(opt);
        });
    }

    loadBtn.addEventListener("click", async () => {
        const id = selector.value;
        if(!id) return;
        const res = await fetch(`/api/picklists/${id}/optimized`);
        const items = await res.json();
        renderTable(items);
        drawMap(items);
    });

    function renderTable(items) {
        tableBody.innerHTML = "";
        items.forEach((item, idx) => {
            const tr = document.createElement("tr");
            if(item.picked) tr.classList.add("picked-row");
            tr.innerHTML = `
                <td><b>${idx + 1}</b></td>
                <td>${item.item_name}</td>
                <td><code>Aisle ${item.aisle} / Row ${item.row_num}</code></td>
                <td>${item.quantity_requested}</td>
                <td>${item.picked ? '✅ Picked' : `<button onclick="markPicked(${item.pick_item_id})">Pick</button>`}</td>
            `;
            tableBody.appendChild(tr);
        });
    }

    function drawMap(items) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = "#eef0f2";
        for(let i=0; i<canvas.width; i+=40) {
            ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, canvas.height); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(canvas.width, i); ctx.stroke();
        }
        ctx.strokeStyle = "#e67e22"; ctx.lineWidth = 3; ctx.beginPath();
        items.forEach((item, idx) => {
            if (idx === 0) ctx.moveTo(item.map_x, item.map_y);
            else ctx.lineTo(item.map_x, item.map_y);
        });
        ctx.stroke();

        items.forEach((item, idx) => {
            ctx.beginPath(); ctx.arc(item.map_x, item.map_y, 12, 0, 2*Math.PI);
            ctx.fillStyle = item.picked ? "#27ae60" : "#d35400"; ctx.fill();
            ctx.fillStyle = "#fff"; ctx.font="bold 10px sans-serif"; ctx.textAlign="center";
            ctx.fillText(idx + 1, item.map_x, item.map_y+3);
        });
    }

    window.markPicked = async function(id) {
        await fetch(`/api/pickitems/${id}/pick`, { method: 'POST' });
        loadBtn.click();
    };
});