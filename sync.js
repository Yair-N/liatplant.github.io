/* ============================================================
   GLOBAL STATE
============================================================ */

let port = null;
let reader = null;
let writer = null;

const plants = {};   // plantID → { live:{}, summary:{}, charts:{} }
let selectedPlant = null;


/* ============================================================
   LOGGING
============================================================ */

function log(msg) {
    const box = document.getElementById("logBox");
    box.innerText += msg + "\n";
    box.scrollTop = box.scrollHeight;
}


/* ============================================================
   SERIAL CONNECTION
============================================================ */

document.getElementById("connectBtn").addEventListener("click", async () => {
    try {
        port = await navigator.serial.requestPort();
        await port.open({ baudRate: 115200 });

        document.getElementById("connStatus").innerText = "Connected";

        log("Connected to micro:bit");

        reader = port.readable.getReader();
        writer = port.writable.getWriter();

        listenSerial();

    } catch (err) {
        log("ERROR: " + err);
    }
});

async function sendFrame(str) {
    if (!writer) return;
    const data = new TextEncoder().encode(str + "\n");
    await writer.write(data);
    log("TX → " + str);
}


/* ============================================================
   LISTEN FOR INCOMING SERIAL DATA
============================================================ */

async function listenSerial() {
    let buffer = "";

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += new TextDecoder().decode(value);

        // Process line by line
        let lines = buffer.split("\n");
        buffer = lines.pop();

        for (let line of lines) {
            line = line.trim();
            if (line.length === 15 && /^[0-9]+$/.test(line)) {
                handleFrame(line);
            }
        }
    }
}


/* ============================================================
   FRAME PARSING
============================================================ */

function checksum(core) {
    return core.split("").reduce((s, c) => s + Number(c), 0) % 100;
}

function handleFrame(frame) {
    const core = frame.substring(0, 13);
    const cc = Number(frame.substring(13, 15));

    if (checksum(core) !== cc) {
        log("BAD CHECKSUM: " + frame);
        return;
    }

    const T = Number(frame[0]);
    const U = Number(frame.substring(1, 5));
    const ID = Number(frame.substring(5, 7));
    const A = Number(frame.substring(7, 9));
    const B = Number(frame.substring(9, 11));
    const C = Number(frame.substring(11, 13));

    if (!plants[ID]) createPlant(ID);

    if (T === 1) handleLive(ID, U, A, B, C);
    else if (T === 4) handleSummary(ID, U, A, B, C);
}


/* ============================================================
   UI CREATION
============================================================ */

function createPlant(id) {
    plants[id] = {
        live: {},
        summary: {},     // summary[day][sensor] = {avg,hi,lo}
        chart: null
    };

    // CREATE TAB
    const tabs = document.getElementById("tabsContainer");
    const tab = document.createElement("div");
    tab.className = "tab";
    tab.innerText = "Plant " + String(id).padStart(2, "0");
    tab.dataset.id = id;
    tabs.appendChild(tab);

    tab.addEventListener("click", () => selectPlant(id));

    // CREATE CONTENT PANEL
    const panel = document.createElement("div");
    panel.className = "plant-panel";
    panel.id = "panel-" + id;

    panel.innerHTML = `
        <div class="live-card" id="live-${id}">
            <h2>Live Readings</h2>
            <div class="live-value" id="t-${id}">Temp: --</div>
            <div class="live-value" id="l-${id}">Light: --</div>
            <div class="live-value" id="s-${id}">Soil: --</div>
            <button class="summary-btn" onclick="requestSummary(${id})">
                Request 14-Day Summary
            </button>
        </div>

        <canvas id="chart-${id}" height="120"></canvas>

        <div class="accordion" id="summary-${id}">
            <h2>Summary (14 Days)</h2>
        </div>
    `;

    document.getElementById("tabContents").appendChild(panel);

    if (selectedPlant === null) selectPlant(id);
}

function selectPlant(id) {
    selectedPlant = id;

    document.querySelectorAll(".tab").forEach(t => {
        t.classList.toggle("active", Number(t.dataset.id) === id);
    });

    document.querySelectorAll(".plant-panel").forEach(p => {
        p.classList.toggle("active", p.id === "panel-" + id);
    });
}


/* ============================================================
   HANDLE T=1 LIVE FRAMES
============================================================ */

function handleLive(id, U, temp, light, soil) {
    plants[id].live = { temp, light, soil };

    document.getElementById(`t-${id}`).innerText = `Temp: ${temp}°C`;
    document.getElementById(`l-${id}`).innerText = `Light: ${light}%`;
    document.getElementById(`s-${id}`).innerText = `Soil: ${soil}%`;

    updateChart(id, temp, light, soil);

    log(`LIVE ID=${id} T=${temp} L=${light} S=${soil}`);
}


/* ============================================================
   SUMMARY HANDLING (T=4)
============================================================ */

function handleSummary(id, packed, day, sensorCode, avg) {
    const hi = (packed >> 7) & 0x7F;
    const lo = packed & 0x7F;
    const sensor = sensorCode - 1;

    if (!plants[id].summary[day]) plants[id].summary[day] = {};
    plants[id].summary[day][sensor] = { avg, hi, lo };

    buildAccordion(id);
}


/* ============================================================
   BUILD SUMMARY ACCORDION
============================================================ */

function buildAccordion(id) {
    const div = document.getElementById(`summary-${id}`);
    div.innerHTML = `<h2>Summary (14 Days)</h2>`;

    for (let d = 0; d < 14; d++) {
        const item = document.createElement("div");
        item.className = "accordion-item";

        const header = document.createElement("div");
        header.className = "accordion-header";
        header.innerText = "Day " + d;

        const content = document.createElement("div");
        content.className = "accordion-content";

        const data = plants[id].summary[d];
        if (data) {
            const temp = data[0] ? data[0] : { avg: "--", hi: "--", lo: "--" };
            const light = data[1] ? data[1] : { avg: "--", hi: "--", lo: "--" };
            const soil = data[2] ? data[2] : { avg: "--", hi: "--", lo: "--" };

            content.innerHTML = `
                <p>Temp: avg ${temp.avg}, hi ${temp.hi}, lo ${temp.lo}</p>
                <p>Light: avg ${light.avg}, hi ${light.hi}, lo ${light.lo}</p>
                <p>Soil: avg ${soil.avg}, hi ${soil.hi}, lo ${soil.lo}</p>
            `;
        }

        header.onclick = () => item.classList.toggle("open");

        item.appendChild(header);
        item.appendChild(content);
        div.appendChild(item);
    }
}


/* ============================================================
   REQUEST SUMMARY (T=5)
============================================================ */

function requestSummary(id) {
    const core = "5" + "0000" + String(id).padStart(2, "0") + "000000";
    const cc = checksum(core).toString().padStart(2, "0");
    sendFrame(core + cc);

    log("Requesting summary from ID=" + id);
}


/* ============================================================
   CHARTS
============================================================ */

function updateChart(id, t, l, s) {
    if (!plants[id].chart) {
        const ctx = document.getElementById(`chart-${id}`).getContext("2d");

        plants[id].chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    { label: "Temp",  data: [], borderColor: "#e63946" },
                    { label: "Light", data: [], borderColor: "#457b9d" },
                    { label: "Soil",  data: [], borderColor: "#2a9d8f" }
                ]
            },
            options: { responsive: true, animation: false }
        });
    }

    const chart = plants[id].chart;

    chart.data.labels.push("");
    chart.data.datasets[0].data.push(t);
    chart.data.datasets[1].data.push(l);
    chart.data.datasets[2].data.push(s);

    if (chart.data.labels.length > 100) {
        chart.data.labels.shift();
        chart.data.datasets.forEach(d => d.data.shift());
    }

    chart.update();
}
