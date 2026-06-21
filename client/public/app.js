document.addEventListener("DOMContentLoaded", () => {
    const selector = document.getElementById("picklist-selector");
    const loadBtn = document.getElementById("load-btn");
    const tableBody = document.getElementById("picking-items-body");
    const canvas = document.getElementById("warehouseMap");
    const ctx = canvas.getContext("2d");

    // Fetch master picklists for drop-down menu
    async function loadPickLists() {
        try {
            const res = await fetch('/api/picklists');
            const data = await res.json();
            data.forEach(list => {
                const opt = document.createElement("option");
                opt.value = list.pick_list_id;
                opt.textContent = `List #${list.pick_list_id} - ${list.username} (${list.status})`;
                selector.appendChild(opt);
            });
        } catch (err) { console.error("Error loading lists", err); }
    }

    // Main fetch command to process selection
    loadBtn.addEventListener("click", async () => {
        const id = selector.value;
        if(!id) return alert("Please choose a valid layout target.");
        
        try {
            const res = await fetch(`/api/picklists/${id}/optimized`);
            const items = await res.json();
            renderTable(items);
            drawMap(items);
        } catch (err) { console.error(err); }
    });

    function renderTable(items) {
        tableBody.innerHTML = "";
        if (items.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;">This list has no items.</td></tr>`;
            return;
        }

        items.forEach((item, index) => {
            const tr = document.createElement("tr");
            if(item.picked) tr.classList.add("picked-row");

            tr.innerHTML = `
                <td><strong>${index + 1}</strong></td>
                <td>${item.item_name} <br><small style="color:#777">${item.sku}</small></td>
                <td><code>Aisle ${item.aisle} / Row ${item.row_num} (${item.bin_code})</code></td>
                <td>${item.quantity_requested}</td>
                <td>
                    ${item.picked ? '✅ Picked' : `<button class="pick-btn" onclick="markPicked(${item.pick_item_id})">Pick</button>`}
                </td>
            `;
            tableBody.appendChild(tr);
        });
    }

    // Canvas Plotting Function
    function drawMap(items) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Draw warehouse background grid
        ctx.strokeStyle = "#eef0f2";
        ctx.lineWidth = 1;
        for(let i = 0; i < canvas.width; i += 40) {
            ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, canvas.height); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(canvas.width, i); ctx.stroke();
        }

        if(items.length === 0) return;

        // Path-drawing configuration
        ctx.strokeStyle = "#e67e22";
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();

        // Trace picking routes down the array chain
        items.forEach((item, index) => {
            const x = item.map_x;
            const y = item.map_y;
            
            if (index === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.setLineDash([]); // Reset line styles

        // Add node circles to indicate sequential pick zones
        items.forEach((item, index) => {
            const x = item.map_x;
            const y = item.map_y;

            ctx.beginPath();
            ctx.arc(x, y, 12, 0, 2 * Math.PI);
            ctx.fillStyle = item.picked ? "#27ae60" : "#d35400";
            ctx.fill();
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 2;
            ctx.stroke();

            // Label step sequence digits inside nodes
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 10px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(index + 1, x, y);
        });
    }

    // Expose pick function globally
    window.markPicked = async function(id) {
        try {
            const res = await fetch(`/api/pickitems/${id}/pick`, { method: 'POST' });
            if (res.ok) loadBtn.click(); // Reload configuration layout values instantly
        } catch (err) { console.error(err); }
    }

    loadPickLists();
});