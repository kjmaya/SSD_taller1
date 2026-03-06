const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = process.argv[2];
const COORDINADOR_URL = process.argv[3];
const PUBLIC_URL = process.argv[4];
const PULSE_INTERVAL = 2000;

if (!COORDINADOR_URL || !PUBLIC_URL) {
    console.log("Uso: node index.js <PUERTO> <URL_COORDINADOR> <URL_PUBLICA>");
    process.exit(1);
}

const id = crypto.randomUUID();

// lista de coordinadores conocidos, el primero es el que se paso por argumento
let coordinadores = [COORDINADOR_URL];
let coordinadorActual = COORDINADOR_URL;
let estado = "Desconocido"; // puede ser: Conectado, Failover, Sin coordinador
let lastHeartbeat = null;
let failoverEnCurso = false;

app.use(cors());
app.use(express.json());

// endpoint de estado interno
app.get('/status', (req, res) => {
    res.json({
        worker: {
            id,
            port: PORT,
            publicUrl: PUBLIC_URL,
            pulseInterval: PULSE_INTERVAL,
            timestamp: Date.now()
        },
        coordinator: {
            url: coordinadorActual,
            status: estado,
            lastHeartbeat,
            lista: coordinadores
        }
    });
});

// endpoint para cambiar coordinador manualmente
app.post('/change-coordinator', async (req, res) => {
    const { newCoordinatorUrl } = req.body;

    if (!newCoordinatorUrl) {
        return res.status(400).json({ error: "Se requiere newCoordinatorUrl" });
    }

    // agregar a la lista si no existe
    if (!coordinadores.includes(newCoordinatorUrl)) {
        coordinadores.push(newCoordinatorUrl);
        console.log("Nuevo coordinador agregado a la lista:", newCoordinatorUrl);
    }

    // cambiar inmediatamente
    coordinadorActual = newCoordinatorUrl;
    console.log("Coordinador cambiado a:", coordinadorActual);

    // re-registrarse con el nuevo coordinador
    await register();

    res.json({
        message: "Coordinador cambiado exitosamente",
        coordinadorActual,
        lista: coordinadores
    });
});

// endpoint para agregar un backup sin cambiar el actual
app.post('/add-backup', (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: "Se requiere url" });
    }

    if (!coordinadores.includes(url)) {
        coordinadores.push(url);
        console.log("Backup agregado:", url);
        return res.json({ message: "Backup agregado", lista: coordinadores });
    }

    res.json({ message: "Ya estaba en la lista", lista: coordinadores });
});

// pagina web del worker
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Worker Info</title>
 <style>
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=Space+Mono:wght@400;700&display=swap');

    :root {
        --bg-deep:     #06040d;
        --bg-mid:      #0f0a1e;
        --glass:       rgba(255,255,255,0.04);
        --glass-hover: rgba(255,255,255,0.07);
        --border:      rgba(180,100,255,0.18);
        --border-hot:  rgba(255,60,140,0.4);
        --pink:        #ff2d78;
        --pink-glow:   #ff2d7866;
        --pink-soft:   #ff85b3;
        --purple:      #b44dff;
        --purple-glow: #b44dff55;
        --purple-dark: #5b0fa8;
        --lavender:    #d4b0ff;
        --text:        #f0e6ff;
        --muted:       #8a73a8;
        --ok:          #b44dff;
        --error:       #ff2d78;
    }

    /* ── Noise grain overlay ── */
    body::before {
        content: '';
        position: fixed;
        inset: 0;
        background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E");
        pointer-events: none;
        z-index: 9999;
        opacity: 0.6;
    }

    /* ── Ambient orbs ── */
    body::after {
        content: '';
        position: fixed;
        top: -200px; left: -200px;
        width: 600px; height: 600px;
        background: radial-gradient(circle, var(--purple-glow) 0%, transparent 65%);
        border-radius: 50%;
        pointer-events: none;
        animation: orb-drift 12s ease-in-out infinite alternate;
        z-index: 0;
    }

    @keyframes orb-drift {
        from { transform: translate(0,0) scale(1); }
        to   { transform: translate(120px, 80px) scale(1.15); }
    }

    body {
        font-family: 'Syne', sans-serif;
        margin: 0;
        padding: 32px 40px;
        background: var(--bg-deep);
        background-image:
            radial-gradient(ellipse 80% 60% at 80% 90%, rgba(255,45,120,0.12) 0%, transparent 60%),
            radial-gradient(ellipse 60% 80% at 10% 20%, rgba(180,77,255,0.14) 0%, transparent 55%);
        color: var(--text);
        min-height: 100vh;
        position: relative;
    }

    /* ── Fade-in stagger ── */
    h1, h2, table, .controles, ul, p.info {
        animation: fade-up 0.5s ease both;
    }
    h1     { animation-delay: 0.05s; }
    h2     { animation-delay: 0.1s; }
    table  { animation-delay: 0.15s; }
    .controles { animation-delay: 0.2s; }
    ul     { animation-delay: 0.25s; }

    @keyframes fade-up {
        from { opacity: 0; transform: translateY(16px); }
        to   { opacity: 1; transform: translateY(0); }
    }

    /* ── Headings ── */
    h1 {
        font-family: 'Syne', sans-serif;
        font-size: 2.1rem;
        font-weight: 800;
        letter-spacing: -1px;
        color: var(--text);
        margin-bottom: 2px;
        position: relative;
        display: inline-block;
    }

    h1::after {
        content: '';
        position: absolute;
        bottom: -4px; left: 0;
        width: 100%; height: 2px;
        background: linear-gradient(90deg, var(--pink), var(--purple), transparent);
    }

    h2 {
        font-family: 'Space Mono', monospace;
        font-size: 0.65rem;
        text-transform: uppercase;
        letter-spacing: 4px;
        font-weight: 400;
        color: var(--pink-soft);
        margin-top: 32px;
        margin-bottom: 10px;
        display: flex;
        align-items: center;
        gap: 10px;
    }

    h2::before {
        content: '//';
        color: var(--purple);
        font-size: 0.75rem;
    }

    h2::after {
        content: '';
        flex: 1;
        max-width: 120px;
        height: 1px;
        background: linear-gradient(90deg, var(--border-hot), transparent);
    }

    /* ── Table ── */
    table {
        border-collapse: collapse;
        background: var(--glass);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        width: 58%;
        border: 1px solid var(--border);
        border-radius: 10px;
        overflow: hidden;
        box-shadow:
            0 0 0 1px rgba(255,255,255,0.03),
            0 8px 40px rgba(0,0,0,0.5),
            0 0 60px rgba(180,77,255,0.06);
        position: relative;
        z-index: 1;
    }

    td, th {
        border: 1px solid var(--border);
        padding: 10px 16px;
        font-size: 13.5px;
    }

    th {
        background: rgba(91,15,168,0.25);
        color: var(--lavender);
        text-align: left;
        font-weight: 600;
        width: 40%;
        font-family: 'Space Mono', monospace;
        font-size: 11px;
        letter-spacing: 1.5px;
        text-transform: uppercase;
    }

    td {
        color: var(--text);
        transition: background 0.2s;
    }

    tr:hover td {
        background: var(--glass-hover);
    }

    /* ── Estado badges ── */
    .estado-conectado,
    .estado-failover,
    .estado-sin {
        font-family: 'Space Mono', monospace;
        font-size: 11px;
        font-weight: 700;
        padding: 2px 10px;
        border-radius: 20px;
        letter-spacing: 1px;
    }

    .estado-conectado {
        color: #c4b5fd;
        background: rgba(180,77,255,0.12);
        border: 1px solid rgba(180,77,255,0.3);
        text-shadow: 0 0 8px var(--purple-glow);
    }

    .estado-failover {
        color: var(--pink-soft);
        background: rgba(255,45,120,0.1);
        border: 1px solid rgba(255,45,120,0.3);
        text-shadow: 0 0 8px var(--pink-glow);
    }

    .estado-sin {
        color: #ff6b9d;
        background: rgba(255,45,120,0.07);
        border: 1px solid rgba(255,45,120,0.2);
    }

    /* ── Messages ── */
    #msgError, #msgOk {
        margin: 8px 0;
        font-size: 12.5px;
        font-family: 'Space Mono', monospace;
        padding: 8px 14px;
        border-radius: 6px;
        display: none;
        backdrop-filter: blur(10px);
        position: relative;
        overflow: hidden;
    }

    #msgError {
        color: var(--pink-soft);
        background: rgba(255,45,120,0.08);
        border: 1px solid rgba(255,45,120,0.25);
        border-left: 3px solid var(--pink);
    }

    #msgOk {
        color: var(--lavender);
        background: rgba(180,77,255,0.08);
        border: 1px solid rgba(180,77,255,0.25);
        border-left: 3px solid var(--purple);
    }

    /* ── Info text ── */
    p.info {
        color: var(--muted);
        font-size: 12px;
        font-family: 'Space Mono', monospace;
        letter-spacing: 0.3px;
        position: relative;
        z-index: 1;
    }

    /* ── Controls panel ── */
    .controles {
        background: var(--glass);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 18px 20px;
        width: 58%;
        margin-top: 12px;
        box-shadow:
            0 8px 40px rgba(0,0,0,0.4),
            0 0 0 1px rgba(255,255,255,0.03),
            inset 0 1px 0 rgba(255,255,255,0.06);
        position: relative;
        z-index: 1;
    }

    .controles input {
        padding: 9px 14px;
        width: 56%;
        margin-right: 10px;
        border: 1px solid var(--border);
        background: rgba(6,4,13,0.7);
        color: var(--text);
        font-family: 'Space Mono', monospace;
        font-size: 12.5px;
        border-radius: 6px;
        outline: none;
        transition: border-color 0.25s, box-shadow 0.25s;
        letter-spacing: 0.5px;
    }

    .controles input:focus {
        border-color: var(--purple);
        box-shadow: 0 0 0 3px rgba(180,77,255,0.15), 0 0 20px rgba(180,77,255,0.1);
    }

    .controles input::placeholder {
        color: var(--muted);
    }

    .controles button {
        padding: 9px 18px;
        cursor: pointer;
        background: linear-gradient(135deg, #5b0fa8 0%, #a020c0 50%, #ff2d78 100%);
        background-size: 200% 200%;
        color: white;
        border: none;
        border-radius: 6px;
        font-family: 'Syne', sans-serif;
        font-size: 12.5px;
        font-weight: 700;
        margin-right: 8px;
        letter-spacing: 1px;
        text-transform: uppercase;
        transition: background-position 0.4s ease, transform 0.15s, box-shadow 0.3s;
        box-shadow: 0 4px 20px rgba(255,45,120,0.2);
        position: relative;
        overflow: hidden;
    }

    .controles button::before {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(135deg, rgba(255,255,255,0.1), transparent);
        pointer-events: none;
    }

    .controles button:hover {
        background-position: 100% 100%;
        transform: translateY(-2px);
        box-shadow: 0 8px 30px rgba(255,45,120,0.35), 0 0 20px rgba(180,77,255,0.2);
    }

    .controles button:active {
        transform: translateY(0px);
    }

    /* ── List ── */
    ul {
        background: var(--glass);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid var(--border);
        border-radius: 10px;
        width: 58%;
        padding: 12px 14px 12px 32px;
        margin-top: 8px;
        box-shadow: 0 8px 40px rgba(0,0,0,0.3);
        position: relative;
        z-index: 1;
    }

    ul li {
        margin: 6px 0;
        font-size: 13.5px;
        color: var(--text);
        padding: 2px 0;
        transition: color 0.2s;
    }

    ul li:hover {
        color: var(--lavender);
    }

    ul li::marker {
        color: var(--pink);
        font-size: 1.1em;
    }

    .actual {
        font-weight: 700;
        color: var(--pink-soft);
        text-shadow: 0 0 10px var(--pink-glow);
        position: relative;
    }

    .actual::after {
        content: ' ◀';
        font-size: 10px;
        color: var(--purple);
        opacity: 0.7;
    }

    /* ── Scrollbar ── */
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: var(--bg-deep); }
    ::-webkit-scrollbar-thumb {
        background: linear-gradient(var(--purple-dark), var(--pink));
        border-radius: 3px;
    }
</style>
</head>
<body>
    <h1>Informacion del Worker</h1>

    <h2>Datos del Worker</h2>
    <table>
        <tr><th>ID</th><td id="wId">cargando...</td></tr>
        <tr><th>Puerto</th><td id="wPort">cargando...</td></tr>
        <tr><th>URL Publica</th><td id="wUrl">cargando...</td></tr>
        <tr><th>Intervalo heartbeat</th><td id="wInterval">cargando...</td></tr>
        <tr><th>Timestamp</th><td id="wTs">cargando...</td></tr>
    </table>

    <h2>Coordinador actual</h2>
    <table>
        <tr><th>URL</th><td id="cUrl">cargando...</td></tr>
        <tr><th>Estado</th><td id="cEstado">cargando...</td></tr>
        <tr><th>Ultimo heartbeat</th><td id="cHb">cargando...</td></tr>
    </table>

    <h2>Coordinadores conocidos</h2>
    <ul id="listaCoord"><li>cargando...</li></ul>

    <h2>Cambiar coordinador</h2>
    <div class="controles">
        <p id="msgError">Error al realizar la operacion</p>
        <p id="msgOk">Operacion exitosa</p>
        <input type="text" id="inputUrl" placeholder="https://nueva-url.ngrok.io" />
        <button onclick="cambiarCoordinador()">Cambiar coordinador</button>
        <button onclick="agregarBackup()">Agregar backup</button>
    </div>

    <p class="info">Actualizando cada 2 segundos sin recargar la pagina</p>

    <script>
        // muestra un mensaje por 3 segundos y lo oculta
        function mostrarMensaje(tipo, texto) {
            var idEl = tipo === 'ok' ? 'msgOk' : 'msgError'
            var el = document.getElementById(idEl)
            el.textContent = texto
            el.style.display = 'block'
            setTimeout(function() { el.style.display = 'none' }, 3000)
        }

        // pide el estado al servidor y actualiza la pagina
        async function actualizar() {
            try {
                var resp = await fetch('/status')
                var data = await resp.json()

                document.getElementById('wId').textContent       = data.worker.id
                document.getElementById('wPort').textContent     = data.worker.port
                document.getElementById('wUrl').textContent      = data.worker.publicUrl
                document.getElementById('wInterval').textContent = data.worker.pulseInterval + ' ms'
                document.getElementById('wTs').textContent       = new Date(data.worker.timestamp).toLocaleString()

                document.getElementById('cUrl').textContent = data.coordinator.url

                // poner color segun el estado
                var estadoEl = document.getElementById('cEstado')
                estadoEl.textContent = data.coordinator.status
                estadoEl.className = ''
                if (data.coordinator.status === 'Conectado')        estadoEl.className = 'estado-conectado'
                else if (data.coordinator.status === 'Failover')    estadoEl.className = 'estado-failover'
                else if (data.coordinator.status === 'Sin coordinador') estadoEl.className = 'estado-sin'

                if (data.coordinator.lastHeartbeat) {
                    document.getElementById('cHb').textContent = new Date(data.coordinator.lastHeartbeat).toLocaleString()
                } else {
                    document.getElementById('cHb').textContent = 'Nunca'
                }

                // construir la lista de coordinadores conocidos
                var lista = data.coordinator.lista
                var ul = document.getElementById('listaCoord')
                ul.innerHTML = ''
                for (var i = 0; i < lista.length; i++) {
                    var li = document.createElement('li')
                    li.textContent = lista[i]
                    if (lista[i] === data.coordinator.url) {
                        li.className = 'actual'
                        li.textContent += ' (actual)'
                    }
                    ul.appendChild(li)
                }

            } catch (e) {
                mostrarMensaje('error', 'No se pudo obtener el estado del worker')
            }
        }

        // cambia el coordinador actual
        async function cambiarCoordinador() {
            var url = document.getElementById('inputUrl').value.trim()
            if (!url) { mostrarMensaje('error', 'Ingresa una URL'); return }

            try {
                var resp = await fetch('/change-coordinator', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ newCoordinatorUrl: url })
                })
                var data = await resp.json()
                mostrarMensaje('ok', 'Coordinador cambiado a: ' + data.coordinadorActual)
                document.getElementById('inputUrl').value = ''
                actualizar()
            } catch (e) {
                mostrarMensaje('error', 'No se pudo cambiar el coordinador')
            }
        }

        // agrega un backup sin cambiar el actual
        async function agregarBackup() {
            var url = document.getElementById('inputUrl').value.trim()
            if (!url) { mostrarMensaje('error', 'Ingresa una URL'); return }

            try {
                var resp = await fetch('/add-backup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: url })
                })
                var data = await resp.json()
                mostrarMensaje('ok', data.message)
                document.getElementById('inputUrl').value = ''
                actualizar()
            } catch (e) {
                mostrarMensaje('error', 'No se pudo agregar el backup')
            }
        }

        actualizar()
        setInterval(actualizar, 2000)
    </script>
</body>
</html>`);
});

// pregunta al coordinador actual por sus backups conocidos y los agrega a la lista
async function syncBackupList() {
    try {
        const resp = await fetch(`${coordinadorActual}/backups`);
        const backupList = await resp.json();
        if (Array.isArray(backupList)) {
            for (const url of backupList) {
                if (url && !coordinadores.includes(url)) {
                    coordinadores.push(url);
                    console.log("Backup descubierto desde coordinador:", url);
                }
            }
        }
    } catch (e) {
        console.log("No se pudo obtener lista de backups:", e.message);
    }
}

// intenta registrarse con el coordinador actual
async function register() {
    try {
        const resp = await fetch(`${coordinadorActual}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, url: PUBLIC_URL })
        });
        const data = await resp.json();
        estado = "Conectado";
        console.log("Registrado con:", coordinadorActual);
        // actualizar lista de backups desde la respuesta del coordinador
        if (data.backups && Array.isArray(data.backups)) {
            for (const url of data.backups) {
                if (url && !coordinadores.includes(url)) {
                    coordinadores.push(url);
                    console.log("Backup descubierto en registro:", url);
                }
            }
        }
        // descubrir backups del coordinador para tenerlos listos en caso de failover
        await syncBackupList();
    } catch (error) {
        console.log("Error al registrar con", coordinadorActual, "- iniciando failover");
        await hacerFailover();
    }
}

// busca el siguiente coordinador disponible en la lista
async function hacerFailover() {
    if (failoverEnCurso) return;
    failoverEnCurso = true;
    estado = "Failover";

    for (let i = 0; i < coordinadores.length; i++) {
        const candidato = coordinadores[i];
        if (candidato === coordinadorActual) continue; // saltar el que ya fallo

        console.log("Intentando con coordinador:", candidato);
        try {
            const resp = await fetch(`${candidato}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, url: PUBLIC_URL })
            });
            const data = await resp.json();
            // si llego aqui es porque funciono
            // agregar backups que conoce el nuevo coordinador
            if (data.backups && Array.isArray(data.backups)) {
                for (const url of data.backups) {
                    if (url && !coordinadores.includes(url)) {
                        coordinadores.push(url);
                        console.log("Backup descubierto via failover:", url);
                    }
                }
            }
            coordinadorActual = candidato;
            estado = "Conectado";
            lastHeartbeat = Date.now();
            console.log("Failover exitoso, ahora conectado a:", coordinadorActual);
            failoverEnCurso = false;
            await syncBackupList(); // sincronizar lista completa desde el nuevo coordinador
            return;
        } catch (e) {
            console.log("Tampoco responde:", candidato);
        }
    }

    // si ninguno respondio
    estado = "Sin coordinador";
    console.log("No hay coordinadores disponibles");
    failoverEnCurso = false;
}

// envia heartbeat al coordinador actual
async function sendPulse() {
    try {
        const resp = await fetch(`${coordinadorActual}/pulse`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });
        const data = await resp.json();
        estado = "Conectado";
        lastHeartbeat = Date.now();
        // actualizar lista de backups con lo que devuelve el coordinador en cada pulso
        if (data.backups && Array.isArray(data.backups)) {
            for (const url of data.backups) {
                if (url && !coordinadores.includes(url)) {
                    coordinadores.push(url);
                    console.log("Nuevo backup descubierto via pulso:", url);
                }
            }
        }
        console.log("Pulso enviado a:", coordinadorActual);
    } catch (error) {
        console.log("Error al enviar pulso a", coordinadorActual, "- iniciando failover");
        await hacerFailover();
    }
}

// si estamos en un backup, intenta reconectarse al primario original periodicamente
async function intentarReconectarAlPrimario() {
    if (coordinadorActual === COORDINADOR_URL) return; // ya estamos en el primario
    console.log("Verificando si el primario volvio:", COORDINADOR_URL);
    try {
        const resp = await fetch(`${COORDINADOR_URL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, url: PUBLIC_URL })
        });
        const data = await resp.json();
        // el primario respondio, volver a el
        coordinadorActual = COORDINADOR_URL;
        estado = "Conectado";
        lastHeartbeat = Date.now();
        console.log("Primario recuperado, reconectado a:", COORDINADOR_URL);
        if (data.backups && Array.isArray(data.backups)) {
            for (const url of data.backups) {
                if (url && !coordinadores.includes(url)) {
                    coordinadores.push(url);
                }
            }
        }
        await syncBackupList();
    } catch (e) {
        console.log("Primario todavia no disponible:", e.message);
    }
}

app.listen(PORT, async () => {
    console.log(`Worker ${id} corriendo en el puerto ${PORT}`);
    await register();
    setInterval(sendPulse, PULSE_INTERVAL);
    // sincronizar la lista de backups cada 10 segundos por si se agregan nuevos
    setInterval(syncBackupList, 10000);
    // intentar volver al primario cada 10 segundos si estamos en un backup
    setInterval(intentarReconectarAlPrimario, 10000);
});